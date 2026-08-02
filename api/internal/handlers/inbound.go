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

// InboundAttachment describe un adjunto multimedia ya descargado y guardado
// localmente (ver senders.WhatsAppFetchMedia/MetaFetchMedia/TelegramFetchMedia),
// listo para asociarse a un mensaje entrante.
type InboundAttachment struct {
	Type         string // "image" | "audio" | "video" | "document" | "sticker"
	FileURL      string // "/uploads/company_<id>/attachments/..." — ruta local, no del proveedor
	OriginalName string
	MimeType     string
	Size         int64
}

// ProcessInbound crea o actualiza la conversación con un mensaje de texto entrante
// y ejecuta el flujo Bot-first. Ver processInboundMessage para el detalle del flujo.
//
// Cuándo se llama: desde los webhooks de cada canal (WhatsApp, Messenger, etc.) o
// desde SimulateInbound durante pruebas.
func ProcessInbound(db *gorm.DB, channelID uint, senderPhone, senderName, messageBody, externalID string) error {
	return processInboundMessage(db, channelID, senderPhone, senderName, messageBody, externalID, nil)
}

// ProcessInboundMedia crea o actualiza la conversación con un mensaje multimedia
// entrante (imagen/audio/video/documento) ya descargado del proveedor. caption
// puede ir vacío (Messenger no manda caption; WhatsApp y Telegram sí).
//
// Cuándo se llama: desde los webhooks de cada canal al detectar un mensaje que no
// es de texto, después de descargar el adjunto vía el paquete senders.
func ProcessInboundMedia(db *gorm.DB, channelID uint, senderPhone, senderName, caption, externalID string, att InboundAttachment) error {
	return processInboundMessage(db, channelID, senderPhone, senderName, caption, externalID, &att)
}

