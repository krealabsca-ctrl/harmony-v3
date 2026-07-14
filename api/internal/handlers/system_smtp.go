package handlers

import (
	"fmt"
	"net/http"

	"harmony-api/internal/database"
	"harmony-api/internal/models"
	"harmony-api/internal/services"

	"github.com/gin-gonic/gin"
)

// GetSystemSmtp devuelve la configuración SMTP global (superadmin)
func GetSystemSmtp(c *gin.Context) {
	var setting models.SystemSetting
	if err := database.SystemDB.Where("key = ?", "smtp").First(&setting).Error; err != nil {
		// Retornar defaults vacíos si no existe
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"host":       "",
			"port":       587,
			"user":       "",
			"pass":       "••••••••",
			"from_name":  "",
			"from_email": "",
			"encryption": "starttls",
		}})
		return
	}

	// Mascarar la contraseña
	if setting.Value != nil {
		if pass, ok := setting.Value["pass"]; ok && pass != "" {
			setting.Value["pass"] = "••••••••"
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": setting.Value})
}

// UpdateSystemSmtp actualiza la configuración SMTP global (superadmin)
func UpdateSystemSmtp(c *gin.Context) {
	var input map[string]any
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"errors": err.Error()})
		return
	}

	// Obtener config anterior para preservar la contraseña si no se proporciona
	var oldSetting models.SystemSetting
	oldPassword := ""
	if err := database.SystemDB.Where("key = ?", "smtp").First(&oldSetting).Error; err == nil {
		if oldSetting.Value != nil {
			if pass, ok := oldSetting.Value["pass"].(string); ok {
				oldPassword = pass
			}
		}
	}

	// Si la contraseña es el placeholder de masking, recuperar la anterior
	if pass, ok := input["pass"].(string); ok && (pass == "••••••••" || pass == "") {
		if oldPassword != "" && oldPassword != "••••••••" {
			input["pass"] = oldPassword
		}
	}

	// Upsert
	result := database.SystemDB.Model(&models.SystemSetting{}).
		Where("key = ?", "smtp").
		Updates(map[string]any{"value": input})

	if result.RowsAffected == 0 {
		database.SystemDB.Create(&models.SystemSetting{
			Key:   "smtp",
			Value: input,
		})
	}

	// Devolver sin la contraseña real
	if input != nil {
		input["pass"] = "••••••••"
	}

	c.JSON(http.StatusOK, gin.H{"data": input, "message": "Configuración SMTP guardada"})
}

// TestSystemSmtp envía un correo de prueba (superadmin)
func TestSystemSmtp(c *gin.Context) {
	var input struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Email inválido"})
		return
	}

	htmlBody := `
	<html>
	<body style="font-family: Arial, sans-serif; background-color: #f5f5f5;">
		<div style="max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px;">
			<h2 style="color: #333;">✓ Prueba de configuración SMTP</h2>
			<p style="color: #666;">Si recibiste este correo, tu configuración SMTP es correcta.</p>
			<p style="color: #999; font-size: 12px; margin-top: 20px;">
				Enviado desde Harmony v3 — Sistema de Gestión Omnicanal
			</p>
		</div>
	</body>
	</html>
	`

	if err := services.Send(input.Email, "Prueba de configuración SMTP — Harmony", htmlBody); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Error al enviar: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Correo de prueba enviado a " + input.Email})
}

// GetRetentionTemplate devuelve la plantilla del aviso de retención
func GetRetentionTemplate(c *gin.Context) {
	var setting models.SystemSetting
	if err := database.SystemDB.Where("key = ?", "retention_email_template").First(&setting).Error; err != nil {
		// Retornar defaults
		defaults := gin.H{
			"subject":    "Tu información será eliminada — {{empresa}}",
			"body_html": `<html><body style="font-family: Arial, sans-serif;">
<p>Hola {{encargado}},</p>
<p>Las conversaciones cerradas más antiguas de {{dias}} días en tu empresa <strong>{{empresa}}</strong> serán eliminadas el <strong>{{fecha_eliminacion}}</strong>.</p>
<p>Tienes hasta el <strong>{{fecha_limite}}</strong> para descargar o archivar cualquier información importante.</p>
<p>Saludos,<br>Harmony</p>
</body></html>`,
		}
		c.JSON(http.StatusOK, gin.H{"data": defaults})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": setting.Value})
}

// UpdateRetentionTemplate actualiza la plantilla del aviso de retención
func UpdateRetentionTemplate(c *gin.Context) {
	var input struct {
		Subject   string `json:"subject" binding:"required"`
		BodyHtml  string `json:"body_html" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"errors": err.Error()})
		return
	}

	template := map[string]any{
		"subject":    input.Subject,
		"body_html": input.BodyHtml,
	}

	result := database.SystemDB.Model(&models.SystemSetting{}).
		Where("key = ?", "retention_email_template").
		Updates(map[string]any{"value": template})

	if result.RowsAffected == 0 {
		database.SystemDB.Create(&models.SystemSetting{
			Key:   "retention_email_template",
			Value: template,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"data":    template,
		"message": "Plantilla guardada. Variables disponibles: {{empresa}}, {{encargado}}, {{dias}}, {{fecha_limite}}, {{fecha_eliminacion}}",
	})
}
