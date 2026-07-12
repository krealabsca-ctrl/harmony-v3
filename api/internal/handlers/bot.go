package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

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
	ID        uint      `gorm:"primarykey" json:"id"`
	CompanyID uint      `json:"company_id"`
	Name      string    `json:"name"`
	AzurePath string    `json:"azure_path"`
	MimeType  string    `json:"mime_type"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

func (BotDocument) TableName() string { return "bot_documents" }

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

	// ¿Tiene API key? Buscar en system_settings
	var apiKeySetting struct {
		Value string `gorm:"column:value"`
	}
	db.Table("system_settings").Select("value").Where("key = ?", "anthropic_api_key").First(&apiKeySetting)

	c.JSON(http.StatusOK, BotSettingsResponse{
		HasAPIKey:   apiKeySetting.Value != "",
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

// SaveBotAPIKey guarda la API key de Anthropic en system_settings.
func SaveBotAPIKey(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		APIKey string `json:"api_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "api_key requerida"})
		return
	}

	// Upsert en system_settings
	db.Exec(`INSERT INTO system_settings (key, value, updated_at)
		VALUES ('anthropic_api_key', ?, NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		req.APIKey)

	c.JSON(http.StatusOK, gin.H{"message": "API key guardada"})
}

// UpdateBotSettings — mantenido por compatibilidad (no usado en la nueva UI)
func UpdateBotSettings(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// ── Documentos ────────────────────────────────────────────────────────────────

func ListBotDocuments(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	docs := make([]BotDocument, 0)
	db.Find(&docs)
	c.JSON(http.StatusOK, gin.H{"data": docs})
}

func UploadBotDocument(c *gin.Context) {
	c.JSON(http.StatusCreated, gin.H{"message": "Documento recibido"})
}

func DeleteBotDocument(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	db.Delete(&BotDocument{}, id)
	c.JSON(http.StatusNoContent, nil)
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
