package handlers

// inbound.go — Procesamiento de mensajes entrantes y flujo Bot-primero (Bot-first).
//
// Este archivo implementa la lógica central que recibe un mensaje entrante desde
// cualquier canal (WhatsApp, Messenger, Telegram, etc.), lo persiste en la base de
// datos de la empresa y desencadena el flujo automático:
//
//   1. Verificar que el canal existe.
//   2. Crear o reutilizar el contacto (lookup por teléfono + canal).
//   3. Abrir o reutilizar la conversación activa del contacto.
//   4. Guardar el mensaje evitando duplicados mediante external_id.
//   5. Actualizar estadísticas (last_message_at, unread_count).
//   6. Notificar la bandeja de entrada vía WebSocket.
//   7. Ejecutar el flujo Bot → Agente en una goroutine separada para no bloquear
//      la respuesta HTTP al proveedor del webhook.
//
// Si el bot está habilitado y tiene una API key de Anthropic configurada, intenta
// responder automáticamente al usuario. Si el bot retorna el centinela "NEEDS_HUMAN"
// (o falla), la conversación se asigna a un agente humano.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"harmony-api/internal/circuitbreaker"
	"harmony-api/internal/config"
	"harmony-api/internal/database"
	"harmony-api/internal/models"
	"harmony-api/internal/ws"

	"gorm.io/gorm"
)

// sharedHTTPClient reutiliza conexiones para las llamadas a APIs externas (M-18).
var sharedHTTPClient = &http.Client{Timeout: 30 * time.Second}

// anthropicBreaker protege las llamadas a la API de Anthropic.
// Se abre tras 5 fallos consecutivos y permanece abierto 60 segundos.
var anthropicBreaker = circuitbreaker.New(5, 60*time.Second)

// botSemaphore limita las goroutines concurrentes de runBotFlow a 20
// para prevenir agotamiento de memoria bajo carga alta (CRIT-03).
var botSemaphore = make(chan struct{}, 20)

// C-01: helpers para construir nombres de canal WebSocket namespaceados por empresa.
// Todo broadcast DEBE usar estos helpers para no filtrar datos entre tenants.
func chInbox(companyID uint) string { return fmt.Sprintf("company.%d.inbox", companyID) }
func chConversation(companyID, convID uint) string {
	return fmt.Sprintf("company.%d.conversation.%d", companyID, convID)
}
func chUser(companyID, userID uint) string {
	return fmt.Sprintf("company.%d.user.%d", companyID, userID)
}

