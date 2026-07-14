package jobs

import (
	"log"
	"strings"
	"time"

	"harmony-api/internal/database"
	"harmony-api/internal/models"
	"harmony-api/internal/services"
)

// Run inicia el job de retención de historial (se ejecuta cada hora)
func Run() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		processRetention()
	}
}

func processRetention() {
	var companies []models.Company
	if err := database.SystemDB.Where("is_active = true AND db_name != '' AND retention_days > 0").
		Find(&companies).Error; err != nil {
		log.Printf("WARN [retention] error listing companies: %v", err)
		return
	}

	for _, company := range companies {
		companyDB, err := database.GetCompanyDB(company.ID, company.DBName)
		if err != nil {
			log.Printf("WARN [retention] unable to connect to company %d: %v", company.ID, err)
			continue
		}

		// Contar conversaciones cerradas más viejas que la retención
		cutoffDate := time.Now().AddDate(0, 0, -company.RetentionDays)
		var count int64
		if err := companyDB.Model(&models.Conversation{}).
			Where("status = 'closed' AND created_at < ?", cutoffDate).
			Count(&count).Error; err != nil {
			log.Printf("WARN [retention] error counting conversations for company %d: %v", company.ID, err)
			continue
		}

		if count == 0 {
			// Nada que hacer, pero si antes estaba en "warned", resetear
			if company.RetentionWarnedAt != nil {
				database.SystemDB.Model(&company).Update("retention_warned_at", nil)
			}
			continue
		}

		// Máquina de estados
		if company.RetentionWarnedAt == nil {
			// Primera vez: enviar aviso
			sendRetentionWarning(company, cutoffDate)
			database.SystemDB.Model(&company).Update("retention_warned_at", time.Now())
		} else if time.Since(*company.RetentionWarnedAt) >= 5*24*time.Hour {
			// Ya pasaron 5 días desde el aviso: purgar
			purgeRetentionConversations(company, cutoffDate)
			database.SystemDB.Model(&company).Update("retention_warned_at", nil)
		}
	}
}

func sendRetentionWarning(company models.Company, cutoffDate time.Time) {
	if company.ContactEmail == "" {
		log.Printf("WARN [retention] company %d has no contact_email, skipping warning", company.ID)
		return
	}

	// Obtener plantilla
	var setting models.SystemSetting
	defaultTemplate := map[string]string{
		"subject": "Tu información será eliminada — " + company.Name,
		"body_html": `<html><body style="font-family: Arial, sans-serif;">
<p>Hola {{encargado}},</p>
<p>Las conversaciones cerradas más antiguas de {{dias}} días en tu empresa <strong>{{empresa}}</strong> serán eliminadas el <strong>{{fecha_eliminacion}}</strong>.</p>
<p>Tienes hasta el <strong>{{fecha_limite}}</strong> para descargar o archivar cualquier información importante.</p>
<p>Saludos,<br>Harmony</p>
</body></html>`,
	}

	template := defaultTemplate
	if err := database.SystemDB.Where("key = ?", "retention_email_template").First(&setting).Error; err == nil {
		if subject, ok := setting.Value["subject"].(string); ok {
			template["subject"] = subject
		}
		if bodyHtml, ok := setting.Value["body_html"].(string); ok {
			template["body_html"] = bodyHtml
		}
	}

	// Calcular fechas
	deletionDate := cutoffDate.AddDate(0, 0, 5)
	warningDate := time.Now().AddDate(0, 0, 5)

	// Renderizar plantilla
	subject := template["subject"]
	subject = strings.ReplaceAll(subject, "{{empresa}}", company.Name)
	subject = strings.ReplaceAll(subject, "{{encargado}}", company.ContactName)
	subject = strings.ReplaceAll(subject, "{{dias}}", string(rune(company.RetentionDays)))
	subject = strings.ReplaceAll(subject, "{{fecha_limite}}", warningDate.Format("2006-01-02"))
	subject = strings.ReplaceAll(subject, "{{fecha_eliminacion}}", deletionDate.Format("2006-01-02"))

	bodyHtml := template["body_html"]
	bodyHtml = strings.ReplaceAll(bodyHtml, "{{empresa}}", company.Name)
	bodyHtml = strings.ReplaceAll(bodyHtml, "{{encargado}}", company.ContactName)
	bodyHtml = strings.ReplaceAll(bodyHtml, "{{dias}}", string(rune(company.RetentionDays)))
	bodyHtml = strings.ReplaceAll(bodyHtml, "{{fecha_limite}}", warningDate.Format("2006-01-02"))
	bodyHtml = strings.ReplaceAll(bodyHtml, "{{fecha_eliminacion}}", deletionDate.Format("2006-01-02"))

	// Enviar
	if err := services.Send(company.ContactEmail, subject, bodyHtml); err != nil {
		log.Printf("WARN [retention] failed to send warning email to %s (company %d): %v",
			company.ContactEmail, company.ID, err)
		// NO interrumpir; la purga igual se ejecutará al cumplirse el plazo
	} else {
		log.Printf("INFO [retention] warning email sent to %s (company %d)", company.ContactEmail, company.ID)
	}
}

func purgeRetentionConversations(company models.Company, cutoffDate time.Time) {
	companyDB, err := database.GetCompanyDB(company.ID, company.DBName)
	if err != nil {
		log.Printf("WARN [retention] unable to connect to company %d for purge: %v", company.ID, err)
		return
	}

	// Buscar conversaciones cerradas vencidas
	var convIDs []uint
	if err := companyDB.Model(&models.Conversation{}).
		Where("status = 'closed' AND created_at < ?", cutoffDate).
		Pluck("id", &convIDs).Error; err != nil {
		log.Printf("WARN [retention] error listing conversations for purge (company %d): %v", company.ID, err)
		return
	}

	if len(convIDs) == 0 {
		log.Printf("INFO [retention] no conversations to purge for company %d", company.ID)
		return
	}

	// Borrar mensajes
	if err := companyDB.Where("conversation_id IN ?", convIDs).Delete(&models.Message{}).Error; err != nil {
		log.Printf("WARN [retention] error deleting messages for company %d: %v", company.ID, err)
		return
	}

	// Borrar conversaciones
	result := companyDB.Where("id IN ?", convIDs).Delete(&models.Conversation{})
	if result.Error != nil {
		log.Printf("WARN [retention] error deleting conversations for company %d: %v", company.ID, result.Error)
		return
	}

	log.Printf("INFO [retention] purged %d conversations from company %d", result.RowsAffected, company.ID)
}
