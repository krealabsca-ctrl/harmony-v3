package jobs

import (
	"fmt"
	"log"
	"strings"
	"time"

	"harmony-api/internal/database"
	"harmony-api/internal/models"
	"harmony-api/internal/senders"

	"gorm.io/gorm"
)

/*
 * Envío de campañas.
 *
 * Antes de esto, iniciar una campaña solo escribía status='running' en la fila y no
 * ocurría nada más: no se enviaba ningún mensaje, no se registraba la fecha de inicio
 * y ningún proceso miraba las campañas. Quedaban "en ejecución" para siempre con 0
 * enviados.
 *
 * Este worker recorre las campañas en ejecución y les va enviando la plantilla a sus
 * destinatarios pendientes. Decisiones de diseño:
 *
 *   - Va por lotes y con una pausa entre mensajes. Meta limita la cadencia de envío
 *     y una ráfaga hace que rechace mensajes o marque el número; es preferible tardar
 *     un poco más que quemar la reputación del número.
 *   - Por cada envío se crea contacto, conversación y mensaje, igual que un mensaje
 *     saliente normal. Así la respuesta del cliente entra en la MISMA conversación y
 *     los acuses de recibo (entregado/leído) encuentran el mensaje por su external_id.
 *   - Relee el estado de la campaña en cada lote: si alguien la cancela desde la UI,
 *     el envío se detiene en el siguiente lote en vez de seguir hasta el final.
 *   - Es reanudable: el avance vive en campaign_recipients.status, así que si el
 *     servidor se reinicia a mitad de una campaña, retoma por donde iba sin repetir
 *     envíos.
 */

const (
	// Intervalo entre revisiones de campañas pendientes de enviar.
	campaignTick = 10 * time.Second
	// Destinatarios que se procesan por vuelta antes de releer el estado de la
	// campaña (permite reaccionar rápido a una cancelación).
	campaignBatch = 25
	// Pausa entre mensajes: ~5 por segundo, cómodamente por debajo de los límites
	// de Meta para no arriesgar el número.
	campaignSendDelay = 200 * time.Millisecond
)

// RunCampaigns es el loop del enviador de campañas. Se arranca desde main.
func RunCampaigns() {
	ticker := time.NewTicker(campaignTick)
	defer ticker.Stop()
	for range ticker.C {
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("PANIC en el envío de campañas: %v", r)
				}
			}()
			procesarCampanas()
		}()
	}
}

func procesarCampanas() {
	var empresas []models.Company
	if err := database.SystemDB.Where("is_active = true AND db_name != ''").Find(&empresas).Error; err != nil {
		log.Printf("campañas: no se pudo listar empresas: %v", err)
		return
	}

	for _, empresa := range empresas {
		db, err := database.GetCompanyDB(empresa.ID, empresa.DBName)
		if err != nil {
			continue
		}
		activarProgramadas(db)

		var pendientes []uint
		db.Table("campaigns").
			Where("status = 'running' AND deleted_at IS NULL").
			Order("id ASC").Pluck("id", &pendientes)

		for _, id := range pendientes {
			enviarCampana(db, empresa.ID, id)
		}
	}
}

// activarProgramadas pasa a 'running' las campañas cuya fecha programada ya llegó.
func activarProgramadas(db *gorm.DB) {
	db.Table("campaigns").
		Where("status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW() AND deleted_at IS NULL").
		Updates(map[string]any{"status": "running", "started_at": time.Now()})
}

// campanaFila son los datos de la campaña que necesita el envío.
type campanaFila struct {
	ID         uint
	Status     string
	ChannelID  *uint
	TemplateID *uint
}

// destinatarioFila es un destinatario pendiente de envío.
type destinatarioFila struct {
	ID    uint
	Phone string
	Name  string
}

func enviarCampana(db *gorm.DB, companyID, campaignID uint) {
	var camp campanaFila
	if db.Table("campaigns").Where("id = ?", campaignID).Take(&camp).Error != nil {
		return
	}
	if camp.ChannelID == nil {
		fallarCampana(db, campaignID, "la campaña no tiene canal asignado")
		return
	}

	var canal models.Channel
	if db.First(&canal, *camp.ChannelID).Error != nil {
		fallarCampana(db, campaignID, "el canal de la campaña ya no existe")
		return
	}

	// La plantilla es obligatoria: una campaña abre conversación con gente que no
	// escribió primero, y fuera de la ventana de 24h WhatsApp solo acepta plantillas.
	if camp.TemplateID == nil {
		fallarCampana(db, campaignID, "la campaña no tiene plantilla asignada")
		return
	}
	var tpl struct {
		Name     string
		Language string
		Status   string
	}
	if db.Table("message_templates").Where("id = ?", *camp.TemplateID).Take(&tpl).Error != nil {
		fallarCampana(db, campaignID, "la plantilla de la campaña ya no existe")
		return
	}
	if tpl.Status != "approved" {
		fallarCampana(db, campaignID,
			fmt.Sprintf("la plantilla \"%s\" no está aprobada por Meta (estado: %s)", tpl.Name, tpl.Status))
		return
	}

	for {
		// Releer el estado en cada lote: permite que una cancelación surta efecto
		// sin esperar a que termine toda la campaña.
		var estado string
		db.Table("campaigns").Where("id = ?", campaignID).Select("status").Scan(&estado)
		if estado != "running" {
			return
		}

		var lote []destinatarioFila
		db.Table("campaign_recipients").
			Where("campaign_id = ? AND status = 'pending'", campaignID).
			Order("id ASC").Limit(campaignBatch).Find(&lote)

		if len(lote) == 0 {
			completarCampana(db, campaignID)
			return
		}

		for _, dest := range lote {
			enviarADestinatario(db, companyID, campaignID, &canal, tpl.Name, tpl.Language, dest)
			time.Sleep(campaignSendDelay)
		}
	}
}