// ProcessInbound crea o actualiza la conversación con el mensaje entrante y ejecuta
// el flujo Bot-first.
//
// Cuándo se llama: desde los webhooks de cada canal (WhatsApp, Messenger, etc.) o
// desde SimulateInbound durante pruebas. Es el punto de entrada principal para
// cualquier mensaje que llega desde un usuario externo.
//
// Parámetros:
//   - db         : conexión GORM a la base de datos de la empresa (multi-tenant).
//   - channelID  : ID interno del canal en Harmony por el que llegó el mensaje.
//   - senderPhone: número de teléfono (o identificador único) del remitente.
//   - senderName : nombre del remitente tal como lo reporta el proveedor (puede ser "").
//   - messageBody: texto del mensaje recibido.
//   - externalID : ID externo del mensaje en la plataforma origen (usado para deduplicar).
//
// Retorna: error si alguna operación de base de datos crítica falla; nil si todo
// se procesó correctamente (incluyendo el caso de mensaje duplicado ignorado).
func ProcessInbound(db *gorm.DB, channelID uint, senderPhone, senderName, messageBody, externalID string) error {
	// 1. Verificar que el canal existe
	var channel models.Channel
	if err := db.First(&channel, channelID).Error; err != nil {
		return fmt.Errorf("canal %d no encontrado", channelID)
	}

	// 2. Contacto — buscar por teléfono + canal, crear si no existe.
	// Se usa la combinación (phone, channel_id) como clave natural para evitar
	// colisiones entre distintos canales que puedan tener el mismo número.
	var contact models.Contact
	db.Where("phone = ? AND channel_id = ?", senderPhone, channelID).First(&contact)
	if contact.ID == 0 {
		// El contacto no existe para este canal: se crea nuevo.
		contact = models.Contact{
			ChannelID: channelID,
			Phone:     senderPhone,
			Name:      senderName,
		}
		if err := db.Create(&contact).Error; err != nil {
			return fmt.Errorf("crear contacto: %w", err)
		}
	} else if senderName != "" && contact.Name == "" {
		// El contacto existe pero no tiene nombre: aprovechar el que llegó ahora.
		db.Model(&contact).Update("name", senderName)
		contact.Name = senderName
	}

	// 3. Conversación activa (open o pending) — la más reciente del contacto en este canal.
	// Se busca primero para no abrir conversaciones duplicadas si el usuario ya tiene una activa.
	var conv models.Conversation
	db.Where("contact_id = ? AND channel_id = ? AND status IN ('open','pending')", contact.ID, channelID).
		Order("created_at DESC").Preload("Agent").First(&conv)

	now := time.Now()
	isNewConv := conv.ID == 0 // Bandera que indica si se va a crear una conversación nueva.

	if isNewConv {
		// No existe conversación activa: crear una nueva en estado "pending".
		// El número de caso usa milisegundos Unix para garantizar unicidad.
		conv = models.Conversation{
			ChannelID:     channelID,
			ContactID:     contact.ID,
			CaseNumber:    fmt.Sprintf("CASE-%d", now.UnixNano()/1e6),
			Status:        models.ConvPending,
			LastMessageAt: &now,
		}
		// Heredar departamento del canal si tiene uno asignado,
		// para que la lógica de enrutamiento a agentes funcione correctamente.
		if channel.DepartmentID != nil {
			conv.DepartmentID = channel.DepartmentID
		}
		if err := db.Create(&conv).Error; err != nil {
			return fmt.Errorf("crear conversación: %w", err)
		}
	}

	// 4. Guardar mensaje entrante (evitar duplicados por external_id).
	// Los proveedores de mensajería a veces reenvían el mismo evento webhook más de una vez;
	// el external_id (ID del mensaje en la plataforma externa) actúa como idempotency key.
	if externalID != "" {
		var existing models.Message
		db.Where("external_id = ?", externalID).First(&existing)
		if existing.ID != 0 {
			return nil // Duplicado detectado — ignorar silenciosamente.
		}
	}

	msg := models.Message{
		ConversationID: conv.ID,
		Body:           messageBody,
		Direction:      "inbound",
		Status:         "received",
		Type:           "text",
		ExternalID:     externalID,
	}
	if err := db.Create(&msg).Error; err != nil {
		// M-08: dos entregas concurrentes del mismo mensaje pueden pasar ambas el
		// chequeo anterior; el índice único parcial idx_messages_external_id hace
		// fallar el segundo INSERT. Reconfirmar y tratar como duplicado si ya existe,
		// en vez de devolver un 500 que provocaría reintentos infinitos del proveedor.
		if externalID != "" {
			var dup models.Message
			if db.Where("external_id = ?", externalID).First(&dup).Error == nil && dup.ID != 0 {
				return nil
			}
		}
		return fmt.Errorf("crear mensaje: %w", err)
	}

	// 5. Actualizar estadísticas de la conversación.
	// Se incrementa unread_count para que la bandeja muestre el badge de mensajes sin leer.
	db.Exec(`UPDATE conversations SET last_message_at = NOW(), unread_count = unread_count + 1 WHERE id = ?`, conv.ID)

	// 6. Broadcast WebSocket — notificar bandeja de entrada y sala de conversación.
	// C-01: los canales van namespaceados por empresa para no filtrar datos entre tenants.
	companyID := channel.CompanyID
	ws.GlobalHub.Broadcast(chInbox(companyID), "MessageReceived", map[string]any{
		"conversation_id": conv.ID,
		"message":         msg,
	})
	ws.GlobalHub.Broadcast(chConversation(companyID, conv.ID), "MessageReceived", msg)

	// 7. Flujo Bot → Agente ejecutado en goroutine separada para no bloquear el webhook.
	// El proveedor externo (ej. Meta, Twilio) espera un HTTP 200 rápido; el procesamiento
	// real puede tomar varios segundos si se consulta la API de Claude.
	//
	// A-06: adquisición NO bloqueante del semáforo. Si los 20 slots están ocupados NO
	// bloqueamos el goroutine del request (el webhook de Meta haría timeout y reintentaría);
	// en su lugar derivamos la conversación directo a un agente humano sin pasar por el bot.
	// C-27: recover() para que un panic en el flujo del bot no tumbe el proceso completo.
	select {
	case botSemaphore <- struct{}{}:
		go func() {
			defer func() {
				<-botSemaphore
				if r := recover(); r != nil {
					log.Printf("PANIC en runBotFlow: %v", r)
				}
			}()
			runBotFlow(db, &conv, &msg, isNewConv, companyID)
		}()
	default:
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("PANIC en assignToAgent: %v", r)
				}
			}()
			assignToAgent(db, &conv, companyID)
		}()
	}

	return nil
}

