package handlers

import (
	"net/http"

	"harmony-api/internal/database"
	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
)

func GetSmtpSettings(c *gin.Context) {
	db := database.SystemDB
	var setting models.SystemSetting
	if err := db.Where("key = ?", "smtp").First(&setting).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{}})
		return
	}
	// FIX: Enmascarar la contraseña antes de devolver la configuración SMTP
	masked := make(map[string]any)
	for k, v := range setting.Value {
		masked[k] = v
	}
	if pwd, ok := masked["password"].(string); ok && len(pwd) > 0 {
		masked["password"] = "••••••••"
	}
	c.JSON(http.StatusOK, gin.H{"data": masked})
}

func UpdateSmtpSettings(c *gin.Context) {
	db := database.SystemDB
	var req map[string]any
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	// Si el cliente envía el placeholder enmascarado, no sobreescribir la contraseña real
	if pwd, ok := req["password"].(string); ok && pwd == "••••••••" {
		var existing models.SystemSetting
		if err := db.Where("key = ?", "smtp").First(&existing).Error; err == nil {
			if existingPwd, ok := existing.Value["password"].(string); ok {
				req["password"] = existingPwd
			}
		}
	}

	setting := models.SystemSetting{Key: "smtp", Value: req}
	db.Where(models.SystemSetting{Key: "smtp"}).Assign(setting).FirstOrCreate(&setting)

	// Devolver la versión enmascarada también en la respuesta del guardado
	masked := make(map[string]any)
	for k, v := range req {
		masked[k] = v
	}
	if _, ok := masked["password"]; ok {
		masked["password"] = "••••••••"
	}
	c.JSON(http.StatusOK, gin.H{"data": masked})
}

func GetBrandingSettings(c *gin.Context) {
	db := database.SystemDB
	var setting models.SystemSetting
	if err := db.Where("key = ?", "branding").First(&setting).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"app_name":      "Harmony",
			"primary_color": "#6366F1",
			"logo_url":      "",
		}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": setting.Value})
}

func UpdateBrandingSettings(c *gin.Context) {
	db := database.SystemDB
	var req map[string]any
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	setting := models.SystemSetting{Key: "branding", Value: req}
	db.Where(models.SystemSetting{Key: "branding"}).Assign(setting).FirstOrCreate(&setting)
	c.JSON(http.StatusOK, gin.H{"data": req})
}
