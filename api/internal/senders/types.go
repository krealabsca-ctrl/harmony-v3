// Package senders contiene la lógica para enviar mensajes a través de cada canal.
// Cada función SendX maneja la API del proveedor y devuelve el ID del mensaje enviado.
package senders

// SendResult contiene el resultado de envío de un mensaje.
type SendResult struct {
	ExternalID string
}

// TemplatePayload contiene los datos de una plantilla de mensaje (ej. WhatsApp HSM).
type TemplatePayload struct {
	Name     string
	Language string
	// BodyParams son los valores de los marcadores {{1}}, {{2}}… del cuerpo, en
	// orden. Meta EXIGE mandarlos: si la plantilla tiene marcadores y el envío no
	// trae parámetros, rechaza el mensaje por cantidad de parámetros incorrecta.
	BodyParams []string
}