// runBotFlow verifica si el bot automático está habilitado e intenta responder
// al mensaje entrante con Claude (Anthropic). Si el bot no puede responder
// (deshabilitado, sin API key, error, o centinela NEEDS_HUMAN), delega al
// sistema de asignación de agentes humanos.
//
// Cuándo se llama: siempre en una goroutine lanzada por ProcessInbound, tras
// haber guardado el mensaje en BD y emitido los eventos WebSocket iniciales.
//
// Parámetros:
//   - db       : conexión GORM a la base de datos de la empresa.
//   - conv     : puntero a la conversación activa.
//   - msg      : puntero al mensaje entrante recién guardado.
//   - isNewConv: true si la conversación fue creada en esta misma llamada.
func runBotFlow(db *gorm.DB, conv *models.Conversation, msg *models.Message, isNewConv bool, companyID uint) {
	// Cargar configuración del bot del departamento de la conversación (B-32):
	// se prefiere la config específica del departamento y, si no hay, la global (NULL).
	var botCfg BotConfig
	q := db.Order("department_id NULLS LAST")
	if conv.DepartmentID != nil {
		q = q.Where("department_id = ? OR department_id IS NULL", *conv.DepartmentID)
	} else {
		q = q.Where("department_id IS NULL")
	}
	if err := q.First(&botCfg).Error; err != nil || !botCfg.IsEnabled {
		// Bot deshabilitado o no configurado — asignar directo a agente humano.
		assignToAgent(db, conv, companyID)
		return
	}

	// Resolver la API key: primero la propia de la empresa (cifrada en companies), y si no
	// tiene, la global del .env. Sin ninguna, se asigna a un agente humano.
	apiKey := config.App.AnthropicKey
	var company models.Company
	if database.SystemDB.First(&company, companyID).Error == nil && company.AnthropicAPIKey != "" {
		apiKey = company.AnthropicAPIKey
	}
	if apiKey == "" {
		assignToAgent(db, conv, companyID)
		return
	}

	// Construir el system prompt base; si no hay uno personalizado, usar el por defecto.
	systemPrompt := botCfg.Instructions
	if systemPrompt == "" {
		systemPrompt = "Eres un asistente de servicio al cliente. Responde las consultas del usuario de forma concisa y útil en español."
	}
	// Adjuntar instrucción especial para que el bot sepa cuándo debe ceder al agente humano.
	// NEEDS_HUMAN es el centinela que el modelo debe devolver literalmente cuando no puede
	// resolver la consulta, para que el sistema lo derive a un agente sin mostrar texto al usuario.
	systemPrompt += "\n\nIMPORTANTE: Si no puedes responder con certeza o la consulta requiere atención humana personalizada, responde únicamente con la palabra NEEDS_HUMAN sin ningún texto adicional."

	// Usar valores del config del bot o caer en los defaults razonables.
	maxTokens := 512
	model := botCfg.Model
	if model == "" {
		model = "claude-haiku-4-5-20251001"
	}

	// Memoria de conversación: construir el historial reciente (no solo el último mensaje)
	// respetando el presupuesto de caracteres del bot, para que mantenga el hilo.
	maxChars := botCfg.MaxContextChars
	if maxChars <= 0 {
		maxChars = 8000
	}
	messages := buildBotMessages(db, conv.ID, maxChars)
	if len(messages) == 0 {
		// Sin historial utilizable, usar al menos el mensaje actual.
		messages = []anthropicMsg{{Role: "user", Content: msg.Body}}
	}

	// Llamar a la API de Claude con el historial de la conversación.
	botReply, err := callClaudeAPI(apiKey, model, systemPrompt, messages, maxTokens)
	if err != nil {
		// Error de red o de la API de Anthropic: registrarlo (antes se perdía) y derivar.
		log.Printf("ERROR: fallo del bot IA (conv %d, empresa %d): %v", conv.ID, companyID, err)
		assignToAgent(db, conv, companyID)
		return
	}
	if botReply == "NEEDS_HUMAN" || botReply == "" {
		// El modelo pidió atención humana, o respuesta vacía inesperada.
		assignToAgent(db, conv, companyID)
		return
	}

	// Bot respondió exitosamente — guardar el mensaje de salida en la conversación.
	botMsg := models.Message{
		ConversationID: conv.ID,
		Body:           botReply,
		Direction:      "outbound",
		Status:         "sent",
		Type:           "text",
	}
	if err := db.Create(&botMsg).Error; err != nil {
		log.Printf("ERROR: guardar respuesta del bot: %v", err)
		return
	}
	// Actualizar timestamp de último mensaje para mantener la bandeja ordenada.
	db.Exec(`UPDATE conversations SET last_message_at = NOW() WHERE id = ?`, conv.ID)

	// Broadcast de la respuesta del bot (C-01: canales namespaceados por empresa).
	ws.GlobalHub.Broadcast(chConversation(companyID, conv.ID), "MessageReceived", botMsg)
	ws.GlobalHub.Broadcast(chInbox(companyID), "MessageReceived", map[string]any{
		"conversation_id": conv.ID,
		"message":         botMsg,
	})
}

