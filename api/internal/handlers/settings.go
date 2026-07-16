package handlers

import (
	"net/http"

	"harmony-api/internal/database"
	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
)

// La configuración SMTP se gestiona exclusivamente desde el superadmin
// ("Correo del Sistema", ver handlers/system_smtp.go). Los antiguos handlers
// GetSmtpSettings/UpdateSmtpSettings del lado empresa se eliminaron porque
// escribían sobre la misma cuenta global y duplicaban esa funcionalidad.

func GetBrandingSettings(c *gin.Context) {
	db := database.SystemDB
	var setting models.SystemSetting
	if err := db.Where("key = ?", "branding").First(&setting).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"system_name":     "Harmony",
			"primary_color":   "#4F46E5",
			"secondary_color": "#7C3AED",
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
