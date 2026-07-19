package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"harmony-api/internal/config"
	"harmony-api/internal/database"
	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ── Modelos ───────────────────────────────────────────────────────────────────

type BotConfig struct {
	ID                  uint      `gorm:"primarykey" json:"id"`
	CompanyID           uint      `json:"company_id"`
	DepartmentID        *uint     `json:"department_id"`
	IsEnabled           bool      `gorm:"column:is_enabled" json:"is_enabled"`
	Model               string    `json:"model"`
	Instructions        string    `json:"instructions"`
	MaxContextChars     int       `json:"max_context_chars"`
	HumanTakeover       bool      `json:"human_takeover"`
	MaxDailyResponses   int       `json:"max_daily_responses"`
	ChannelIDs          []byte    `gorm:"type:jsonb" json:"-"`
	UseAllDocs          bool      `json:"use_all_docs"`
	UpdatedAt           time.Time `json:"updated_at"`
}

func (BotConfig) TableName() string { return "bot_configs" }

type BotDocument struct {
	ID            uint      `gorm:"primarykey" json:"id"`
	CompanyID     uint      `json:"company_id"`
	Name          string    `json:"name"`
	OriginalName  string    `gorm:"column:original_name" json:"original_name"`
	AzurePath     string    `gorm:"column:azure_path" json:"-"` // ruta local (columna reutilizada)
	MimeType      string    `gorm:"column:mime_type" json:"mime_type"`
	Size          int64     `json:"size"`
	Status        string    `json:"status"`
	ErrorMessage  string    `gorm:"column:error_message" json:"error_message"`
	ExtractedText string    `gorm:"column:extracted_text" json:"-"` // nunca se expone en JSON
	IsActive      bool      `gorm:"column:is_active" json:"is_active"`
	DepartmentID  *uint     `gorm:"column:department_id" json:"department_id"`
	CreatedAt     time.Time `json:"created_at"`
}

func (BotDocument) TableName() string { return "bot_documents" }

// BotDocumentResp es la forma que consume el frontend (incluye nombre de departamento).
type BotDocumentResp struct {
	ID             uint      `json:"id"`
	Name           string    `json:"name"`
	FileType       string    `json:"file_type"`
	FileSize       int64     `json:"file_size"`
	Status         string    `json:"status"`
	IsActive       bool      `json:"is_active"`
	DepartmentID   *uint     `json:"department_id"`
	DepartmentName string    `json:"department_name"`
	ErrorMessage   string    `json:"error_message"`
	CreatedAt      time.Time `json:"created_at"`
}

// ── Tipos de respuesta ────────────────────────────────────────────────────────

type BotDeptConfig struct {
	DepartmentID      int    `json:"department_id"`
	DepartmentName    string `json:"department_name"`
	Enabled           bool   `json:"enabled"`
	Model             string `json:"model"`
	Instructions      string `json:"instructions"`
	MaxContextChars   int    `json:"max_context_chars"`
	HumanTakeover     bool   `json:"human_takeover"`
	MaxDailyResponses int    `json:"max_daily_responses"`
	ChannelIDs        []int  `json:"channel_ids"`
	UseAllDocs        bool   `json:"use_all_docs"`
}

