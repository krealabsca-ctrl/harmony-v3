package handlers

// channels.go — CRUD de canales de comunicación y simulación de mensajes entrantes.
//
// Un "canal" (Channel) representa una conexión con una plataforma de mensajería
// (WhatsApp, Messenger, Instagram, Telegram, SMS, etc.). Cada canal tiene credenciales
// propias, puede pertenecer a un departamento, y es la puerta de entrada por la que
// llegan los mensajes de los usuarios finales.
//
// Este archivo expone cinco endpoints HTTP:
//
//   GET    /channels                     — Lista todos los canales del tenant.
//   POST   /channels                     — Crea un nuevo canal.
//   PUT    /channels/:id                 — Actualiza un canal existente (patch parcial).
//   DELETE /channels/:id                 — Elimina (soft-delete) un canal.
//   POST   /channels/:id/simulate-inbound — Simula un mensaje entrante para pruebas.
//
// El endpoint simulate-inbound es especialmente útil durante el desarrollo para
// probar el flujo Bot → Agente sin necesidad de un proveedor de mensajería real.

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"harmony-api/internal/config"
	"harmony-api/internal/models"
	"harmony-api/internal/senders"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// credentialKeys son las claves de credenciales que la UI muestra como "configurado"
// sin revelar su valor.
var credentialKeys = []string{"phone_number_id", "waba_id", "access_token", "page_id", "bot_token", "app_secret"}

// channelWebhookURL construye la dirección pública del webhook del canal.
// Se usa la URL del frontend como base porque en producción el mismo dominio
// publica la aplicación y reenvía /api al backend.
func channelWebhookURL(ch models.Channel) string {
	base := strings.TrimRight(config.App.FrontendURL, "/")
	if base == "" || ch.PublicID == "" {
		return ""
	}
	return fmt.Sprintf("%s/api/webhooks/%s/%s", base, ch.Type, ch.PublicID)
}

// channelResponse serializa un canal para la UI agregando los datos derivados que
// la pantalla de canales necesita y que no viven en la tabla:
//   - webhook_url    : dirección que se registra en Meta o Telegram.
//   - webhook_secret : valor a usar como token de verificación (solo lo ve el admin).
//   - credential_flags: qué credenciales están guardadas, sin exponer sus valores.
func channelResponse(ch models.Channel) gin.H {
	flags := gin.H{}
	for _, k := range credentialKeys {
		if v, ok := ch.Credentials[k]; ok {
			if s, isStr := v.(string); isStr && strings.TrimSpace(s) != "" {
				flags[k] = true
			}
		}
	}
	return gin.H{
		"id":               ch.ID,
		"public_id":        ch.PublicID,
		"company_id":       ch.CompanyID,
		"department_id":    ch.DepartmentID,
		"type":             ch.Type,
		"name":             ch.Name,
		"description":      ch.Description,
		"identifier":       ch.Identifier,
		"status":           ch.Status,
		"is_active":        ch.IsActive,
		"created_at":       ch.CreatedAt,
		"updated_at":       ch.UpdatedAt,
		"webhook_url":      channelWebhookURL(ch),
		"webhook_secret":   ch.WebhookSecret,
		"credential_flags": flags,
	}
}

// randomSecret genera un token hexadecimal aleatorio para usar como secreto de
// webhook cuando el administrador no proporciona uno.
func randomSecret() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return hex.EncodeToString(b)
}

