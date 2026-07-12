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
	"net/http"
	"strconv"

	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func credentialFlags(ch models.Channel) map[string]bool {
	flags := map[string]bool{}
	for k, v := range ch.Credentials {
		if s, ok := v.(string); ok {
			flags[k] = s != ""
		} else {
			flags[k] = v != nil
		}
	}
	flags["webhook_secret"] = ch.WebhookSecret != ""
	return flags
}

func generateWebhookSecret() string {
	b := make([]byte, 32)
	rand.Read(b)
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
	type ChannelResp struct {
		models.Channel
		CredentialFlags map[string]bool `json:"credential_flags"`
	}
	resp := make([]ChannelResp, len(channels))
	for i, ch := range channels {
		resp[i] = ChannelResp{Channel: ch, CredentialFlags: credentialFlags(ch)}
	}
	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// CreateChannel crea un nuevo canal de comunicación con las credenciales y metadatos
// proporcionados. Al crearse, el canal se activa automáticamente (status=active, is_active=true).
//
// Cuándo se llama: POST /channels cuando el administrador conecta una nueva plataforma
// de mensajería (ej. configura un número de WhatsApp Business).
//
// Cuerpo JSON:
//   - name           (requerido): nombre descriptivo del canal (ej. "WhatsApp Soporte").
//   - type           (requerido): tipo de plataforma ("whatsapp", "messenger", "telegram", etc.).
//   - description    (opcional): descripción del propósito del canal.
//   - identifier     (opcional): identificador externo (número de teléfono, page ID, etc.).
//   - department_id  (opcional): ID del departamento al que se enrutan las conversaciones.
//   - credentials    (opcional): objeto JSON con tokens/secrets del proveedor.
//   - webhook_secret (opcional): token para validar webhooks entrantes (se genera si no se provee).
//
// Respuesta:
//   - 201 Created con el canal creado en "data" y webhook_secret en el cuerpo.
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
	// Si no se provee webhook_secret, generar uno aleatorio.
	webhookSecret := req.WebhookSecret
	if webhookSecret == "" {
		webhookSecret = generateWebhookSecret()
	}
	// Construir el modelo con los valores recibidos.
	// El canal se marca activo inmediatamente para que empiece a recibir mensajes.
	ch := models.Channel{
		Name:          req.Name,
		Type:          models.ChannelType(req.Type),
		Description:   req.Description,
		Identifier:    req.Identifier,
		DepartmentID:  req.DepartmentID,
		Credentials:   req.Credentials,
		WebhookSecret: webhookSecret,
		Status:        models.StatusActive,
		IsActive:      true,
	}
	if err := db.Create(&ch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	// Devolver el canal con webhook_secret y credential_flags (solo una vez en create)
	type ChannelResp struct {
		models.Channel
		WebhookSecret   string          `json:"webhook_secret"`
		CredentialFlags map[string]bool `json:"credential_flags"`
	}
	resp := ChannelResp{
		Channel:         ch,
		WebhookSecret:   webhookSecret,
		CredentialFlags: credentialFlags(ch),
	}
	c.JSON(http.StatusCreated, gin.H{"data": resp})
}

// UpdateChannel actualiza los campos editables de un canal existente (patch parcial).
// Solo modifica los campos que vienen con valor en el cuerpo de la petición.
//
// Cuándo se llama: PUT /channels/:id cuando el administrador edita la configuración
// de un canal (nombre, estado activo/inactivo, identificador externo, credenciales, etc.).
//
// Parámetros de ruta:
//   - id: ID numérico del canal.
//
// Cuerpo JSON (todos opcionales):
//   - name           : nuevo nombre del canal.
//   - description    : nueva descripción.
//   - identifier     : nuevo identificador externo.
//   - status         : nuevo estado ("active", "inactive", etc.).
//   - is_active      : booleano para activar/desactivar el canal.
//   - credentials    : objeto con credenciales (se mergean, no se sobreescriben).
//   - webhook_secret : nuevo token webhook.
//
// Respuesta:
//   - 200 OK con el canal actualizado en "data" y credential_flags.
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
		IsActive      *bool          `json:"is_active"` // Puntero para distinguir false de "no enviado".
		Credentials   map[string]any `json:"credentials"`
		WebhookSecret string         `json:"webhook_secret"`
	}
	// ShouldBindJSON sin verificar error: en un PATCH, un body vacío es válido.
	c.ShouldBindJSON(&req)
	// Construir mapa de actualizaciones solo con campos no vacíos.
	updates := map[string]any{}
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
	// Credentials: merge (no overwrite) para no perder campos existentes
	if len(req.Credentials) > 0 {
		merged := ch.Credentials
		if merged == nil {
			merged = map[string]any{}
		}
		for k, v := range req.Credentials {
			merged[k] = v
		}
		updates["credentials"] = merged
	}
	// WebhookSecret
	if req.WebhookSecret != "" {
		updates["webhook_secret"] = req.WebhookSecret
	}
	db.Model(&ch).Updates(updates)
	// Recargar para obtener valores actualizados
	db.First(&ch, id)
	type ChannelResp struct {
		models.Channel
		CredentialFlags map[string]bool `json:"credential_flags"`
	}
	resp := ChannelResp{Channel: ch, CredentialFlags: credentialFlags(ch)}
	c.JSON(http.StatusOK, gin.H{"data": resp})
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