func enviarADestinatario(db *gorm.DB, companyID, campaignID uint, canal *models.Channel,
	tplName, tplLang string, dest destinatarioFila) {

	// Sin el "+": es como Meta identifica al remitente en sus webhooks, así que el
	// contacto debe guardarse igual para que la respuesta del cliente caiga en esta
	// misma conversación y no abra una nueva con un contacto duplicado.
	telefono := normalizarTelefono(dest.Phone)

	res, err := senders.SendWhatsApp(canal, telefono, "", &senders.TemplatePayload{
		Name:     tplName,
		Language: tplLang,
	})
	if err != nil {
		motivo := err.Error()
		if len(motivo) > 500 {
			motivo = motivo[:500]
		}
		db.Table("campaign_recipients").Where("id = ?", dest.ID).
			Updates(map[string]any{"status": "failed", "error_message": motivo, "updated_at": time.Now()})
		db.Exec("UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?", campaignID)
		log.Printf("campaña %d: falló el envío a %s: %v", campaignID, dest.Phone, err)
		return
	}

	// Registrar el envío como un mensaje normal, para que la respuesta del cliente
	// caiga en la misma conversación y los acuses de recibo lo encuentren.
	dest.Phone = telefono
	msgID := registrarMensajeSaliente(db, companyID, canal, dest, tplName, res.ExternalID)

	ahora := time.Now()
	upd := map[string]any{"status": "sent", "sent_at": ahora, "updated_at": ahora}
	if msgID != 0 {
		upd["message_id"] = msgID
	}
	db.Table("campaign_recipients").Where("id = ?", dest.ID).Updates(upd)
	db.Exec("UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?", campaignID)
}

// registrarMensajeSaliente crea (o reutiliza) contacto y conversación y guarda el
// mensaje enviado. Devuelve el id del mensaje, o 0 si algo falló — en ese caso el
// envío ya ocurrió y no se revierte: se prefiere perder la traza local antes que
// marcar como no enviado algo que el cliente sí recibió.
func registrarMensajeSaliente(db *gorm.DB, companyID uint, canal *models.Channel,
	dest destinatarioFila, tplName, externalID string) uint {

	var contacto models.Contact
	db.Where("phone = ? AND channel_id = ?", dest.Phone, canal.ID).First(&contacto)
	if contacto.ID == 0 {
		contacto = models.Contact{ChannelID: canal.ID, Phone: dest.Phone, Name: dest.Name}
		if db.Create(&contacto).Error != nil {
			return 0
		}
	}

	var conv models.Conversation
	db.Where("contact_id = ? AND channel_id = ? AND status IN ('open','pending')", contacto.ID, canal.ID).
		Order("created_at DESC").First(&conv)

	ahora := time.Now()
	if conv.ID == 0 {
		conv = models.Conversation{
			CompanyID:     companyID,
			ChannelID:     canal.ID,
			ContactID:     contacto.ID,
			CaseNumber:    fmt.Sprintf("CASE-%d", ahora.UnixNano()/1e6),
			Status:        models.ConvPending,
			LastMessageAt: &ahora,
		}
		if canal.DepartmentID != nil {
			conv.DepartmentID = canal.DepartmentID
		}
		if db.Create(&conv).Error != nil {
			return 0
		}
	}

	msg := models.Message{
		ConversationID: conv.ID,
		Body:           "Plantilla: " + tplName,
		Direction:      "outbound",
		Status:         "sent",
		Type:           "template",
		ExternalID:     externalID,
	}
	if db.Create(&msg).Error != nil {
		return 0
	}
	db.Exec("UPDATE conversations SET last_message_at = NOW() WHERE id = ?", conv.ID)
	return msg.ID
}

func completarCampana(db *gorm.DB, campaignID uint) {
	ahora := time.Now()
	db.Table("campaigns").Where("id = ?", campaignID).
		Updates(map[string]any{"status": "completed", "completed_at": ahora, "updated_at": ahora})
	log.Printf("campaña %d completada", campaignID)
}

func fallarCampana(db *gorm.DB, campaignID uint, motivo string) {
	ahora := time.Now()
	db.Table("campaigns").Where("id = ?", campaignID).
		Updates(map[string]any{"status": "failed", "completed_at": ahora, "updated_at": ahora})
	log.Printf("campaña %d marcada como fallida: %s", campaignID, motivo)
	// El motivo también queda en cada destinatario que no llegó a enviarse, que es
	// donde la pantalla de detalle lo muestra.
	db.Table("campaign_recipients").
		Where("campaign_id = ? AND status = 'pending'", campaignID).
		Updates(map[string]any{"status": "failed", "error_message": motivo, "updated_at": ahora})
}

// normalizarTelefono deja el número como lo maneja Meta: sin el "+" inicial.
func normalizarTelefono(p string) string {
	return strings.TrimPrefix(strings.TrimSpace(p), "+")
}
