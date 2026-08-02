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
	// Imágenes. Un mensaje de tipo "image" en WhatsApp solo admite JPEG y PNG.
	"image/jpeg": "image",
	"image/png":  "image",
	// WEBP se sube sin problema, pero WhatsApp solo lo acepta como STICKER y los
	// stickers tienen requisitos estrictos (512x512, 100 KB estático / 500 KB
	// animado). Un .webp corriente los incumple y el envío fallaría. Se manda como
	// documento: llega como archivo descargable en vez de imagen incrustada, pero
	// llega siempre, que es lo que importa.
	"image/webp": "document",
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

// Límites de tamaño de Meta por categoría. Superarlos hace fallar la subida con un
// error de Meta poco claro, así que conviene cortar antes y decir el límite real.
const (
	maxImageBytes    int64 = 5 << 20   // 5 MB
	maxAudioBytes    int64 = 16 << 20  // 16 MB
	maxVideoBytes    int64 = 16 << 20  // 16 MB
	maxDocumentBytes int64 = 100 << 20 // 100 MB
)

// WhatsAppMediaSizeLimit devuelve el tope en bytes y su descripción legible para la
// categoría indicada.
func WhatsAppMediaSizeLimit(kind string) (int64, string) {
	switch kind {
	case "image":
		return maxImageBytes, "5 MB"
	case "audio":
		return maxAudioBytes, "16 MB"
	case "video":
		return maxVideoBytes, "16 MB"
	default:
		return maxDocumentBytes, "100 MB"
	}
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
