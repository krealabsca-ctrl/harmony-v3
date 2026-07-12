package handlers

// seed.go — Handler para la generación de datos de demostración en el sistema.
//
// Este archivo expone un único endpoint de administración que inserta un conjunto
// predefinido de contactos, conversaciones, mensajes y campañas ficticias en la
// base de datos de la empresa autenticada. Su propósito es facilitar la evaluación
// del producto (demos, QA, entornos de staging) sin necesidad de datos reales.
//
// IMPORTANTE: el endpoint está protegido por un guard que evita duplicar datos si
// ya existen más de 10 conversaciones en la empresa. No debe habilitarse en
// producción con tráfico real sin restricciones de acceso adicionales.
//
// Endpoint cubierto:
//   POST /admin/seed → SeedDemoData

import (
	"fmt"
	"math/rand"
	"net/http"
	"time"

	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// SeedDemoData genera un conjunto de datos de prueba para la empresa actualmente
// autenticada. Crea (si no existen):
//   - 1 canal WhatsApp de demostración
//   - Hasta 15 contactos con números costarricenses ficticios
//   - 1 conversación por contacto (con estados y fechas históricas aleatorias)
//   - 1 mensaje entrante y, si la conversación tiene agente, 1 respuesta saliente
//   - 2 campañas de ejemplo (una completada y una en borrador)
//
// El handler actúa de forma idempotente en cuanto a contactos (busca por teléfono
// antes de crear) y aborta completamente si ya existen más de 10 conversaciones.
//
// Parámetros de contexto Gin (inyectados por middleware):
//   - "db"         (*gorm.DB): conexión a la base de datos
//   - "company_id" (uint):     ID de la empresa autenticada
//   - "user_id"    (uint):     ID del usuario que ejecuta el seed
//
// Retorna:
//   201 Created — JSON con mensaje de confirmación y cantidad de conversaciones creadas
//   200 OK      — JSON informativo si ya había suficientes datos (sin crear nada)
func SeedDemoData(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	// Verificar que no hay datos ya (no duplicar)
	// Si ya existen más de 10 conversaciones se asume que el seed ya fue ejecutado
	var convCount int64
	db.Model(&models.Conversation{}).Count(&convCount)
	if convCount > 10 {
		c.JSON(http.StatusOK, gin.H{"message": "Ya hay datos suficientes", "conversations": convCount})
		return
	}

	// ─── Asegurar canal de demostración ────────────────────────────────────────
	// Reutilizar el primer canal existente de la empresa o crear uno nuevo de tipo WhatsApp
	var channel models.Channel
	db.Where("company_id = ?", companyID).First(&channel)
	if channel.ID == 0 {
		channel = models.Channel{
			Name:        "WhatsApp Demo",
			Type:        models.ChannelWhatsApp,
			Description: "Canal de demostración",
			Status:      models.StatusActive,
			IsActive:    true,
		}
		db.Create(&channel)
	}

	// ─── Asegurar departamento de demostración ──────────────────────────────────
	// Se busca el primer departamento disponible de la empresa para asignarlo
	// a las conversaciones de prueba; si no existe ninguno, deptID queda nil
	var dept struct {
		ID uint
	}
	db.Table("departments").Select("id").Where("company_id = ?", companyID).Scan(&dept)
	var deptID *uint
	if dept.ID > 0 {
		deptID = &dept.ID
	}

	// ─── Asegurar agentes (usuarios tipo agent) ─────────────────────────────────
	// Se obtienen hasta 5 agentes activos de la empresa para asignarlos
	// de forma rotativa a las conversaciones abiertas
	var agents []struct {
		ID       uint
		Name     string
		IsOnline bool
	}
	db.Table("users").Select("id, name, is_online").
		Where("company_id = ? AND role = 'agent' AND deleted_at IS NULL", companyID).
		Limit(5).Scan(&agents)

	// ─── Crear contactos y conversaciones de prueba ─────────────────────────────
	// Datos ficticios de 15 personas con nombres y teléfonos costarricenses
	sampleContacts := []struct{ name, phone string }{
		{"María García", "+50688001111"},
		{"Carlos Rodríguez", "+50688002222"},
		{"Ana Martínez", "+50688003333"},
		{"José López", "+50688004444"},
		{"Laura Hernández", "+50688005555"},
		{"Pedro González", "+50688006666"},
		{"Sofía Pérez", "+50688007777"},
		{"Luis Ramírez", "+50688008888"},
		{"Daniela Torres", "+50688009999"},
		{"Miguel Flores", "+50688010000"},
		{"Valentina Castro", "+50688011111"},
		{"Diego Morales", "+50688012222"},
		{"Isabella Jiménez", "+50688013333"},
		{"Andrés Vargas", "+50688014444"},
		{"Camila Rojas", "+50688015555"},
	}

	// Secuencia de estados que se asigna cíclicamente a las conversaciones
	statuses := []string{"open", "pending", "closed", "open", "open", "closed", "open", "pending", "closed", "open", "closed", "open", "open", "pending", "closed"}
	// Mensajes de ejemplo que simulan consultas reales de clientes
	messages := []string{
		"Hola, ¿me pueden ayudar con mi pedido?",
		"Necesito información sobre sus servicios",
		"Tengo un problema con mi cuenta",
		"¿Cuál es el horario de atención?",
		"Quiero hacer una consulta sobre precios",
		"Me llegó el producto equivocado",
		"¿Cómo puedo cancelar mi suscripción?",
		"Gracias por la ayuda, excelente servicio",
		"¿Tienen disponible el modelo nuevo?",
		"Necesito una factura de mi compra",
		"El envío lleva 5 días sin llegar",
		"¿Aceptan pagos en dólares?",
		"Quiero hablar con un supervisor",
		"¿Pueden hacer una cotización?",
		"Mi producto llegó dañado",
	}

	now := time.Now()
	created := 0 // contador de conversaciones efectivamente insertadas

	for i, sc := range sampleContacts {
		// Buscar el contacto por teléfono+canal para no duplicarlo si el seed se re-ejecuta
		var contact models.Contact
		db.Where("phone = ? AND channel_id = ?", sc.phone, channel.ID).First(&contact)
		if contact.ID == 0 {
			contact = models.Contact{
				ChannelID: channel.ID,
				Name:      sc.name,
				Phone:     sc.phone,
			}
			db.Create(&contact)
		}

		// Asignar estado cíclico usando módulo para no salirse del arreglo
		status := statuses[i%len(statuses)]
		// Distribuir las conversaciones en los últimos 30 días de forma aleatoria
		daysAgo := rand.Intn(30)
		createdAt := now.AddDate(0, 0, -daysAgo)

		// Asignar agente solo a las conversaciones abiertas, de forma rotativa
		var agentID *uint
		if len(agents) > 0 && status == "open" {
			aid := agents[i%len(agents)].ID
			agentID = &aid
		}

		// Número de caso único: combina parte del Unix timestamp con índice secuencial
		caseNum := fmt.Sprintf("CASE-%d-%04d", now.Unix()%10000, i+1)
		// Último mensaje entre 0 y 120 minutos después de la creación de la conversación
		lastMsgAt := createdAt.Add(time.Duration(rand.Intn(120)) * time.Minute)

		conv := models.Conversation{
			CompanyID:     companyID,
			ContactID:     contact.ID,
			ChannelID:     channel.ID,
			DepartmentID:  deptID,
			AgentID:       agentID,
			CaseNumber:    caseNum,
			Status:        models.ConversationStatus(status),
			UnreadCount:   0,
			LastMessageAt: &lastMsgAt,
		}
		// Usar una sesión nueva para que GORM no reutilice condiciones de queries previas
		db.Session(&gorm.Session{}).Create(&conv)
		if conv.ID == 0 {
			// Si la inserción falló por alguna razón, saltar a la siguiente iteración
			continue
		}

		// Forzar timestamps históricos porque GORM asigna el tiempo actual por defecto
		db.Exec("UPDATE conversations SET created_at = ?, updated_at = ?, last_message_at = ? WHERE id = ?",
			createdAt, lastMsgAt, lastMsgAt, conv.ID)

		// Mensaje de entrada: simula el primer contacto del cliente
		body := messages[i%len(messages)]
		msg := models.Message{
			ConversationID: conv.ID,
			Body:           body,
			Type:           "text",
			Direction:      "inbound",
			Status:         "delivered",
		}
		db.Create(&msg)
		// Actualizar el timestamp del mensaje para que coincida con la fecha de creación
		db.Exec("UPDATE messages SET created_at = ? WHERE id = ?", createdAt, msg.ID)

		// Respuesta del agente (si tiene agente)
		// Solo las conversaciones asignadas a un agente reciben respuesta saliente
		if agentID != nil {
			reply := models.Message{
				ConversationID: conv.ID,
				Body:           "Hola, con gusto le ayudo. ¿Me puede dar más detalles?",
				Type:           "text",
				Direction:      "outbound",
				Status:         "sent",
			}
			db.Create(&reply)
			// La respuesta del agente tiene timestamp igual al último mensaje de la conversación
			db.Exec("UPDATE messages SET created_at = ? WHERE id = ?", lastMsgAt, reply.ID)
		}

		created++
	}

	// ─── Campaña de demostración ────────────────────────────────────────────────
	// Solo crear las campañas de ejemplo si la empresa no tiene ninguna todavía
	var campCount int64
	db.Model(&Campaign{}).Count(&campCount)
	if campCount == 0 {
		// Intentar asignar la primera plantilla de la empresa a las campañas demo
		var tplID *uint
		var tpl struct{ ID uint }
		db.Table("message_templates").Select("id").
			Where("company_id = ?", companyID).First(&tpl)
		if tpl.ID > 0 {
			tplID = &tpl.ID
		}

		chID := channel.ID
		createdBy := c.GetUint("user_id")
		// Campaña completada: finalizó hace 5 días, comenzó 30 minutos antes de eso
		completedAt := now.AddDate(0, 0, -5)
		startedAt := completedAt.Add(-30 * time.Minute)

		// Primera campaña: ya completada con métricas realistas de envío
		// Costo total = 143 mensajes enviados × $0.0274 ≈ $3.9162 (algunos fallaron)
		camp := Campaign{
			CompanyID:       companyID,
			Name:            "Promo Junio 2026",
			ChannelID:       &chID,
			TemplateID:      tplID,
			Status:          "completed",
			Type:            "broadcast",
			CountryCode:     "CR",
			CostPerMessage:  0.0274,
			TotalRecipients: 150,
			SentCount:       143,
			FailedCount:     7,
			TotalCost:       3.9162,
			StartedAt:       &startedAt,
			CompletedAt:     &completedAt,
			CreatedBy:       &createdBy,
		}
		db.Create(&camp)
		// Ajustar timestamps: creada hace 7 días, completada hace 5 días
		db.Exec("UPDATE campaigns SET created_at = ?, updated_at = ? WHERE id = ?",
			now.AddDate(0, 0, -7), completedAt, camp.ID)

		// Segunda campaña: en borrador, todavía sin enviar
		// Costo estimado = 300 destinatarios × $0.0274 = $8.22
		camp2 := Campaign{
			CompanyID:       companyID,
			Name:            "Black Friday Anticipado",
			ChannelID:       &chID,
			TemplateID:      tplID,
			Status:          "draft",
			Type:            "broadcast",
			CountryCode:     "CR",
			CostPerMessage:  0.0274,
			TotalRecipients: 300,
			TotalCost:       8.22,
			CreatedBy:       &createdBy,
		}
		db.Create(&camp2)
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":      "Datos de prueba creados correctamente",
		"conversations": created,
	})
}