// anthropicMsg es un turno de la conversación en el formato de la API de Anthropic.
type anthropicMsg struct {
	Role    string // "user" | "assistant"
	Content string
}

// buildBotMessages arma el historial reciente de una conversación en el formato que espera
// la API de Anthropic: turnos alternando user/assistant, empezando por "user". Entrantes =
// user, salientes = assistant. Fusiona turnos consecutivos del mismo rol (la API exige
// alternancia) y recorta al presupuesto de caracteres conservando los mensajes más recientes.
func buildBotMessages(db *gorm.DB, convID uint, maxChars int) []anthropicMsg {
	var rows []models.Message
	db.Where("conversation_id = ? AND type = ?", convID, "text").
		Order("id DESC").Limit(40).Find(&rows)
	// Invertir a orden cronológico (más viejo primero).
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}

	var msgs []anthropicMsg
	for _, m := range rows {
		body := strings.TrimSpace(m.Body)
		if body == "" {
			continue
		}
		role := "user"
		if m.Direction == "outbound" {
			role = "assistant"
		}
		if n := len(msgs); n > 0 && msgs[n-1].Role == role {
			msgs[n-1].Content += "\n" + body // fusionar turnos consecutivos del mismo rol
			continue
		}
		msgs = append(msgs, anthropicMsg{Role: role, Content: body})
	}

	// Debe empezar por un turno "user".
	for len(msgs) > 0 && msgs[0].Role != "user" {
		msgs = msgs[1:]
	}
	if len(msgs) == 0 {
		return msgs
	}

	// Recortar al presupuesto de caracteres conservando los turnos más recientes.
	total, start := 0, len(msgs)
	for i := len(msgs) - 1; i >= 0; i-- {
		total += len(msgs[i].Content)
		if total > maxChars {
			break
		}
		start = i
	}
	msgs = msgs[start:]
	for len(msgs) > 0 && msgs[0].Role != "user" {
		msgs = msgs[1:]
	}
	return msgs
}

// assignToAgent busca el mejor agente disponible y asigna la conversación abierta.
//
// Lógica de prioridad:
//  1. Si la conversación ya tiene un agente asignado y ese agente sigue activo
//     (no eliminado), se mantiene la asignación y se marca la conversación como "open".
//  2. Si el agente previo fue eliminado, se limpia el campo agent_id y se busca uno nuevo.
//  3. Se busca un agente online del departamento de la conversación/canal.
//  4. Si ninguno está online, se toma cualquier agente del departamento.
//  5. Si no hay agentes disponibles, la conversación queda en "pending" para que el
//     sistema de auto-asignación la tome cuando un agente se conecte.
//
// Cuándo se llama: desde runBotFlow cuando el bot no puede (o no debe) responder.
//
// Parámetros:
//   - db  : conexión GORM a la base de datos de la empresa.
//   - conv: puntero a la conversación que debe asignarse.
func assignToAgent(db *gorm.DB, conv *models.Conversation, companyID uint) {
	// ¿Ya tiene agente asignado y sigue activo?
	if conv.AgentID != nil {
		var existing models.User
		db.First(&existing, conv.AgentID)
		if existing.ID != 0 && existing.DeletedAt.Time.IsZero() {
			// Agente sigue activo — mantener asignación y pasar la conversación a "open".
			db.Model(conv).Update("status", "open")
			broadcastConvUpdate(conv, companyID)
			return
		}
		// El agente fue eliminado del sistema — limpiar la asignación para buscar uno nuevo.
		db.Model(conv).Update("agent_id", nil)
		conv.AgentID = nil
	}

	// Construir la consulta base: agentes o supervisores no eliminados.
	q := db.Model(&models.User{}).
		Where("role IN ('agent','supervisor') AND deleted_at IS NULL")
	// Restringir al departamento si la conversación tiene uno asignado,
	// para respetar el enrutamiento por especialidad o área.
	if conv.DepartmentID != nil {
		q = q.Where("department_id = ?", *conv.DepartmentID)
	}

	// 1er intento: preferir un agente que esté online en este momento.
	var agent models.User
	q.Where("is_online = true").Order("last_seen_at DESC").First(&agent)

	// 2do intento: si ninguno está online, tomar el último agente activo del departamento.
	if agent.ID == 0 {
		q.Order("last_seen_at DESC").First(&agent)
	}

	if agent.ID != 0 {
		// Agente encontrado — asignar y abrir la conversación.
		db.Model(conv).Updates(map[string]any{
			"agent_id": agent.ID,
			"status":   "open",
		})
		// Notificar al agente recién asignado para que aparezca en su cola.
		ws.GlobalHub.Broadcast(chUser(companyID, agent.ID), "ConversationAssigned", conv)
	} else {
		// Sin agentes disponibles — dejar en pending para que la auto-asignación
		// la tome cuando un agente se conecte al sistema.
		db.Model(conv).Update("status", "pending")
	}
	broadcastConvUpdate(conv, companyID)
}