type BotChannel struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type BotSettingsResponse struct {
	HasAPIKey   bool            `json:"has_api_key"`
	Departments []BotDeptConfig `json:"departments"`
	Channels    []BotChannel    `json:"channels"`
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// GetBotSettings devuelve la configuración del bot por departamento,
// la lista de canales activos y si la API key está configurada.
func GetBotSettings(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	// Departamentos
	var depts []struct {
		ID   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	db.Table("departments").Select("id, name").Order("name ASC").Scan(&depts)

	// Configs existentes indexadas por dept_id
	var configs []BotConfig
	db.Where("department_id IS NOT NULL").Find(&configs)
	configByDept := make(map[int]*BotConfig, len(configs))
	for i := range configs {
		if configs[i].DepartmentID != nil {
			configByDept[int(*configs[i].DepartmentID)] = &configs[i]
		}
	}

	deptList := make([]BotDeptConfig, 0, len(depts))
	for _, d := range depts {
		cfg, ok := configByDept[d.ID]
		dc := BotDeptConfig{
			DepartmentID:      d.ID,
			DepartmentName:    d.Name,
			Enabled:           false,
			Model:             "claude-opus-4-8",
			Instructions:      "",
			MaxContextChars:   80000,
			HumanTakeover:     true,
			MaxDailyResponses: 50,
			ChannelIDs:        []int{},
			UseAllDocs:        true,
		}
		if ok {
			dc.Enabled = cfg.IsEnabled
			dc.Model = cfg.Model
			dc.Instructions = cfg.Instructions
			dc.MaxContextChars = cfg.MaxContextChars
			dc.HumanTakeover = cfg.HumanTakeover
			dc.MaxDailyResponses = cfg.MaxDailyResponses
			dc.UseAllDocs = cfg.UseAllDocs
			// Parsear channel_ids JSONB
			if len(cfg.ChannelIDs) > 0 {
				var ids []int
				if err := unmarshalJSON(cfg.ChannelIDs, &ids); err == nil {
					dc.ChannelIDs = ids
				}
			}
			if dc.Model == "" {
				dc.Model = "claude-opus-4-8"
			}
			if dc.MaxContextChars == 0 {
				dc.MaxContextChars = 80000
			}
			if dc.MaxDailyResponses == 0 {
				dc.MaxDailyResponses = 50
			}
		}
		deptList = append(deptList, dc)
	}

	// Canales activos
	var channels []BotChannel
	db.Table("channels").Select("id, name, type").Where("is_active = true").Order("name ASC").Scan(&channels)
	if channels == nil {
		channels = []BotChannel{}
	}

	// ¿Hay una key usable? La empresa puede tener la suya (cifrada en companies) o caer
	// en la global del .env. has_api_key indica que el bot tiene con qué responder.
	hasKey := config.App.AnthropicKey != ""
	var company models.Company
	if database.SystemDB.First(&company, c.GetUint("company_id")).Error == nil && company.AnthropicAPIKey != "" {
		hasKey = true
	}

	c.JSON(http.StatusOK, BotSettingsResponse{
		HasAPIKey:   hasKey,
		Departments: deptList,
		Channels:    channels,
	})
}

// SaveBotDepartment guarda la configuración del bot para un departamento específico.
func SaveBotDepartment(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	deptID, err := strconv.Atoi(c.Param("deptId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "department_id inválido"})
		return
	}

	var req struct {
		Model             string `json:"model"`
		Instructions      string `json:"instructions"`
		MaxContextChars   int    `json:"max_context_chars"`
		HumanTakeover     bool   `json:"human_takeover"`
		MaxDailyResponses int    `json:"max_daily_responses"`
		ChannelIDs        []int  `json:"channel_ids"`
		UseAllDocs        bool   `json:"use_all_docs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	deptIDUint := uint(deptID)
	var cfg BotConfig
	db.Where("department_id = ?", deptID).First(&cfg)
	isNew := cfg.ID == 0
	if isNew {
		cfg.DepartmentID = &deptIDUint
	}

	channelJSON, _ := marshalJSON(req.ChannelIDs)
	model := req.Model
	if model == "" {
		model = "claude-opus-4-8"
	}
	maxCtx := req.MaxContextChars
	if maxCtx == 0 {
		maxCtx = 80000
	}
	maxDaily := req.MaxDailyResponses
	if maxDaily == 0 {
		maxDaily = 50
	}

	updates := map[string]any{
		"model":               model,
		"instructions":        req.Instructions,
		"max_context_chars":   maxCtx,
		"human_takeover":      req.HumanTakeover,
		"max_daily_responses": maxDaily,
		"channel_ids":         channelJSON,
		"use_all_docs":        req.UseAllDocs,
	}

	if isNew {
		cfg.Model = model
		cfg.Instructions = req.Instructions
		cfg.MaxContextChars = maxCtx
		cfg.HumanTakeover = req.HumanTakeover
		cfg.MaxDailyResponses = maxDaily
		cfg.ChannelIDs = channelJSON
		cfg.UseAllDocs = req.UseAllDocs
		db.Create(&cfg)
	} else {
		db.Model(&cfg).Updates(updates)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Configuración guardada"})
}

// ToggleBotDepartment activa/desactiva el bot para un departamento.
func ToggleBotDepartment(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	deptID, err := strconv.Atoi(c.Param("deptId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "department_id inválido"})
		return
	}

	deptIDUint := uint(deptID)
	var cfg BotConfig
	db.Where("department_id = ?", deptID).First(&cfg)
	if cfg.ID == 0 {
		// Crear con defaults
		cfg = BotConfig{
			DepartmentID:      &deptIDUint,
			IsEnabled:         true,
			Model:             "claude-opus-4-8",
			MaxContextChars:   80000,
			HumanTakeover:     true,
			MaxDailyResponses: 50,
			UseAllDocs:        true,
		}
		db.Create(&cfg)
	} else {
		db.Model(&cfg).Update("is_enabled", !cfg.IsEnabled)
		cfg.IsEnabled = !cfg.IsEnabled
	}

	c.JSON(http.StatusOK, gin.H{"enabled": cfg.IsEnabled})
}

// SaveBotAPIKey guarda la API key de Anthropic propia de la empresa, cifrada en reposo.
// Se almacena en companies.anthropic_api_key (harmony_system) con el serializer AES-256,
// no en la DB de la empresa. Una key vacía borra la propia y vuelve al fallback global.
func SaveBotAPIKey(c *gin.Context) {
	var req struct {
		APIKey string `json:"api_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "api_key requerida"})
		return
	}

	var company models.Company
	if err := database.SystemDB.First(&company, c.GetUint("company_id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Empresa no encontrada"})
		return
	}
	company.AnthropicAPIKey = strings.TrimSpace(req.APIKey)
	if err := database.SystemDB.Save(&company).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al guardar la API key: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "API key guardada"})
}

