package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"harmony-api/internal/models"
	"harmony-api/internal/senders"
	"harmony-api/internal/ws"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Template representa una plantilla de mensaje en el sistema.
// Las plantillas se usan para: (1) enviar mensajes cuando la ventana de 24h de WhatsApp
// ha expirado, (2) iniciar nuevas conversaciones proactivamente, y (3) campañas masivas.
//
// El campo VisibleToAgents controla si los agentes pueden ver y usar esta plantilla
// desde el inbox. Solo admin/supervisores pueden habilitar este flag.
type Template struct {
	ID                 uint       `gorm:"primarykey" json:"id"`
	CompanyID          uint       `gorm:"not null;index" json:"company_id"`
	DepartmentID       *uint      `json:"department_id"`
	ChannelType        string     `json:"channel_type"`
	Name               string     `json:"name"`
	Category           string     `json:"category"`
	Language           string     `json:"language"`
	Status             string     `json:"status"`
	Body               string     `json:"body"`
	HeaderType         string     `json:"header_type"`
	HeaderContent      string     `json:"header_content"`
	Footer             string     `json:"footer"`
	Buttons            []any      `gorm:"serializer:json" json:"buttons,omitempty"`
	Variables          []any      `gorm:"serializer:json" json:"variables,omitempty"`
	ExternalTemplateID string     `json:"external_template_id"`
	// RejectionReason guarda el motivo que devuelve Meta al rechazar la plantilla.
	// Sin esto el usuario ve "Rechazada" sin ninguna pista de qué corregir.
	RejectionReason    string     `json:"rejection_reason"`
	// VisibleToAgents indica si los agentes pueden ver y usar esta plantilla en el inbox.
	// Cuando false, solo admin/supervisores la ven en el módulo de plantillas.
	VisibleToAgents    bool       `json:"visible_to_agents"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	DeletedAt          *time.Time `gorm:"index" json:"-"`
}

func (Template) TableName() string { return "message_templates" }

// MarshalJSON agrega alias de los campos que el frontend ya consume con otro
// nombre (meta_status, agent_visible). Se resolvió acá y no renombrando las
// columnas para no romper el resto del backend ni exigir una migración de datos.
func (t Template) MarshalJSON() ([]byte, error) {
	type alias Template // evita recursión infinita al re-serializar
	return json.Marshal(struct {
		alias
		MetaStatus   string `json:"meta_status"`
		AgentVisible bool   `json:"agent_visible"`
	}{
		alias:        alias(t),
		MetaStatus:   t.Status,
		AgentVisible: t.VisibleToAgents,
	})
}

// chTemplates es el canal WebSocket donde se avisan los cambios de estado de las
// plantillas (aprobada/rechazada por Meta), namespaceado por empresa igual que el
// resto de canales para no filtrar datos entre tenants.
func chTemplates(companyID uint) string { return fmt.Sprintf("company.%d.templates", companyID) }

// whatsappChannelFor devuelve el canal de WhatsApp activo de la empresa, que es de
// donde salen el WABA ID y el token para hablar con la API de plantillas de Meta.
func whatsappChannelFor(db *gorm.DB) (*models.Channel, error) {
	var ch models.Channel
	err := db.Where("type = ? AND is_active = true AND deleted_at IS NULL", models.ChannelWhatsApp).
		Order("id ASC").First(&ch).Error
	if err != nil {
		return nil, fmt.Errorf("no hay un canal de WhatsApp activo configurado")
	}
	return &ch, nil
}

// pushTemplateToMeta registra la plantilla en Meta y deja la fila local reflejando
// exactamente lo que Meta respondió.
//
// Nunca devuelve el error hacia arriba como fatal: si Meta rechaza el alta, la
// plantilla queda guardada en estado 'draft' con el motivo real, de modo que el
// trabajo del usuario no se pierde y puede corregir y reintentar con el botón
// "Enviar a Meta".
func pushTemplateToMeta(db *gorm.DB, tpl *Template) error {
	ch, err := whatsappChannelFor(db)
	if err != nil {
		db.Model(tpl).Updates(map[string]any{"status": "draft", "rejection_reason": err.Error()})
		tpl.Status, tpl.RejectionReason = "draft", err.Error()
		return err
	}

	res, err := senders.CreateWhatsAppTemplate(ch, senders.TemplateSpec{
		Name:          tpl.Name,
		Language:      tpl.Language,
		Category:      tpl.Category,
		Body:          tpl.Body,
		HeaderType:    tpl.HeaderType,
		HeaderContent: tpl.HeaderContent,
		Footer:        tpl.Footer,
	})
	if err != nil {
		db.Model(tpl).Updates(map[string]any{"status": "draft", "rejection_reason": err.Error()})
		tpl.Status, tpl.RejectionReason = "draft", err.Error()
		return err
	}

	// Meta guarda la plantilla con el nombre normalizado (minúsculas y guiones bajos).
	// Hay que persistir ese mismo nombre: es el que se manda al enviar la plantilla.
	metaName := senders.NormalizeTemplateName(tpl.Name)
	updates := map[string]any{
		"external_template_id": res.ExternalID,
		"status":               res.Status,
		"rejection_reason":     "",
		"name":                 metaName,
	}
	if res.Category != "" {
		updates["category"] = res.Category
	}
	db.Model(tpl).Updates(updates)
	tpl.ExternalTemplateID, tpl.Status, tpl.RejectionReason, tpl.Name = res.ExternalID, res.Status, "", metaName
	if res.Category != "" {
		tpl.Category = res.Category
	}
	return nil
}

// ListTemplates devuelve todas las plantillas de la empresa (admin/supervisor).
// Los supervisores ven todas las plantillas de la empresa, igual que los admin.
// Para la vista de agentes (solo plantillas habilitadas), usar ListAvailableTemplates.
//
// Responde a: GET /templates
func ListTemplates(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var templates []Template
	db.Order("created_at DESC").Find(&templates)
	c.JSON(http.StatusOK, gin.H{"data": templates})
}

// ListAvailableTemplates devuelve las plantillas que un agente puede ver y usar en el inbox.
//
// Reglas de visibilidad:
//   - Solo plantillas con visible_to_agents=true y status='approved'
//   - Si la plantilla tiene department_id: solo la ve el agente de ese departamento
//   - Si la plantilla no tiene department_id (null): la ven todos los agentes
//
// Responde a: GET /templates/available
func ListAvailableTemplates(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	userID, _ := c.Get("user_id")

	// Obtener el departamento del agente autenticado
	var u struct{ DepartmentID *uint }
	db.Table("users").Select("department_id").Where("id = ?", userID).Scan(&u)

	query := db.Where("visible_to_agents = ? AND status = ?", true, "approved")
	if u.DepartmentID != nil {
		// Agente en un departamento: ve plantillas de su departamento + las globales (sin departamento)
		query = query.Where("department_id = ? OR department_id IS NULL", *u.DepartmentID)
	}
	// Agente sin departamento: ve todas las plantillas globales (department_id IS NULL ya incluye todo)

	var templates []Template
	query.Order("name ASC").Find(&templates)
	c.JSON(http.StatusOK, gin.H{"data": templates})
}

func CreateTemplate(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		Name        string `json:"name" binding:"required"`
		Body        string `json:"body" binding:"required"`
		Category    string `json:"category"`
		Language    string `json:"language"`
		ChannelType string `json:"channel_type"`
		HeaderType  string `json:"header_type"`
		Footer      string `json:"footer"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	channelType := req.ChannelType
	if channelType == "" {
		channelType = "whatsapp"
	}
	category := req.Category
	if category == "" {
		category = "UTILITY"
	}
	language := req.Language
	if language == "" {
		language = "es"
	}
	headerType := req.HeaderType
	if headerType == "" {
		headerType = "none"
	}
	tpl := Template{
		CompanyID:   c.GetUint("company_id"),
		Name:        req.Name,
		Body:        req.Body,
		Category:    category,
		Language:    language,
		ChannelType: channelType,
		HeaderType:  headerType,
		Footer:      req.Footer,
		Status:      "pending",
	}
	if err := db.Create(&tpl).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	// Registrar la plantilla en Meta de inmediato. Antes esto no ocurría: la
	// plantilla quedaba solo en la base local en estado "pending" para siempre, sin
	// entrar nunca a revisión y sin external_template_id -- de ahí la duda de "no sé
	// si se envió a Meta". Si Meta la rechaza, la plantilla NO se pierde: queda en
	// 'draft' con el motivo, y se responde 201 igual con ese detalle para que la UI
	// lo muestre y el usuario pueda corregir y reintentar.
	if err := pushTemplateToMeta(db, &tpl); err != nil {
		log.Printf("plantilla %d creada pero no aceptada por Meta: %v", tpl.ID, err)
		c.JSON(http.StatusCreated, gin.H{
			"data":         tpl,
			"meta_error":   err.Error(),
			"message":      "La plantilla se guardó pero Meta no la aceptó: " + err.Error(),
			"sent_to_meta": false,
		})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": tpl, "sent_to_meta": true})
}

// SubmitTemplate envía a Meta una plantilla que aún no llegó (estado 'draft') o
// reintenta una que falló. Responde a POST /templates/:id/submit -- la ruta que el
// botón "Enviar a Meta" del frontend ya llamaba pero que no existía en el backend
// (devolvía 404).
func SubmitTemplate(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var tpl Template
	if err := db.First(&tpl, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Plantilla no encontrada"})
		return
	}
	if tpl.ExternalTemplateID != "" {
		c.JSON(http.StatusConflict, gin.H{
			"message": "Esta plantilla ya está registrada en Meta. Use Sincronizar para actualizar su estado.",
			"data":    tpl,
		})
		return
	}
	if err := pushTemplateToMeta(db, &tpl); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error(), "data": tpl})
		return
	}
	broadcastTemplateUpdate(c.GetUint("company_id"), &tpl)
	c.JSON(http.StatusOK, gin.H{"data": tpl, "message": "Plantilla enviada a Meta para revisión"})
}

