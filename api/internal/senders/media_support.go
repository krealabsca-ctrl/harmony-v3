package senders

import "strings"

/*
 * Qué formatos admite cada proveedor.
 *
 * WhatsApp NO acepta cualquier archivo: la API de Meta valida el MIME declarado
 * contra una lista cerrada y rechaza la subida con HTTP 400 si no está. Esto se
 * comprobó contra la cuenta real subiendo archivos de prueba al endpoint /media
 * (sin enviar mensajes): un .ico se rechaza tanto con su MIME real (image/x-icon)
 * como disfrazado de application/octet-stream, y un .zip también. La lista de abajo
 * es exactamente la que devuelve Meta en el mensaje de error.
 *
 * Antes esto no se validaba: classifyMime miraba solo el prefijo del MIME, así que
 * un .ico caía en "image" y se intentaba enviar como imagen de WhatsApp. Meta lo
 * rechazaba, el mensaje quedaba en 'failed' sin external_id (de ahí que tampoco
 * tuviera checks) y el agente no recibía ninguna explicación de por qué.
 */

// whatsappMediaKind devuelve la categoría de mensaje de WhatsApp que corresponde a
// cada MIME admitido. Un MIME ausente del mapa NO se puede enviar por WhatsApp.
var whatsappMediaKind = map[string]string{
	// Imágenes
	"image/jpeg": "image",
	"image/png":  "image",
	"image/webp": "sticker",
	// Audio
	"audio/aac":  "audio",
	"audio/mp4":  "audio",
	"audio/mpeg": "audio",
	"audio/amr":  "audio",
	"audio/ogg":  "audio",
	"audio/opus": "audio",
	// Video
	"video/mp4":  "video",
	"video/3gpp": "video",
	// Documentos
	"application/pdf":         "document",
	"text/plain":              "document",
	"application/msword":      "document",
	"application/vnd.ms-excel": "document",
	"application/vnd.ms-powerpoint": "document",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   "document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         "document",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
}

// WhatsAppSupportsMedia indica si WhatsApp acepta ese MIME y, en caso afirmativo,
// con qué categoría hay que enviarlo (image / audio / video / document / sticker).
func WhatsAppSupportsMedia(mimeType string) (kind string, ok bool) {
	k, ok := whatsappMediaKind[normalizeMime(mimeType)]
	return k, ok
}

// WhatsAppAllowedExtensions es la lista legible de formatos admitidos, para poder
// decirle al agente qué SÍ puede enviar en vez de un "error al enviar" a secas.
const WhatsAppAllowedExtensions = "PDF, TXT, Word (.doc/.docx), Excel (.xls/.xlsx), " +
	"PowerPoint (.ppt/.pptx), JPG, PNG, WEBP, MP3, AAC, OGG, AMR, M4A, MP4 y 3GP"

// normalizeMime deja el MIME en minúsculas y sin parámetros ("text/plain; charset=utf-8"
// llega así desde algunos navegadores y no coincidiría con el mapa).
func normalizeMime(mimeType string) string {
	m := strings.ToLower(strings.TrimSpace(mimeType))
	if i := strings.IndexByte(m, ';'); i >= 0 {
		m = strings.TrimSpace(m[:i])
	}
	return m
}

// NormalizeMime expone la normalización a los handlers.
func NormalizeMime(mimeType string) string { return normalizeMime(mimeType) }
