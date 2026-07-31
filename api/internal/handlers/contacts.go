package handlers

// contacts.go — Gestión de contactos y adjuntos de conversaciones.
//
// Este archivo expone tres endpoints HTTP de la API REST de Harmony:
//
//   PUT  /contacts/:id              — Actualiza los datos de un contacto existente.
//   GET  /contacts/:id/conversations — Lista el historial de conversaciones de un contacto.
//   POST /conversations/:id/attachments — Sube un archivo adjunto y crea el mensaje correspondiente.
//
// El handler de adjuntos detecta el tipo MIME del archivo para clasificar el mensaje
// (image, audio, video, document) y almacena el archivo en el directorio local "uploads/".
// El campo AzurePath del adjunto guarda la URL relativa aunque el almacenamiento sea local;
// esto permite migrar a Azure Blob Storage en el futuro sin cambiar el modelo de datos.

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"harmony-api/internal/models"
	"harmony-api/internal/senders"
	"harmony-api/internal/ws"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// UpdateContact actualiza los datos editables de un contacto (nombre, teléfono, email).
// Solo actualiza los campos que vienen con valor no vacío en el cuerpo de la petición,
// preservando los demás sin modificación (patch parcial).
//
// Cuándo se llama: PUT /contacts/:id desde el frontend cuando el agente edita la ficha
// del contacto en el panel de conversación.
//
// Parámetros de ruta:
//   - id: ID numérico del contacto en la base de datos.
//
// Cuerpo JSON (todos opcionales):
//   - name  : nuevo nombre del contacto.
//   - phone : nuevo número de teléfono.
//   - email : nueva dirección de correo electrónico.
//
// Respuesta:
//   - 200 OK con el contacto actualizado en "data".
//   - 404 si el contacto no existe.
//   - 422 si el JSON es inválido.
//   - 500 si falla la actualización en BD.
func UpdateContact(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")

	// Verificar que el contacto existe antes de intentar actualizarlo.
	var contact models.Contact
	if err := db.First(&contact, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Contacto no encontrado"})
		return
	}

	var req struct {
		Name  string `json:"name"`
		Phone string `json:"phone"`
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	// Construir mapa de actualizaciones dinámico: solo incluir campos con valor.
	// Esto evita sobreescribir campos existentes con cadenas vacías.
	updates := map[string]any{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Phone != "" {
		updates["phone"] = req.Phone
	}
	if req.Email != "" {
		updates["email"] = req.Email
	}

	// Si no llegó ningún campo con valor, retornar el contacto sin tocar la BD.
	if len(updates) == 0 {
		c.JSON(http.StatusOK, gin.H{"data": contact})
		return
	}

	if err := db.Model(&contact).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	// Recargar el registro para devolver los valores finales guardados en BD.
	db.First(&contact, id)
	c.JSON(http.StatusOK, gin.H{"data": contact})
}

// GetContactConversations retorna el historial de conversaciones de un contacto,
// incluyendo los datos del canal y del agente asignado en cada conversación.
//
// Cuándo se llama: GET /contacts/:id/conversations desde el panel de detalle del
// contacto, para mostrar el historial completo de interacciones previas.
//
// Parámetros de ruta:
//   - id: ID numérico del contacto.
//
// Respuesta:
//   - 200 OK con array de conversaciones en "data" (máximo 20, más recientes primero).
//     Cada conversación incluye los campos relacionados Channel y Agent precargados.
func GetContactConversations(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")

	var convs []models.Conversation
	// Se limita a 20 conversaciones para no sobrecargar la respuesta.
	// Preload de Channel y Agent evita N+1 queries al serializar el JSON.
	db.Where("contact_id = ?", id).
		Preload("Channel").Preload("Agent").
		Order("created_at DESC").
		Limit(20).Find(&convs)

	c.JSON(http.StatusOK, gin.H{"data": convs})
}

// UploadAttachment recibe un archivo multipart/form-data, lo guarda en el
// directorio local "uploads/", y crea el mensaje de tipo adjunto correspondiente
// en la conversación indicada.
//
// El tipo de mensaje (image, audio, video, document) se infiere del Content-Type
// MIME del archivo subido:
//   - image/*   → "image"
//   - audio/*   → "audio"
//   - video/*   → "video"
//   - cualquier otro → "document"
//
// El nombre de archivo guardado usa el patrón "<conv_id>-<nanoseconds><ext>" para
// garantizar unicidad y evitar colisiones entre archivos con el mismo nombre original.
//
// Cuándo se llama: POST /conversations/:id/attachments cuando el agente adjunta
// un archivo (imagen, documento, audio) desde la interfaz de chat.
//
// Parámetros de ruta:
//   - id: ID numérico de la conversación destino.
//
// Form-data:
//   - file: el archivo a subir (campo requerido).
//
// Respuesta:
//   - 201 Created con el mensaje creado (incluyendo el adjunto) en "data".
//   - 404 si la conversación no existe.
//   - 422 si no se envió el campo "file".
//   - 500 en errores de sistema de archivos o base de datos.
func UploadAttachment(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	convID := c.Param("id")

	// Verificar que la conversación existe antes de guardar el archivo. Se necesitan
	// Channel y Contact para poder enviar el adjunto al proveedor más abajo.
	var conv models.Conversation
	if err := db.Preload("Channel").Preload("Contact").First(&conv, convID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Conversación no encontrada"})
		return
	}

	// Validar ventana de 24h de WhatsApp antes de aceptar el adjunto — mismo chequeo
	// que SendMessage ya hace para texto (conversations.go). Sin esto, un adjunto
	// podría subirse e intentar enviarse fuera de ventana y fallar del lado de Meta.
	if conv.Channel != nil && conv.Channel.Type == models.ChannelWhatsApp {
		if conv.WindowExpiresAt == nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"message":    "El cliente aún no ha iniciado conversación. Envía una plantilla de WhatsApp.",
				"error_code": "window_not_open",
			})
			return
		}
		if time.Now().After(*conv.WindowExpiresAt) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"message":    "La ventana de 24h de WhatsApp ha expirado. Solo se pueden enviar plantillas aprobadas.",
				"error_code": "window_expired",
				"expired_at": conv.WindowExpiresAt,
			})
			return
		}
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Archivo requerido"})
		return
	}
	defer file.Close()

	// Determinar el tipo MIME del archivo.
	// Si el navegador/cliente no envió Content-Type, usar el genérico binario.
	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	// FIX: guardar bajo uploads/company_<id>/attachments — ServeUpload exige ese
	// prefijo para cualquier usuario que no sea superadmin (uploads.go:81-87).
	// Guardar en la raíz de uploads/ dejaba el archivo inaccesible (403) para el
	// propio agente que lo subió.
	companyID := c.GetUint("company_id")
	uploadsDir := filepath.Join("uploads", fmt.Sprintf("company_%d", companyID), "attachments")
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error creando directorio"})
		return
	}

	// Generar nombre de archivo único: "<conv_id>-<nanoseconds><extension>".
	// Usar nanosegundos evita colisiones incluso con subidas simultáneas.
	ext := filepath.Ext(header.Filename)
	safeName := fmt.Sprintf("%d-%d%s", conv.ID, time.Now().UnixNano(), ext)
	savePath := filepath.Join(uploadsDir, safeName)

	out, err := os.Create(savePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error guardando archivo"})
		return
	}
	defer out.Close()

	// Copiar el contenido del archivo subido al destino en disco;
	// io.Copy retorna el número de bytes escritos para guardarlo en el modelo.
	size, err := io.Copy(out, file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error escribiendo archivo"})
		return
	}

	// URL relativa pública del archivo; ServeUpload la sirve validando el JWT y el
	// prefijo company_<id>.
	fileURL := fmt.Sprintf("/uploads/company_%d/attachments/%s", companyID, safeName)

	// Inferir el tipo de mensaje a partir del prefijo del MIME type.
	// Esto permite al frontend mostrar el reproductor correcto (imagen, audio, video).
	msgType := classifyMime(mimeType)

	// Crear el registro de mensaje con el nombre original como cuerpo (visible en el chat).
	convIDUint := conv.ID
	msg := models.Message{
		ConversationID: convIDUint,
		Body:           header.Filename, // Nombre original para mostrarlo en la burbuja del chat.
		Type:           msgType,
		Direction:      "outbound",
		Status:         "sent",
	}
	if err := db.Create(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}

	// Crear el registro de adjunto vinculado al mensaje.
	// AzurePath almacena la URL local (compatible con la migración futura a Azure Blob Storage).
	attachment := models.MessageAttachment{
		MessageID:    msg.ID,
		AzurePath:    fileURL,
		OriginalName: header.Filename,
		MimeType:     mimeType,
		Size:         size,
	}
	db.Create(&attachment)
	// Adjuntar al mensaje para que el JSON de respuesta y el broadcast incluyan el
	// array de adjuntos.
	msg.Attachments = []models.MessageAttachment{attachment}

	// Enviar el adjunto al proveedor. Nuestros uploads exigen JWT (ServeUpload), así
	// que no se puede mandar un link — cada Send*Media sube el archivo directo
	// (multipart) a la API del proveedor. Igual que SendMessage con texto: el
	// mensaje queda guardado aunque el envío falle, solo cambia el status.
	var sendErr error
	if conv.Channel != nil && conv.Contact != nil {
		to := conv.Contact.Phone
		switch conv.Channel.Type {
		case models.ChannelWhatsApp:
			_, sendErr = senders.SendWhatsAppMedia(conv.Channel, to, msgType, savePath, mimeType, "")
		case models.ChannelMessenger:
			attachType := msgType
			if attachType == "document" {
				attachType = "file"
			}
			_, sendErr = senders.SendMessengerMedia(conv.Channel, to, attachType, savePath)
		case models.ChannelInstagram:
			attachType := msgType
			if attachType == "document" {
				attachType = "file"
			}
			_, sendErr = senders.SendInstagramMedia(conv.Channel, to, attachType, savePath)
		case models.ChannelTelegram:
			_, sendErr = senders.SendTelegramMedia(conv.Channel, to, msgType, savePath)
		}
	}

	if sendErr != nil {
		log.Printf("ERROR: enviar adjunto (canal %d, tipo %s): %v", conv.ChannelID, msgType, sendErr)
		db.Model(&msg).Update("status", "failed")
		msg.Status = "failed"
	}

	// Actualizar last_message_at de la conversación para mantener la bandeja ordenada.
	db.Exec(`UPDATE conversations SET last_message_at = NOW() WHERE id = ?`, convIDUint)

	// Emitir el mensaje por WebSocket para que otros agentes lo vean en tiempo real
	// (mismo patrón que SendMessage). El array de adjuntos ya está poblado en msg.
	ws.GlobalHub.Broadcast(chConversation(companyID, convIDUint), "MessageReceived", msg)
	ws.GlobalHub.Broadcast(chInbox(companyID), "MessageReceived", map[string]any{
		"conversation_id": convIDUint,
		"message":         msg,
	})

	if sendErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"data":    msg,
			"message": "El adjunto se guardó pero no pudo entregarse al proveedor.",
			"error":   sendErr.Error(),
		})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": msg})
}