// SyncTemplateStatus le pregunta a Meta el estado actual de la plantilla.
// Es el respaldo del webhook message_template_status_update: si ese aviso no llega
// (la app de Meta no está suscrita al campo, o el webhook se cayó), esto reconcilia
// el estado bajo demanda. Responde a POST /templates/:id/sync.
func SyncTemplateStatus(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var tpl Template
	if err := db.First(&tpl, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Plantilla no encontrada"})
		return
	}
	if tpl.ExternalTemplateID == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"message": "Esta plantilla todavía no se ha enviado a Meta.", "data": tpl,
		})
		return
	}
	ch, err := whatsappChannelFor(db)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	status, reason, err := senders.FetchWhatsAppTemplateStatus(ch, tpl.Name)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"message": err.Error()})
		return
	}
	db.Model(&tpl).Updates(map[string]any{"status": status, "rejection_reason": reason})
	tpl.Status, tpl.RejectionReason = status, reason
	broadcastTemplateUpdate(c.GetUint("company_id"), &tpl)
	c.JSON(http.StatusOK, gin.H{"data": tpl})
}

// ToggleAgentVisible alterna si los agentes ven la plantilla en el inbox.
// Responde a POST /templates/:id/toggle-agent-visible -- otra ruta que el frontend
// ya llamaba y que tampoco existía (404).
func ToggleAgentVisible(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var tpl Template
	if err := db.First(&tpl, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Plantilla no encontrada"})
		return
	}
	db.Model(&tpl).Update("visible_to_agents", !tpl.VisibleToAgents)
	tpl.VisibleToAgents = !tpl.VisibleToAgents
	c.JSON(http.StatusOK, gin.H{"data": tpl})
}