// UpdateBotSettings — mantenido por compatibilidad (no usado en la nueva UI)
func UpdateBotSettings(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// ── Documentos ────────────────────────────────────────────────────────────────

func ListBotDocuments(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")
	resp := make([]BotDocumentResp, 0)
	db.Table("bot_documents AS bd").
		Select(`bd.id, bd.name, bd.mime_type AS file_type, bd.size AS file_size, bd.status,
			bd.is_active, bd.department_id, COALESCE(d.name, '') AS department_name,
			bd.error_message, bd.created_at`).
		Joins("LEFT JOIN departments d ON d.id = bd.department_id").
		Where("bd.company_id = ?", companyID).
		Order("bd.created_at DESC").
		Scan(&resp)
	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// extensiones de documento permitidas en la base de conocimiento.
var allowedDocExt = map[string]bool{".txt": true, ".md": true, ".csv": true, ".docx": true, ".pdf": true}

func UploadBotDocument(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Archivo requerido"})
		return
	}
	const maxDocBytes = 10 << 20 // 10 MB
	if file.Size > maxDocBytes {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "El documento supera el límite de 10 MB"})
		return
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if !allowedDocExt[ext] {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Formato no soportado. Usa TXT, MD, CSV, DOCX o PDF"})
		return
	}

	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		name = file.Filename
	}
	var deptID *uint
	if s := c.PostForm("department_id"); s != "" {
		if v, e := strconv.ParseUint(s, 10, 64); e == nil && v > 0 {
			u := uint(v)
			deptID = &u
		}
	}

	// Guardar el archivo en disco (uploads/company_{id}/bot/).
	dir := fmt.Sprintf("uploads/company_%d/bot", companyID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al crear directorio"})
		return
	}
	savePath := filepath.Join(dir, fmt.Sprintf("%d_%s%s", time.Now().UnixNano(), sanitizeFilename(name), ext))
	if err := c.SaveUploadedFile(file, savePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al guardar el archivo"})
		return
	}

	// Extraer el texto; si falla, el documento queda 'failed' pero se conserva el registro.
	status, errMsg := "ready", ""
	text, exErr := extractText(savePath, ext)
	if exErr != nil {
		status, errMsg = "failed", exErr.Error()
	} else if strings.TrimSpace(text) == "" {
		status, errMsg = "failed", "No se pudo extraer texto del documento"
	}

	doc := BotDocument{
		CompanyID:     companyID,
		Name:          name,
		OriginalName:  file.Filename,
		AzurePath:     savePath,
		MimeType:      strings.TrimPrefix(ext, "."),
		Size:          file.Size,
		Status:        status,
		ErrorMessage:  errMsg,
		ExtractedText: text,
		IsActive:      status == "ready",
		DepartmentID:  deptID,
	}
	if err := db.Create(&doc).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al registrar el documento: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Documento cargado",
		"data":    gin.H{"id": doc.ID, "status": status, "error_message": errMsg},
	})
}

func DeleteBotDocument(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")
	var doc BotDocument
	if err := db.Where("id = ? AND company_id = ?", c.Param("id"), companyID).First(&doc).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Documento no encontrado"})
		return
	}
	if doc.AzurePath != "" {
		os.Remove(doc.AzurePath) // borrar el archivo del disco (ignorar si ya no existe)
	}
	db.Delete(&BotDocument{}, doc.ID)
	c.JSON(http.StatusNoContent, nil)
}

// ToggleBotDocumentActive activa/desactiva un documento en la base de conocimiento.
func ToggleBotDocumentActive(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")
	var doc BotDocument
	if err := db.Where("id = ? AND company_id = ?", c.Param("id"), companyID).First(&doc).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Documento no encontrado"})
		return
	}
	db.Model(&doc).Update("is_active", !doc.IsActive)
	c.JSON(http.StatusOK, gin.H{"is_active": !doc.IsActive})
}

// sanitizeFilename deja solo caracteres seguros para nombre de archivo en disco.
func sanitizeFilename(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 40 {
		out = out[:40]
	}
	if out == "" {
		out = "doc"
	}
	return out
}

// ── Helpers JSON ──────────────────────────────────────────────────────────────

func unmarshalJSON(data []byte, v any) error {
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}

func marshalJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}
