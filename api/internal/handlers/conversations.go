// Package handlers contiene los controladores HTTP de la API de Harmony v3.
// Este archivo gestiona todo el ciclo de vida de las conversaciones omnicanal:
// listado con filtros por rol/estado, creación manual, envío de mensajes con
// validación de ventana WhatsApp de 24h, asignación de agentes, cierre/reapertura,
// etiquetado, reasignación masiva y consulta de historial por contacto.
package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"harmony-api/internal/models"
	"harmony-api/internal/ws"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// canAgentAccessConv aplica el control de acceso por rol sobre una conversación (A-01).
// Los agentes solo pueden operar sobre conversaciones propias o sin asignar; los roles
// admin/supervisor tienen acceso completo dentro de su empresa.
func canAgentAccessConv(c *gin.Context, conv *models.Conversation) bool {
	if c.GetString("role") != "agent" {
		return true
	}
	uid := c.GetUint("user_id")
	return conv.AgentID == nil || *conv.AgentID == uid
}

// loadConvForAgent carga la conversación por :id y verifica el acceso del agente.
// Escribe la respuesta de error (404/403) y devuelve ok=false si no procede continuar.
func loadConvForAgent(c *gin.Context, db *gorm.DB) (models.Conversation, bool) {
	var conv models.Conversation
	if err := db.First(&conv, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Conversación no encontrada"})
		return conv, false
	}
	if !canAgentAccessConv(c, &conv) {
		c.JSON(http.StatusForbidden, gin.H{"message": "Sin acceso a esta conversación"})
		return conv, false
	}
	return conv, true
}