// applyTemplateStatusUpdate procesa el aviso message_template_status_update que
// manda Meta cuando una plantilla cambia de estado, y empuja el cambio por WebSocket.
//
// Es la pieza que hace que el estado se vea "en tiempo real": sin esto, la plantilla
// se quedaba en Pendiente en la pantalla aunque Meta ya la hubiera aprobado o
// rechazado horas antes.
//
// Requiere que la app de Meta esté suscrita al campo "message_template_status_update"
// en el webhook de la cuenta de WhatsApp. Si no lo está, Meta nunca envía este aviso
// y el estado solo se actualiza con el botón Sincronizar.
func applyTemplateStatusUpdate(db *gorm.DB, companyID uint, templateName, event, reason string) {
	if templateName == "" {
		return
	}
	var tpl Template
	// Meta informa el nombre normalizado; se busca sin distinguir mayúsculas por si
	// la fila local quedó guardada con el nombre original antes de este cambio.
	if err := db.Where("LOWER(name) = LOWER(?)", templateName).First(&tpl).Error; err != nil {
		log.Printf("webhook de plantilla: no se encontró \"%s\" en la empresa %d", templateName, companyID)
		return
	}

	status := senders.MetaTemplateStatus(event)
	updates := map[string]any{"status": status}
	// El motivo solo aplica al rechazo; en una aprobación hay que limpiarlo para que
	// no quede colgado el texto de un rechazo anterior.
	if status == "rejected" {
		updates["rejection_reason"] = reason
	} else {
		updates["rejection_reason"] = ""
	}
	if err := db.Model(&tpl).Updates(updates).Error; err != nil {
		log.Printf("webhook de plantilla: no se pudo actualizar \"%s\": %v", templateName, err)
		return
	}
	tpl.Status = status
	tpl.RejectionReason, _ = updates["rejection_reason"].(string)
	log.Printf("plantilla \"%s\" (empresa %d) pasó a estado %s por aviso de Meta", templateName, companyID, status)
	broadcastTemplateUpdate(companyID, &tpl)
}

