package handlers

import (
	"net/http"
	"time"

	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type HistorySettings struct {
	ID              uint       `gorm:"primarykey" json:"id"`
	CompanyID       uint       `json:"company_id"`
	Enabled         bool       `json:"enabled"`
	RetentionDays   *int       `json:"retention_days"`
	SuperadminMaxDays *int     `json:"superadmin_max_days"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (HistorySettings) TableName() string { return "history_settings" }

// GET /settings/history
func GetHistorySettings(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	var s HistorySettings
	if err := db.First(&s).Error; err != nil {
		// Return defaults if not configured
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"enabled":             false,
			"retention_days":      nil,
			"superadmin_max_days": nil,
		}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": s})
}

// PUT /settings/history
func UpdateHistorySettings(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	var body struct {
		Enabled       bool  `json:"enabled"`
		RetentionDays *int  `json:"retention_days"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Datos inválidos"})
		return
	}

	var s HistorySettings
	if err := db.First(&s).Error; err != nil {
		s = HistorySettings{Enabled: body.Enabled, RetentionDays: body.RetentionDays}
		db.Create(&s)
	} else {
		db.Model(&s).Updates(map[string]any{
			"enabled":        body.Enabled,
			"retention_days": body.RetentionDays,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": s, "message": "Configuración guardada"})
}

// GET /settings/history/preview?from=2024-01-01&to=2024-12-31
func PreviewHistoryDelete(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	from := c.Query("from")
	to := c.Query("to")
	if from == "" || to == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Los parámetros from y to son requeridos"})
		return
	}

	var count int64
	db.Model(&models.Conversation{}).
		Where("status = 'closed' AND DATE(created_at) >= ? AND DATE(created_at) <= ?", from, to).
		Count(&count)

	c.JSON(http.StatusOK, gin.H{"count": count, "from": from, "to": to})
}

// DELETE /settings/history/conversations
func DeleteHistoryConversations(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.From == "" || body.To == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Los parámetros from y to son requeridos"})
		return
	}

	var convIDs []uint
	db.Model(&models.Conversation{}).
		Where("status = 'closed' AND DATE(created_at) >= ? AND DATE(created_at) <= ?", body.From, body.To).
		Pluck("id", &convIDs)

	if len(convIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{"deleted": 0})
		return
	}

	// Delete messages, then conversations
	db.Where("conversation_id IN ?", convIDs).Delete(&models.Message{})
	result := db.Where("id IN ?", convIDs).Delete(&models.Conversation{})

	c.JSON(http.StatusOK, gin.H{"deleted": result.RowsAffected})
}