// processInboundMessage contiene el flujo común a mensajes de texto y multimedia:
// verificar canal → crear/reusar contacto → crear/reusar conversación → deduplicar
// por external_id → guardar el mensaje (y su adjunto, si viene) → actualizar
// estadísticas de la conversación → notificar por WebSocket → disparar el flujo
// Bot → Agente. att es nil para mensajes de texto.
//
// Parámetros:
//   - db         : conexión GORM a la base de datos de la empresa (multi-tenant).
//   - channelID  : ID interno del canal en Harmony por el que llegó el mensaje.
//   - senderPhone: número de teléfono (o identificador único) del remitente.
//   - senderName : nombre del remitente tal como lo reporta el proveedor (puede ser "").
//   - messageBody: texto del mensaje, o el caption si att no es nil (puede ser "").
//   - externalID : ID externo del mensaje en la plataforma origen (usado para deduplicar).
//   - att        : adjunto ya descargado, o nil para un mensaje de texto plano.
//
// Retorna: error si alguna operación de base de datos crítica falla; nil si todo
// se procesó correctamente (incluyendo el caso de mensaje duplicado ignorado).
func processInboundMessage(db *gorm.DB, channelID uint, senderPhone, senderName, messageBody, externalID string, att *InboundAttachment) error {
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

	msgType := "text"
	if att != nil {
		msgType = att.Type
	}
	msg := models.Message{
		ConversationID: conv.ID,
		Body:           messageBody,
		Direction:      "inbound",
		// El check constraint de "messages" solo permite pending/sent/delivered/read/failed.
		// "received" no es un valor válido y hacía fallar el INSERT en silencio (el error se
		// descarta en el llamador), por lo que ningún mensaje entrante se guardaba nunca.
		Status:     "delivered",
		Type:       msgType,
		ExternalID: externalID,
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

	// Si el mensaje trae un adjunto ya descargado, crear el registro vinculado y
	// asignarlo a msg.Attachments ANTES del broadcast: el frontend inserta el
	// payload del WebSocket directo en su caché sin volver a pedir el mensaje,
	// así que si attachments viaja vacío el adjunto no se ve hasta recargar.
	if att != nil {
		attachment := models.MessageAttachment{
			MessageID:    msg.ID,
			AzurePath:    att.FileURL,
			OriginalName: att.OriginalName,
			MimeType:     att.MimeType,
			Size:         att.Size,
		}
		db.Create(&attachment)
		msg.Attachments = []models.MessageAttachment{attachment}
	}

	// 5. Actualizar estadísticas de la conversación.
	// Se incrementa unread_count para que la bandeja muestre el badge de mensajes sin leer.
	// window_expires_at se renueva a 24h desde ahora: es la ventana de servicio al cliente
	// de WhatsApp (Meta solo permite texto libre si el cliente escribió en las últimas 24h;
	// pasado ese punto solo se pueden enviar plantillas). Antes de este fix nada escribía
	// esta columna, por lo que quedaba NULL para siempre y el envío de texto libre se
	// bloqueaba con "El cliente aún no ha iniciado conversación" aunque sí hubiera escrito.
	db.Exec(`UPDATE conversations SET last_message_at = NOW(), unread_count = unread_count + 1, window_expires_at = NOW() + INTERVAL '24 hours' WHERE id = ?`, conv.ID)

	// 6. Broadcast WebSocket — notificar bandeja de entrada y sala de conversación.
	// C-01: los canales van namespaceados por empresa para no filtrar datos entre tenants.
	companyID := resolveChannelCompanyID(db, &channel)
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

// statusRank ordena los estados de un mensaje saliente de menor a mayor avance,
// para no dejar que una actualización tardía o duplicada retroceda el estado
// (ej. un "delivered" que llega después de un "read" por reordenamiento de
// entregas del proveedor).
func statusRank(status string) int {
	switch status {
	case "sent":
		return 1
	case "delivered":
		return 2
	case "read":
		return 3
	default:
		return 0
	}
}

// UpdateMessageStatus busca un mensaje saliente por su external_id (el wamid de
// WhatsApp o el mid de Messenger/Instagram) y actualiza su status a partir del
// webhook de estado del proveedor (sent/delivered/read/failed), transmitiendo el
// cambio por WebSocket para que la burbuja del mensaje se actualice en vivo sin
// recargar. No hace nada si el mensaje no existe o si el nuevo estado no avanza
// sobre el actual.
//
// Cuándo se llama: desde los webhooks de WhatsApp (statuses[]) y Messenger/
// Instagram (evento delivery, que sí trae IDs concretos a diferencia de read).
func UpdateMessageStatus(db *gorm.DB, companyID uint, externalID, status string) {
	if externalID == "" {
		return
	}
	var msg models.Message
	if db.Where("external_id = ? AND direction = 'outbound'", externalID).First(&msg).Error != nil {
		return
	}
	if status != "failed" && statusRank(status) <= statusRank(msg.Status) {
		return
	}
	db.Model(&msg).Update("status", status)
	msg.Status = status
	ws.GlobalHub.Broadcast(chConversation(companyID, msg.ConversationID), "MessageStatusUpdated", msg)
}

// MarkOutboundReadBefore marca como leídos todos los mensajes salientes de la
// conversación entre companyID/channelID/contactPhone creados hasta watermark
// (inclusive). Existe porque el evento "read" de Messenger/Instagram no informa
// IDs de mensaje concretos como WhatsApp — solo una marca de tiempo que significa
// "todo lo enviado hasta este momento ya fue leído".
//
// Cuándo se llama: desde MessengerHandle/InstagramHandle al recibir un evento
// messaging[].read.
func MarkOutboundReadBefore(db *gorm.DB, companyID uint, channelID uint, contactPhone string, watermark time.Time) {
	var conv models.Conversation
	if db.Joins("JOIN contacts ON contacts.id = conversations.contact_id").
		Where("contacts.phone = ? AND conversations.channel_id = ?", contactPhone, channelID).
		Order("conversations.created_at DESC").First(&conv).Error != nil {
		return
	}
	result := db.Model(&models.Message{}).
		Where("conversation_id = ? AND direction = 'outbound' AND status != 'read' AND created_at <= ?", conv.ID, watermark).
		Update("status", "read")
	if result.RowsAffected > 0 {
		// A diferencia de UpdateMessageStatus, aquí se actualizan varios mensajes a
		// la vez: se avisa por conversación en vez de mandar cada fila individual.
		ws.GlobalHub.Broadcast(chConversation(companyID, conv.ID), "MessagesReadUntil", map[string]any{
			"conversation_id": conv.ID,
			"until":           watermark,
		})
	}
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

	// Base de conocimiento: inyectar el texto de los documentos activos del departamento de
	// la conversación (o globales) en el system prompt, acotado por el presupuesto del bot.
	kbBudget := botCfg.MaxContextChars
	if kbBudget <= 0 {
		kbBudget = 40000
	}
	if kb := buildKnowledgeContext(db, conv, kbBudget); kb != "" {
		systemPrompt += "\n\n=== BASE DE CONOCIMIENTO ===\nUsa la siguiente información para responder cuando aplique:\n\n" + kb
	}

	// Usar valores del config del bot o caer en los defaults razonables.
	maxTokens := 512
	model := botCfg.Model
	if model == "" {
		model = "claude-haiku-4-5-20251001"
	}

	// Memoria de conversación: historial reciente (no solo el último mensaje) para mantener
	// el hilo. Acotado a ~8k caracteres, aparte del presupuesto de la base de conocimiento.
	messages := buildBotMessages(db, conv.ID, 8000)
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

// buildKnowledgeContext arma el bloque de base de conocimiento para el system prompt:
// concatena el texto de los documentos activos y listos que aplican a la conversación
// (los del departamento de la conversación + los globales), acotado a maxChars.
func buildKnowledgeContext(db *gorm.DB, conv *models.Conversation, maxChars int) string {
	type kbDoc struct {
		Name          string
		ExtractedText string
	}
	var docs []kbDoc
	q := db.Table("bot_documents").
		Select("name, extracted_text").
		Where("is_active = true AND status = 'ready' AND extracted_text <> ''")
	if conv.DepartmentID != nil {
		q = q.Where("department_id = ? OR department_id IS NULL", *conv.DepartmentID)
	} else {
		q = q.Where("department_id IS NULL")
	}
	q.Order("id ASC").Scan(&docs)

	var b strings.Builder
	for _, d := range docs {
		block := "## " + d.Name + "\n" + strings.TrimSpace(d.ExtractedText) + "\n\n"
		if b.Len()+len(block) > maxChars {
			if rem := maxChars - b.Len(); rem > 0 {
				b.WriteString(block[:rem])
			}
			break
		}
		b.WriteString(block)
	}
	return strings.TrimSpace(b.String())
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

// resolveChannelCompanyID devuelve la empresa dueña del canal, corrigiendo la fila
// si hiciera falta.
//
// Los eventos de WebSocket se publican en canales namespaceados por empresa
// ("company.34.inbox"). El navegador se suscribe usando el company_id de su sesión,
// pero el servidor lo tomaba de channels.company_id -- una columna que CreateChannel
// nunca rellenaba, así que valía 0. Resultado: el servidor emitía a "company.0.*"
// mientras los navegadores escuchaban "company.34.*" y NINGÚN mensaje entrante
// llegaba en vivo. Se detectó con trazas en producción:
//
//	subscribe canal="company.34.conversation.7"
//	broadcast canal="company.0.conversation.7"  clientes=2 coincidencias=0
//
// La fuente confiable es channel_lookup (base del sistema), que asocia el public_id
// del canal con su empresa. Al resolverlo se corrige también la fila para que el
// siguiente mensaje no tenga que consultarlo de nuevo.
func resolveChannelCompanyID(db *gorm.DB, channel *models.Channel) uint {
	if channel.CompanyID != 0 {
		return channel.CompanyID
	}
	var resuelta uint
	database.SystemDB.Table("channel_lookup").
		Where("public_id = ?", channel.PublicID).
		Select("company_id").Scan(&resuelta)
	if resuelta == 0 {
		log.Printf("ERROR: el canal %d no tiene empresa asociada; los eventos en vivo no llegarán", channel.ID)
		return 0
	}
	db.Model(&models.Channel{}).Where("id = ?", channel.ID).Update("company_id", resuelta)
	channel.CompanyID = resuelta
	log.Printf("canal %d tenía company_id=0; corregido a %d", channel.ID, resuelta)
	return resuelta
}

// assignToAgent decide a quién le queda la conversación cuando llega un mensaje.
//
// Reglas:
//
//  1. Si ya la venía atendiendo un agente y ese agente sigue disponible (existe, no
//     está eliminado y está activo), la conversación SE QUEDA CON ÉL aunque esté
//     desconectado. La encontrará esperándolo al iniciar sesión. La continuidad con
//     la misma persona pesa más que repartir el mensaje a quien esté conectado.
//
//  2. Si ese agente fue eliminado o desactivado, la conversación queda SIN AGENTE en
//     la bandeja, para que cualquier agente se la autoasigne. No se reasigna sola a
//     otra persona: el mensaje entra a la cola común.
//
//  3. Si la conversación es nueva (nunca tuvo agente), se asigna a un agente activo
//     que esté conectado. Si no hay ninguno conectado queda en la cola común, sin
//     asignar, para que la tome quien entre.
//
// Cuándo se llama: al procesar un mensaje entrante, ya sea porque el bot está
// deshabilitado o porque decidió derivar a un humano.
func assignToAgent(db *gorm.DB, conv *models.Conversation, companyID uint) {
	// ── Regla 1 y 2: la conversación ya tenía dueño ──────────────────────────
	if conv.AgentID != nil {
		var previo models.User
		// Unscoped + chequeo manual de deleted_at: hace falta distinguir "el agente
		// no existe" de "existe pero fue eliminado", y con el scope por defecto de
		// GORM los eliminados ni siquiera se devuelven.
		db.Unscoped().First(&previo, conv.AgentID)

		disponible := previo.ID != 0 && !previo.DeletedAt.Valid && previo.IsActive
		if disponible {
			// Sigue siendo suya, esté o no conectado.
			db.Model(conv).Update("status", "open")
			broadcastConvUpdate(conv, companyID)
			return
		}

		// Eliminado o desactivado: liberar la conversación a la cola común.
		//
		// Se filtra por id en vez de usar Model(conv): con la estructura ya poblada
		// GORM no aplicaba el agent_id = NULL del mapa (el estado sí cambiaba pero el
		// agente seguía asignado). Esta es la misma forma que ya usa DeleteUser.
		db.Model(&models.Conversation{}).Where("id = ?", conv.ID).
			Updates(map[string]any{"agent_id": gorm.Expr("NULL"), "status": "pending"})
		conv.AgentID = nil
		conv.Status = models.ConvPending
		broadcastConvUpdate(conv, companyID)
		return
	}

	// ── Regla 3: conversación nueva, nunca tuvo agente ───────────────────────
	//
	// Solo se autoasigna a alguien CONECTADO: repartirla a un agente desconectado
	// que nunca la atendió la escondería en su bandeja sin que nadie la vea. Si no
	// hay nadie conectado se deja en la cola común y la toma quien entre.
	q := db.Model(&models.User{}).
		Where("role IN ('agent','supervisor') AND deleted_at IS NULL AND is_active = true AND is_online = true")
	if conv.DepartmentID != nil {
		q = q.Where("department_id = ?", *conv.DepartmentID)
	}

	var agent models.User
	q.Order("last_seen_at DESC").First(&agent)

	if agent.ID != 0 {
		db.Model(conv).Updates(map[string]any{
			"agent_id": agent.ID,
			"status":   "open",
		})
		conv.AgentID, conv.Status = &agent.ID, models.ConvOpen
		// Notificar al agente recién asignado para que aparezca en su cola.
		ws.GlobalHub.Broadcast(chUser(companyID, agent.ID), "ConversationAssigned", conv)
	} else {
		// Nadie conectado: queda en la cola común, sin asignar.
		db.Model(conv).Update("status", "pending")
		conv.Status = models.ConvPending
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