// ListChannels retorna todos los canales configurados en el tenant actual.
//
// Cuándo se llama: GET /channels desde la pantalla de administración de canales,
// para mostrar la lista de integraciones activas y su estado.
//
// Respuesta:
//   - 200 OK con array de canales en "data".
//   - 500 si falla la consulta a la base de datos.
func ListChannels(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var channels []models.Channel
	if err := db.Find(&channels).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	out := make([]gin.H, 0, len(channels))
	for _, ch := range channels {
		out = append(out, channelResponse(ch))
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// CreateChannel crea un nuevo canal de comunicación con las credenciales y metadatos
// proporcionados. Al crearse, el canal se activa automáticamente (status=active, is_active=true).
//
// Cuándo se llama: POST /channels cuando el administrador conecta una nueva plataforma
// de mensajería (ej. configura un número de WhatsApp Business).
//
// Cuerpo JSON:
//   - name         (requerido): nombre descriptivo del canal (ej. "WhatsApp Soporte").
//   - type         (requerido): tipo de plataforma ("whatsapp", "messenger", "telegram", etc.).
//   - description  (opcional): descripción del propósito del canal.
//   - identifier   (opcional): identificador externo (número de teléfono, page ID, etc.).
//   - department_id(opcional): ID del departamento al que se enrutan las conversaciones.
//   - credentials  (opcional): objeto JSON con tokens/secrets del proveedor.
//
// Respuesta:
//   - 201 Created con el canal creado en "data".
//   - 422 si faltan campos requeridos o el JSON es inválido.
//   - 500 si falla la inserción en BD.
func CreateChannel(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		Name          string         `json:"name" binding:"required"`
		Type          string         `json:"type" binding:"required"`
		Description   string         `json:"description"`
		Identifier    string         `json:"identifier"`
		DepartmentID  *uint          `json:"department_id"`
		Credentials   map[string]any `json:"credentials"`
		WebhookSecret string         `json:"webhook_secret"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	// El secreto del webhook es indispensable: valida la suscripción del webhook y
	// la firma de cada notificación entrante. Para los canales de Meta debe ser el
	// App Secret de la aplicación, porque es la clave con la que Meta firma los
	// payloads. Si no se envía, se genera uno aleatorio para que el canal quede
	// operativo (en Telegram sirve tal cual; en Meta el administrador deberá
	// reemplazarlo por el App Secret antes de recibir mensajes).
	secret := strings.TrimSpace(req.WebhookSecret)
	if secret == "" {
		secret = randomSecret()
	}

	// Construir el modelo con los valores recibidos.
	// El canal se marca activo inmediatamente para que empiece a recibir mensajes.
	ch := models.Channel{
		// Sin esto la columna quedaba en 0 y el broadcast de los mensajes entrantes
		// salía a "company.0.*" mientras los navegadores escuchan "company.{id}.*":
		// ningún mensaje del cliente llegaba en vivo.
		CompanyID:     c.GetUint("company_id"),
		Name:          req.Name,
		Type:          models.ChannelType(req.Type),
		Description:   req.Description,
		Identifier:    req.Identifier,
		DepartmentID:  req.DepartmentID,
		Credentials:   req.Credentials,
		WebhookSecret: secret,
		Status:        models.StatusActive,
		IsActive:      true,
	}
	if err := db.Create(&ch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	// Recargar para obtener el public_id generado por la base de datos, necesario
	// para construir la dirección del webhook que la UI muestra al administrador.
	db.First(&ch, ch.ID)

	// Telegram no tiene un paso de "verificar y guardar" manual como Meta: el
	// webhook se registra por API. Si falla, el canal igual queda creado (el
	// administrador puede reintentar guardándolo de nuevo, o el diagnóstico de
	// Canales → Probar lo va a señalar).
	if ch.Type == models.ChannelTelegram {
		if botToken, ok := ch.Credentials["bot_token"].(string); ok && botToken != "" {
			if err := senders.RegisterTelegramWebhook(botToken, channelWebhookURL(ch), ch.WebhookSecret); err != nil {
				log.Printf("ERROR: registrar webhook de Telegram (canal %d): %v", ch.ID, err)
			}
		}
	}

	c.JSON(http.StatusCreated, channelResponse(ch))
}

// UpdateChannel actualiza los campos editables de un canal existente (patch parcial).
// Solo modifica los campos que vienen con valor en el cuerpo de la petición.
//
// Cuándo se llama: PUT /channels/:id cuando el administrador edita la configuración
// de un canal (nombre, estado activo/inactivo, identificador externo, etc.).
//
// Parámetros de ruta:
//   - id: ID numérico del canal.
//
// Cuerpo JSON (todos opcionales):
//   - name       : nuevo nombre del canal.
//   - description: nueva descripción.
//   - identifier : nuevo identificador externo.
//   - status     : nuevo estado ("active", "inactive", etc.).
//   - is_active  : booleano para activar/desactivar el canal.
//
// Respuesta:
//   - 200 OK con el canal actualizado en "data".
//   - 404 si el canal no existe.
func UpdateChannel(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	// Verificar existencia antes de intentar actualizar.
	var ch models.Channel
	if err := db.First(&ch, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Canal no encontrado"})
		return
	}
	var req struct {
		Name          string         `json:"name"`
		Description   string         `json:"description"`
		Identifier    string         `json:"identifier"`
		Status        string         `json:"status"`
		IsActive      *bool          `json:"is_active"`     // Puntero para distinguir false de "no enviado".
		DepartmentID  *uint          `json:"department_id"` // Puntero: 0 = quitar departamento.
		WebhookSecret string         `json:"webhook_secret"`
		Credentials   map[string]any `json:"credentials"`
	}
	// ShouldBindJSON sin verificar error: en un PATCH, un body vacío es válido.
	c.ShouldBindJSON(&req)
	// Construir mapa de actualizaciones solo con campos no vacíos.
	updates := map[string]any{}
	if req.DepartmentID != nil {
		if *req.DepartmentID == 0 {
			updates["department_id"] = nil
		} else {
			updates["department_id"] = *req.DepartmentID
		}
	}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Description != "" {
		updates["description"] = req.Description
	}
	if req.Identifier != "" {
		updates["identifier"] = req.Identifier
	}
	if req.Status != "" {
		updates["status"] = req.Status
	}
	// is_active usa puntero: si es nil, no se envió; si no es nil (true o false), actualizar.
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	// Permite corregir el secreto del webhook (por ejemplo, para reemplazar el valor
	// generado automáticamente por el App Secret real de la app de Meta).
	if s := strings.TrimSpace(req.WebhookSecret); s != "" {
		updates["webhook_secret"] = s
	}
	// Credenciales: se fusionan con las existentes para poder actualizar una sola
	// (por ejemplo el Phone Number ID al pasar a producción) sin borrar las demás.
	if len(req.Credentials) > 0 {
		merged := map[string]any{}
		for k, v := range ch.Credentials {
			merged[k] = v
		}
		for k, v := range req.Credentials {
			if s, isStr := v.(string); isStr && strings.TrimSpace(s) == "" {
				continue // valor vacío = no se modifica esa credencial
			}
			merged[k] = v
		}
		updates["credentials"] = merged
	}

	if len(updates) > 0 {
		db.Model(&ch).Updates(updates)
		db.First(&ch, id) // recargar para devolver los valores efectivos
	}

	// Re-registrar el webhook de Telegram por si cambió el bot_token o el
	// webhook_secret (setWebhook es idempotente: no hay problema en llamarlo de
	// nuevo aunque nada haya cambiado).
	if ch.Type == models.ChannelTelegram {
		if botToken, ok := ch.Credentials["bot_token"].(string); ok && botToken != "" {
			if err := senders.RegisterTelegramWebhook(botToken, channelWebhookURL(ch), ch.WebhookSecret); err != nil {
				log.Printf("ERROR: registrar webhook de Telegram (canal %d): %v", ch.ID, err)
			}
		}
	}

	c.JSON(http.StatusOK, channelResponse(ch))
}

// DeleteChannel elimina un canal de la base de datos (soft-delete si el modelo lo soporta).
//
// Cuándo se llama: DELETE /channels/:id cuando el administrador desconecta o elimina
// una integración de mensajería.
//
// Parámetros de ruta:
//   - id: ID numérico del canal a eliminar.
//
// Respuesta:
//   - 204 No Content si la eliminación fue exitosa (sin cuerpo de respuesta).
func DeleteChannel(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	// GORM ejecutará un soft-delete si el modelo tiene DeletedAt (gorm.Model),
	// o un DELETE físico si no lo tiene.
	db.Delete(&models.Channel{}, id)
	c.JSON(http.StatusNoContent, nil)
}

// SimulateInbound simula la llegada de un mensaje entrante a un canal específico,
// ejecutando el flujo completo de ProcessInbound (creación de contacto, conversación,
// mensaje, y flujo Bot → Agente) sin necesidad de un webhook real.
//
// Cuándo se llama: POST /channels/:id/simulate-inbound durante desarrollo o pruebas
// de integración, para verificar que el flujo automático funciona correctamente
// sin tener que enviar mensajes reales desde WhatsApp u otras plataformas.
//
// Parámetros de ruta:
//   - id: ID numérico del canal que recibirá el mensaje simulado.
//
// Cuerpo JSON (todos opcionales, con valores por defecto si se omiten):
//   - phone  : número del remitente (default: "50600000000").
//   - name   : nombre del remitente (default: "Cliente Test").
//   - message: texto del mensaje (default: "Hola, necesito ayuda").
//
// Respuesta:
//   - 200 OK con un resumen de la simulación (canal, tipo, remitente, mensaje).
//   - 400 si el ID del canal no es un número válido.
//   - 404 si el canal no existe.
//   - 500 si ProcessInbound retorna un error.
func SimulateInbound(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	// Convertir el parámetro de ruta a entero para usarlo como channelID.
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "ID inválido"})
		return
	}

	var req struct {
		Phone   string `json:"phone"`
		Name    string `json:"name"`
		Message string `json:"message"`
	}
	c.ShouldBindJSON(&req)
	// Aplicar valores por defecto para que la simulación funcione con un cuerpo vacío.
	if req.Phone == "" {
		req.Phone = "50600000000"
	}
	if req.Name == "" {
		req.Name = "Cliente Test"
	}
	if req.Message == "" {
		req.Message = "Hola, necesito ayuda"
	}

	// Verificar que el canal existe antes de procesar el mensaje simulado.
	var ch models.Channel
	if err := db.First(&ch, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Canal no encontrado"})
		return
	}

	// Delegar al mismo handler que usan los webhooks reales.
	// externalID vacío ("") indica que no hay ID externo: no se deduplicará.
	if err := ProcessInbound(db, uint(id), req.Phone, req.Name, req.Message, ""); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Mensaje entrante simulado. El flujo de bot/agente se ejecutó.",
		"channel_id":   id,
		"channel_type": ch.Type,
		"from":         req.Phone,
		"body":         req.Message,
	})
}