// ListConversations devuelve la lista paginada de conversaciones activas (open/pending)
// para la empresa autenticada, aplicando filtros de rol, estado y búsqueda de texto.
//
// Parámetros de query:
//   - status: "open" | "unread" | "all" (default "all")
//   - q: texto libre para buscar por nombre/teléfono del contacto o número de caso
//   - page: número de página (default 1), tamaño fijo de 30 registros
//
// Responde con:
//
//	{ data: []Conversation, total: int, page: int, counts: { open, pending, unread } }
//
// Los counts se calculan respetando también el filtro por rol del agente, de forma
// que cada agente solo ve sus propios contadores en la barra lateral.
func ListConversations(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	status := c.DefaultQuery("status", "all")
	q := strings.TrimSpace(c.Query("q"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit := 30
	offset := (page - 1) * limit

	// Leer rol y user_id del token JWT, inyectados por el middleware de autenticación
	role := c.GetString("role")
	userID, _ := c.Get("user_id")

	// JOIN con contacts para poder filtrar por nombre/teléfono en la búsqueda de texto
	base := db.Model(&models.Conversation{}).
		Joins("LEFT JOIN contacts ON contacts.id = conversations.contact_id")

	// Agente puede ver sus conversaciones asignadas + las sin asignar (para autoasignarse)
	// Los supervisores y admins ven todas las conversaciones de la empresa
	if role == "agent" {
		base = base.Where("(conversations.agent_id = ? OR conversations.agent_id IS NULL)", userID)
	}

	switch status {
	case "open":
		// "Abiertos" = open Y ya leídas (unread_count = 0)
		// Separar "open" de "unread" evita duplicar conversaciones en la UI del inbox
		base = base.Where("conversations.status = 'open' AND conversations.unread_count = 0")
	case "unread":
		// "No leídos" = open + pending con mensajes sin leer
		// Incluye pending porque un mensaje entrante en pendiente también es "no leído"
		base = base.Where("conversations.status IN ('open','pending') AND conversations.unread_count > 0")
	default: // "all" — open + pending para todos (agentes también ven pendientes sin asignar)
		base = base.Where("conversations.status IN ('open','pending')")
	}

	// Búsqueda de texto libre: cubre nombre del contacto, su teléfono y el número de caso
	if q != "" {
		like := "%" + q + "%"
		base = base.Where(
			"contacts.name ILIKE ? OR contacts.phone ILIKE ? OR conversations.case_number ILIKE ?",
			like, like, like,
		)
	}

	// Contar total ANTES del Limit/Offset para devolver la paginación correcta
	var total int64
	base.Count(&total)

	var convs []models.Conversation
	// Ordenar igual que v2: primero no leídas (mayor urgencia), luego por actividad reciente
	// NULLS LAST evita que conversaciones sin mensajes aparezcan al tope
	base.Preload("Contact").Preload("Agent").Preload("Channel").Preload("Tags").
		Order("conversations.unread_count DESC, conversations.last_message_at DESC NULLS LAST").
		Limit(limit).Offset(offset).Find(&convs)

	// Garantizar slice vacío (no null) en JSON para que el frontend no tenga que hacer nil-check en Tags
	for i := range convs {
		if convs[i].Tags == nil {
			convs[i].Tags = []models.Tag{}
		}
	}

	// Calcular counts filtrados por agente si corresponde, para los badges de la barra lateral
	var openCount, unreadCount, allCount int64

	agentFilter := func(d *gorm.DB) *gorm.DB {
		if role == "agent" {
			return d.Where("agent_id = ? OR agent_id IS NULL", userID)
		}
		return d
	}

	// all = todas las abiertas (solo status open), para el tab "Todos"
	db.Model(&models.Conversation{}).Scopes(agentFilter).
		Where("status = 'open'").Count(&allCount)

	// open = abiertas ya leídas (sin mensajes pendientes de leer)
	db.Model(&models.Conversation{}).Scopes(agentFilter).
		Where("status = 'open' AND unread_count = 0").Count(&openCount)

	// unread = abiertas con mensajes no leídos
	db.Model(&models.Conversation{}).Scopes(agentFilter).
		Where("status = 'open' AND unread_count > 0").Count(&unreadCount)

	c.JSON(http.StatusOK, gin.H{
		"data":  convs,
		"total": total,
		"page":  page,
		"counts": gin.H{
			"all":    allCount,
			"open":   openCount,
			"unread": unreadCount,
		},
	})
}

// CreateConversation crea una nueva conversación de forma manual desde la UI
// (por ejemplo, cuando un agente quiere iniciar contacto proactivo con un cliente).
//
// Parámetros JSON del body:
//   - contact_id: ID del contacto existente (opcional si se proveen contact_phone/contact_name)
//   - contact_name: nombre del contacto a crear si no existe
//   - contact_phone: teléfono; se usa para buscar un contacto existente antes de crear uno nuevo
//   - channel_id: ID del canal por el que se enviará (requerido)
//   - department_id: departamento asignado (opcional)
//   - agent_id: agente asignado (opcional; si no se asigna queda en estado "pending")
//   - case_number: número de caso personalizado (se autogenera si está vacío)
//   - message: cuerpo del primer mensaje a crear junto con la conversación (opcional)
//
// Responde con 201 y la conversación creada, con relaciones Contact y Channel precargadas.
func CreateConversation(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		ContactID    uint   `json:"contact_id"`
		ContactName  string `json:"contact_name"`
		ContactPhone string `json:"contact_phone"`
		ChannelID    uint   `json:"channel_id" binding:"required"`
		DepartmentID *uint  `json:"department_id"`
		AgentID      *uint  `json:"agent_id"`
		CaseNumber   string `json:"case_number"`
		Message      string `json:"message"`
		TemplateID   *uint  `json:"template_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	// Si no hay contact_id, buscar por teléfono o crear nuevo contacto
	// Esto permite crear conversaciones desde la UI sin necesidad de preseleccionar un contacto
	if req.ContactID == 0 {
		if req.ContactPhone == "" {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Se requiere contact_id o contact_phone"})
			return
		}
		var contact models.Contact
		// El contacto se identifica por teléfono + canal porque el mismo número puede existir
		// en múltiples canales (ej. WhatsApp y Facebook) como contactos separados
		db.Where("phone = ? AND channel_id = ?", req.ContactPhone, req.ChannelID).First(&contact)
		if contact.ID == 0 {
			// No existe: crear el contacto on-the-fly para no bloquear el flujo del agente
			contact = models.Contact{
				ChannelID: req.ChannelID,
				Name:      req.ContactName,
				Phone:     req.ContactPhone,
			}
			db.Create(&contact)
		}
		req.ContactID = contact.ID
	}

	// Generar número de caso único si no se proporcionó
	// Se usa UnixNano en milisegundos para garantizar unicidad sin consultar la BD
	caseNumber := req.CaseNumber
	if caseNumber == "" {
		caseNumber = fmt.Sprintf("CASE-%d", time.Now().UnixNano()/1e6)
	}

	conv := models.Conversation{
		CompanyID:    c.GetUint("company_id"),
		ContactID:    req.ContactID,
		ChannelID:    req.ChannelID,
		DepartmentID: req.DepartmentID,
		AgentID:      req.AgentID,
		CaseNumber:   caseNumber,
		// Estado inicial siempre "open" porque es el agente quien inicia la conversación
		Status: models.ConvOpen,
	}
	if err := db.Create(&conv).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	// Si se eligió una plantilla, usarla como primer mensaje (tipo "template")
	// Si no, usar el texto libre de req.Message si se proporcionó
	firstMsgBody := req.Message
	firstMsgType := "text"
	if req.TemplateID != nil {
		var tpl Template
		if db.First(&tpl, *req.TemplateID).Error == nil {
			firstMsgBody = tpl.Body
			firstMsgType = "template"
		}
	}
	if firstMsgBody != "" {
		msg := models.Message{
			ConversationID: conv.ID,
			Body:           firstMsgBody,
			Direction:      "outbound",
			Status:         "sent",
			Type:           firstMsgType,
		}
		db.Create(&msg)
	}

	// Precargar relaciones para devolver la conversación completa al frontend
	db.Preload("Contact").Preload("Channel").First(&conv, conv.ID)
	c.JSON(http.StatusCreated, gin.H{"data": conv})
}

// GetConversation obtiene una conversación individual por su ID, con todas las
// relaciones necesarias para renderizar el panel de detalle en la UI.
//
// Parámetros de ruta:
//   - :id — ID de la conversación
//
// Responde con 200 y la conversación completa (Contact, Agent, Channel, Tags),
// o 404 si no existe.
func GetConversation(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	var conv models.Conversation
	if err := db.Preload("Contact").Preload("Agent").Preload("Channel").Preload("Tags").
		First(&conv, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Conversación no encontrada"})
		return
	}
	// FIX: IDOR — los agentes solo pueden ver sus propias conversaciones o las sin asignar
	if role := c.GetString("role"); role == "agent" {
		userID := c.GetUint("user_id")
		if conv.AgentID != nil && *conv.AgentID != userID {
			c.JSON(http.StatusForbidden, gin.H{"message": "Sin acceso a esta conversación"})
			return
		}
	}
	if conv.Tags == nil {
		conv.Tags = []models.Tag{}
	}
	c.JSON(http.StatusOK, gin.H{"data": conv})
}

// ListMessages devuelve los mensajes de una conversación en orden cronológico ascendente,
// paginados de 50 en 50. El orden ASC permite al frontend agregar mensajes nuevos
// al final del scroll sin necesidad de invertir el array.
//
// Parámetros de ruta:
//   - :id — ID de la conversación
//
// Parámetros de query:
//   - page: número de página (default 1)
//
// Responde con { data: []Message, total: int }.
func ListMessages(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	// A-01: verificar que el agente tenga acceso a la conversación antes de listar sus mensajes.
	if _, ok := loadConvForAgent(c, db); !ok {
		return
	}
	convID := c.Param("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit := 50
	offset := (page - 1) * limit

	var total int64
	var messages []models.Message
	db.Model(&models.Message{}).Where("conversation_id = ?", convID).Count(&total)
	db.Where("conversation_id = ?", convID).
		Preload("Attachments").
		Order("created_at ASC").
		Limit(limit).Offset(offset).Find(&messages)

	c.JSON(http.StatusOK, gin.H{"data": messages, "total": total})
}

// SendMessage envía un mensaje de texto (o plantilla) dentro de una conversación existente.
// Antes de crear el registro valida la ventana de 24h de WhatsApp para evitar errores
// de la API de Meta al intentar enviar texto libre fuera de la ventana de sesión.
//
// Parámetros de ruta:
//   - :id — ID de la conversación
//
// Parámetros JSON del body:
//   - body: contenido del mensaje (requerido)
//   - type: "text" | "template" | "image" | etc. (default "text")
//   - template_id: ID de la plantilla aprobada; si se provee, se omite la validación de ventana
//
// Responde con 201 y el mensaje creado, o 422 si la ventana WhatsApp está cerrada/expirada.
func SendMessage(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	convID := c.Param("id")
	var req struct {
		Body       string `json:"body" binding:"required"`
		Type       string `json:"type"`
		TemplateID *uint  `json:"template_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	// Normalizar tipo: si el frontend no lo envía, asumir texto plano
	if req.Type == "" {
		req.Type = "text"
	}

	// Cargar conversación con canal para validar ventana WhatsApp
	var conv models.Conversation
	if err := db.Preload("Channel").First(&conv, convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Conversación no encontrada"})
		return
	}
	// FIX: IDOR — los agentes solo pueden enviar mensajes en sus propias conversaciones
	if role := c.GetString("role"); role == "agent" {
		userID := c.GetUint("user_id")
		if conv.AgentID != nil && *conv.AgentID != userID {
			c.JSON(http.StatusForbidden, gin.H{"message": "Sin acceso a esta conversación"})
			return
		}
	}

	// Validar ventana de 24h de WhatsApp antes de enviar
	// Meta solo permite mensajes de texto libre si el cliente escribió en las últimas 24h.
	// Las plantillas (HSM) sí se pueden enviar en cualquier momento porque son pre-aprobadas.
	if conv.Channel != nil && conv.Channel.Type == models.ChannelWhatsApp {
		// Determinar si el mensaje es una plantilla (puede saltarse la restricción de ventana)
		isTemplate := req.TemplateID != nil || req.Type == "template"
		if !isTemplate {
			if conv.WindowExpiresAt == nil {
				// Cliente nunca inició conversación → la ventana no existe, solo plantillas permitidas
				c.JSON(http.StatusUnprocessableEntity, gin.H{
					"message":    "El cliente aún no ha iniciado conversación. Envía una plantilla de WhatsApp.",
					"error_code": "window_not_open",
				})
				return
			}
			if time.Now().After(*conv.WindowExpiresAt) {
				// Ventana expirada: el último mensaje del cliente tiene más de 24h
				// Devolvemos expired_at para que el frontend muestre cuándo venció
				c.JSON(http.StatusUnprocessableEntity, gin.H{
					"message":    "La ventana de 24h de WhatsApp ha expirado. Solo se pueden enviar plantillas aprobadas.",
					"error_code": "window_expired",
					"expired_at": conv.WindowExpiresAt,
				})
				return
			}
		}
	}

	// Convertir convID string a uint para el campo ConversationID del mensaje
	convIDUint, _ := strconv.ParseUint(convID, 10, 64)
	msg := models.Message{
		ConversationID: uint(convIDUint),
		Body:           req.Body,
		Type:           req.Type,
		Direction:      "outbound",
		Status:         "sent",
	}
	if err := db.Create(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	// Actualizar last_message_at de la conversación para mantener el orden en el listado
	// Se usa Exec directo para evitar disparar hooks de GORM innecesariamente
	db.Exec(`UPDATE conversations SET last_message_at = NOW() WHERE id = ?`, convIDUint)

	// M-28: emitir el mensaje por WebSocket para que otros agentes que tengan abierta la
	// conversación (o la bandeja) lo vean en tiempo real sin recargar. Canales
	// namespaceados por empresa (C-01).
	// NOTA: el envío real al proveedor (Meta/Telegram) se encola aparte; aquí solo se
	// persiste y difunde el mensaje dentro de Harmony.
	companyID := c.GetUint("company_id")
	ws.GlobalHub.Broadcast(chConversation(companyID, uint(convIDUint)), "MessageReceived", msg)
	ws.GlobalHub.Broadcast(chInbox(companyID), "MessageReceived", map[string]any{
		"conversation_id": uint(convIDUint),
		"message":         msg,
	})

	c.JSON(http.StatusCreated, gin.H{"data": msg})
}

// AssignConversation asigna (o reasigna) un agente y/o departamento a una conversación.
// Al asignar un agente, el estado pasa automáticamente a "open" para que desaparezca
// de la cola de pendientes y quede en la bandeja del agente.
//
// Parámetros de ruta:
//   - :id — ID de la conversación
//
// Parámetros JSON del body:
//   - agent_id: ID del agente a asignar (opcional; si se omite, solo cambia el departamento)
//   - department_id: ID del departamento (opcional)
//
// Responde con 200 y mensaje "Asignado".
func AssignConversation(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	// A-01: un agente solo puede (re)asignar conversaciones propias o sin asignar.
	if _, ok := loadConvForAgent(c, db); !ok {
		return
	}
	var req struct {
		AgentID      *uint `json:"agent_id"`
		DepartmentID *uint `json:"department_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	// Construir mapa dinámico para actualizar solo los campos recibidos
	updates := map[string]any{}
	if req.AgentID != nil {
		updates["agent_id"] = req.AgentID
		// Al asignar agente, mover de "pending" a "open" automáticamente
		updates["status"] = "open"
	}
	if req.DepartmentID != nil {
		updates["department_id"] = req.DepartmentID
	}
	db.Model(&models.Conversation{}).Where("id = ?", id).Updates(updates)
	c.JSON(http.StatusOK, gin.H{"message": "Asignado"})
}

// CloseConversation marca una conversación como cerrada.
// Una conversación cerrada ya no aparece en el inbox activo y se puede
// consultar desde el historial (ChatHistory).
//
// Parámetros de ruta:
//   - :id — ID de la conversación
//
// Responde con 200 y mensaje "Cerrado".
func CloseConversation(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	// A-01: un agente solo puede cerrar conversaciones propias o sin asignar.
	if _, ok := loadConvForAgent(c, db); !ok {
		return
	}
	db.Model(&models.Conversation{}).Where("id = ?", id).Update("status", models.ConvClosed)
	c.JSON(http.StatusOK, gin.H{"message": "Cerrado"})
}

// UpdateConversationTags reemplaza el conjunto completo de etiquetas de una conversación.
// Usa Association.Replace para hacer un diff automático: agrega las nuevas y quita las
// que ya no están en la lista, sin necesidad de gestionar la tabla pivot manualmente.
//
// Parámetros de ruta:
//   - :id — ID de la conversación
//
// Parámetros JSON del body:
//   - tag_ids: []uint — lista de IDs de tags a asociar (vacío = quitar todas las etiquetas)
//
// Responde con 200 y mensaje "Tags actualizados", o 404 si la conversación no existe.
func UpdateConversationTags(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	var req struct {
		TagIDs []uint `json:"tag_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	var conv models.Conversation
	if err := db.First(&conv, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "No encontrado"})
		return
	}
	// A-01: un agente solo puede etiquetar conversaciones propias o sin asignar.
	if !canAgentAccessConv(c, &conv) {
		c.JSON(http.StatusForbidden, gin.H{"message": "Sin acceso a esta conversación"})
		return
	}
	var tags []models.Tag
	if len(req.TagIDs) > 0 {
		// Cargar los objetos Tag por sus IDs antes de pasárselos a Replace
		db.Find(&tags, req.TagIDs)
	}
	// Replace actualiza la tabla pivot conversations_tags en una sola operación
	db.Model(&conv).Association("Tags").Replace(&tags)
	c.JSON(http.StatusOK, gin.H{"message": "Tags actualizados"})
}

// BulkReassign reasigna masivamente conversaciones de un agente a otro.
// Es útil cuando un agente sale de turno o se desactiva: permite redistribuir
// toda su carga de trabajo a otro agente (o tomar conversaciones sin asignar).
//
// Parámetros JSON del body:
//   - from_agent_id: ID del agente origen (si es null, toma las conversaciones sin asignar)
//   - to_agent_id: ID del agente destino (requerido)
//   - statuses: []string — filtrar solo conversaciones en ciertos estados (opcional;
//     si está vacío, afecta todos los estados)
//
// Responde con 200, mensaje "Reasignadas" y el número de conversaciones afectadas.
func BulkReassign(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	// A-01: la reasignación masiva es una operación administrativa; un agente no puede
	// redistribuir la carga de otros agentes.
	if c.GetString("role") == "agent" {
		c.JSON(http.StatusForbidden, gin.H{"message": "Operación no permitida para agentes"})
		return
	}
	var req struct {
		FromAgentID *uint    `json:"from_agent_id"`
		ToAgentID   *uint    `json:"to_agent_id"`
		Statuses    []string `json:"statuses"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	if req.ToAgentID == nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "to_agent_id requerido"})
		return
	}
	q := db.Model(&models.Conversation{})
	if req.FromAgentID != nil {
		// Reasignar conversaciones del agente origen
		q = q.Where("agent_id = ?", req.FromAgentID)
	} else {
		// Si no hay from_agent_id, tomar las conversaciones huérfanas (sin agente asignado)
		q = q.Where("agent_id IS NULL")
	}
	if len(req.Statuses) > 0 {
		// Permite limitar la reasignación solo a conversaciones "pending" o "open", por ejemplo
		q = q.Where("status IN (?)", req.Statuses)
	}
	// Contar antes de actualizar para devolver cuántas filas se vieron afectadas
	var count int64
	q.Count(&count)
	// Al reasignar forzamos status "open" para sacar las conversaciones de la cola de pendientes
	q.Updates(map[string]any{"agent_id": req.ToAgentID, "status": "open"})
	c.JSON(http.StatusOK, gin.H{"message": "Reasignadas", "count": count})
}

// ChatHistory busca el historial de conversaciones CERRADAS de un contacto específico.
// Recibe los parámetros opcionales ?name= y ?phone= para localizar al contacto.
// Devuelve { contact, conversations: { data, total, current_page, last_page } }
// para que el frontend pueda mostrar la ficha del contacto junto a sus casos.
//
// Parámetros de query:
//   - name: nombre parcial del contacto (búsqueda ILIKE)
//   - phone: teléfono parcial del contacto (búsqueda ILIKE)
//   - page: número de página (default 1), tamaño fijo de 25 registros
//
// Si no se envían name ni phone, devuelve la lista general de conversaciones cerradas
// sin filtrar por contacto (útil para la vista de "Historial" global).
func ChatHistory(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	name := strings.TrimSpace(c.Query("name"))
	phone := strings.TrimSpace(c.Query("phone"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	limit := 25
	offset := (page - 1) * limit

	// Si no se proporciona ningún filtro, devolver lista general de cerradas (sin contacto)
	// Permite navegar el historial completo desde la vista de administración
	if name == "" && phone == "" {
		var total int64
		var convs []models.Conversation
		db.Model(&models.Conversation{}).Where("status = ?", models.ConvClosed).Count(&total)
		db.Where("status = ?", models.ConvClosed).
			Preload("Contact").Preload("Agent").Preload("Channel").Preload("Tags").
			Order("updated_at DESC").
			Limit(limit).Offset(offset).Find(&convs)
		for i := range convs {
			if convs[i].Tags == nil {
				convs[i].Tags = []models.Tag{}
			}
		}
		// Calcular last_page manualmente para la paginación del frontend
		lastPage := int(total) / limit
		if int(total)%limit != 0 {
			lastPage++
		}
		if lastPage < 1 {
			lastPage = 1
		}
		c.JSON(http.StatusOK, gin.H{
			"contact": nil,
			"conversations": gin.H{
				"data":         convs,
				"total":        total,
				"current_page": page,
				"last_page":    lastPage,
			},
		})
		return
	}

	// Buscar contacto por nombre o teléfono (búsqueda parcial con ILIKE)
	// Se pueden combinar ambos filtros para una búsqueda más precisa
	contactQ := db.Model(&models.Contact{})
	if phone != "" {
		contactQ = contactQ.Where("phone ILIKE ?", "%"+phone+"%")
	}
	if name != "" {
		contactQ = contactQ.Where("name ILIKE ?", "%"+name+"%")
	}
	var contact models.Contact
	if err := contactQ.First(&contact).Error; err != nil {
		// Contacto no encontrado → respuesta vacía coherente con lo que espera el frontend
		// Evitar devolver 404 para que el componente React no entre en estado de error
		c.JSON(http.StatusOK, gin.H{
			"contact":       nil,
			"conversations": gin.H{"data": []any{}, "total": 0, "current_page": 1, "last_page": 1},
		})
		return
	}

	// Solo conversaciones CERRADAS del contacto (cada caso cerrado es un histórico)
	var total int64
	db.Model(&models.Conversation{}).
		Where("contact_id = ? AND status = ?", contact.ID, models.ConvClosed).Count(&total)

	var convs []models.Conversation
	db.Where("contact_id = ? AND status = ?", contact.ID, models.ConvClosed).
		Preload("Agent").Preload("Channel").Preload("Tags").
		Order("updated_at DESC").
		Limit(limit).Offset(offset).Find(&convs)

	for i := range convs {
		if convs[i].Tags == nil {
			convs[i].Tags = []models.Tag{}
		}
	}

	// Calcular last_page para devolver metadatos de paginación completos al frontend
	lastPage := int(total) / limit
	if int(total)%limit != 0 {
		lastPage++
	}
	if lastPage < 1 {
		lastPage = 1
	}

	c.JSON(http.StatusOK, gin.H{
		"contact": contact,
		"conversations": gin.H{
			"data":         convs,
			"total":        total,
			"current_page": page,
			"last_page":    lastPage,
		},
	})
}

// ReopenConversation reabre una conversación que estaba cerrada, poniéndola de nuevo
// en estado "pending" y quitando el agente asignado para que vuelva a la cola.
// Solo se puede reabrir si la conversación está efectivamente cerrada; de lo contrario
// se devuelve 422 para evitar estados inconsistentes.
//
// Parámetros de ruta:
//   - :id — ID de la conversación (PUT /conversations/:id/reopen)
//
// Responde con 200 y la conversación actualizada, o 404/422 según el caso.
func ReopenConversation(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	var conv models.Conversation
	if err := db.First(&conv, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Conversación no encontrada"})
		return
	}
	// A-01: un agente solo puede reabrir conversaciones propias o sin asignar.
	if !canAgentAccessConv(c, &conv) {
		c.JSON(http.StatusForbidden, gin.H{"message": "Sin acceso a esta conversación"})
		return
	}
	// Verificar que realmente esté cerrada antes de cambiar el estado
	if conv.Status != models.ConvClosed {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "La conversación no está cerrada"})
		return
	}
	// Pasar a "pending" y limpiar agente para que cualquier agente disponible pueda tomarla
	db.Model(&conv).Updates(map[string]any{
		"status":   models.ConvPending,
		"agent_id": nil,
	})
	c.JSON(http.StatusOK, gin.H{"message": "Conversación reabierta", "data": conv})
}

// MarkConversationRead pone unread_count = 0 en una conversación,
// indicando que el agente ya leyó todos los mensajes pendientes.
// Solo actualiza si hay mensajes no leídos (unread_count > 0) para evitar
// escrituras innecesarias en la BD.
//
// Parámetros de ruta:
//   - :id — ID de la conversación (PUT /conversations/:id/mark-read)
//
// El user_id del agente autenticado se guarda (aunque no se use aún) para
// una futura tabla de auditoría de lecturas por agente.
//
// Responde con 200 y { message: "ok" }.
func MarkConversationRead(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	userID := c.GetUint("user_id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "ID inválido"})
		return
	}
	// A-01: un agente solo puede marcar como leídas conversaciones propias o sin asignar.
	if _, ok := loadConvForAgent(c, db); !ok {
		return
	}
	// Actualizar solo si hay mensajes no leídos para minimizar writes en la BD
	db.Exec("UPDATE conversations SET unread_count = 0, updated_at = NOW() WHERE id = ? AND unread_count > 0", id)
	_ = userID // reservado para auditoría futura (registro de quién y cuándo leyó)
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}