// broadcastTemplateUpdate empuja el nuevo estado de la plantilla por WebSocket para
// que la pantalla de Plantillas lo refleje sin recargar ni esperar un refetch.
func broadcastTemplateUpdate(companyID uint, tpl *Template) {
	ws.GlobalHub.Broadcast(chTemplates(companyID), "TemplateStatusUpdated", map[string]any{
		"id":               tpl.ID,
		"status":           tpl.Status,
		"meta_status":      tpl.Status,
		"rejection_reason": tpl.RejectionReason,
		"name":             tpl.Name,
	})
}

func UpdateTemplate(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	var tpl Template
	if err := db.First(&tpl, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Plantilla no encontrada"})
		return
	}
	var req struct {
		Name            string `json:"name"`
		Body            string `json:"body"`
		Category        string `json:"category"`
		Language        string `json:"language"`
		ChannelType     string `json:"channel_type"`
		HeaderType      string `json:"header_type"`
		Footer          string `json:"footer"`
		// VisibleToAgents se envía como bool; se usa puntero para distinguir "no enviado" de false
		VisibleToAgents *bool  `json:"visible_to_agents"`
	}
	c.ShouldBindJSON(&req)
	updates := map[string]any{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Body != "" {
		updates["body"] = req.Body
	}
	if req.Category != "" {
		updates["category"] = req.Category
	}
	if req.Language != "" {
		updates["language"] = req.Language
	}
	if req.ChannelType != "" {
		updates["channel_type"] = req.ChannelType
	}
	if req.HeaderType != "" {
		updates["header_type"] = req.HeaderType
	}
	if req.Footer != "" {
		updates["footer"] = req.Footer
	}
	// VisibleToAgents se actualiza siempre que se envíe (puede ser false intencionalmente)
	if req.VisibleToAgents != nil {
		updates["visible_to_agents"] = *req.VisibleToAgents
	}
	db.Model(&tpl).Updates(updates)
	c.JSON(http.StatusOK, gin.H{"data": tpl})
}

func DeleteTemplate(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	db.Delete(&Template{}, id)
	c.JSON(http.StatusNoContent, nil)
}
