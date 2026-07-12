package handlers

import (
	"net/http"
	"time"

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
	// VisibleToAgents indica si los agentes pueden ver y usar esta plantilla en el inbox.
	// Cuando false, solo admin/supervisores la ven en el módulo de plantillas.
	VisibleToAgents    bool       `json:"visible_to_agents"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	DeletedAt          *time.Time `gorm:"index" json:"-"`
}

func (Template) TableName() string { return "message_templates" }

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
	c.JSON(http.StatusCreated, gin.H{"data": tpl})
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