// broadcastConvUpdate emite un evento WebSocket a la sala "inbox" informando
// que el estado o agente de una conversación ha cambiado.
//
// Cuándo se llama: siempre que assignToAgent modifica el estado o la asignación
// de una conversación, para que todos los clientes conectados actualicen su vista.
//
// Parámetros:
//   - conv: puntero a la conversación cuyo estado fue modificado.
func broadcastConvUpdate(conv *models.Conversation, companyID uint) {
	ws.GlobalHub.Broadcast(chInbox(companyID), "ConversationUpdated", map[string]any{
		"conversation_id": conv.ID,
		"status":          conv.Status,
		"agent_id":        conv.AgentID,
	})
}

// callClaudeAPI realiza una llamada HTTP directa a la API de Mensajes de Anthropic
// (POST /v1/messages) y retorna el texto de la primera respuesta del modelo.
//
// Cuándo se llama: desde runBotFlow cada vez que un mensaje entrante debe ser
// procesado por el bot automático de Claude.
//
// Parámetros:
//   - apiKey      : clave secreta de la API de Anthropic (x-api-key header).
//   - model       : ID del modelo de Claude a usar (ej. "claude-haiku-4-5-20251001").
//   - systemPrompt: instrucciones de comportamiento del asistente (rol, restricciones).
//   - userMessage : texto del mensaje del usuario que se envía al modelo.
//   - maxTokens   : límite máximo de tokens en la respuesta generada.
//
// Retorna:
//   - string: texto de la primera entrada del array "content" de la respuesta.
//   - error : si la petición HTTP falla, el status no es 200, o la respuesta no es parseable.
func callClaudeAPI(apiKey, model, systemPrompt string, messages []anthropicMsg, maxTokens int) (string, error) {
	// Construir el payload según la especificación de la API de Mensajes de Anthropic.
	msgArr := make([]map[string]any, len(messages))
	for i, m := range messages {
		msgArr[i] = map[string]any{"role": m.Role, "content": m.Content}
	}
	payload := map[string]any{
		"model":      model,
		"max_tokens": maxTokens,
		"system":     systemPrompt,
		"messages":   msgArr,
	}
	body, _ := json.Marshal(payload)

	var responseText string
	// nonRetryErr captura errores 4xx deterministas: se devuelven al llamador pero
	// NO se propagan al breaker (retornamos nil dentro del closure) para no abrirlo
	// por errores del cliente (M-18).
	var nonRetryErr error
	cbErr := anthropicBreaker.Call(func() error {
		req, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
		resp, err := sharedHTTPClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if resp.StatusCode != http.StatusOK {
			// 4xx (salvo 429) = error del cliente, no cuenta como fallo del servicio.
			if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
				nonRetryErr = fmt.Errorf("anthropic API %d: %s", resp.StatusCode, string(respBody))
				return nil
			}
			return fmt.Errorf("anthropic API %d: %s", resp.StatusCode, string(respBody))
		}
		var result struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		if err := json.Unmarshal(respBody, &result); err != nil || len(result.Content) == 0 {
			return fmt.Errorf("respuesta inválida de Claude")
		}
		responseText = result.Content[0].Text
		return nil
	})
	if nonRetryErr != nil {
		return "", nonRetryErr
	}
	if cbErr != nil {
		return "", cbErr
	}
	return responseText, nil
}
