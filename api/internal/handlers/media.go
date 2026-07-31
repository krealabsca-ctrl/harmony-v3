package handlers

import "strings"

// classifyMime mapea un MIME type al valor de messages.type correspondiente,
// usado tanto para adjuntos salientes (UploadAttachment) como entrantes
// (los tres webhooks). "document" es el valor por defecto para lo no reconocido.
func classifyMime(mimeType string) string {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	default:
		return "document"
	}
}
