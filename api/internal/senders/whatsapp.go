package senders

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"harmony-api/internal/models"
)

// SendWhatsApp envía un mensaje de texto o plantilla a WhatsApp vía Graph API.
// Devuelve el ID de mensaje externo (wamid) del proveedor.
func SendWhatsApp(ch *models.Channel, to, body string, tpl *TemplatePayload) (SendResult, error) {
	phoneID, _ := ch.Credentials["phone_number_id"].(string)
	token, _ := ch.Credentials["access_token"].(string)

	if phoneID == "" || token == "" {
		return SendResult{}, fmt.Errorf("credenciales WhatsApp incompletas")
	}

	var msgID string
	var payload map[string]any

	if tpl != nil {
		// Mensaje de plantilla
		payload = map[string]any{
			"messaging_product": "whatsapp",
			"to":                to,
			"type":              "template",
			"template": map[string]any{
				"name": tpl.Name,
				"language": map[string]any{
					"code": tpl.Language,
				},
			},
		}
	} else {
		// Mensaje de texto libre
		payload = map[string]any{
			"messaging_product": "whatsapp",
			"to":                to,
			"type":              "text",
			"text": map[string]any{
				"body": body,
			},
		}
	}

	if cbErr := whatsappBreaker.Call(func() error {
		bodyBytes, _ := json.Marshal(payload)
		apiURL := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/messages", phoneID)

		req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("WhatsApp send: %w", err)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("WhatsApp API %d: %s", resp.StatusCode, string(respBytes))
		}

		var result struct {
			Messages []struct {
				ID string `json:"id"`
			} `json:"messages"`
		}
		if err := json.Unmarshal(respBytes, &result); err != nil || len(result.Messages) == 0 {
			return fmt.Errorf("respuesta inválida de WhatsApp")
		}
		msgID = result.Messages[0].ID
		return nil
	}); cbErr != nil {
		return SendResult{}, cbErr
	}

	return SendResult{ExternalID: msgID}, nil
}

// SendWhatsAppMedia sube un archivo local a la Graph API y lo envía como mensaje
// multimedia. waType debe ser "image", "audio", "video" o "document" (el nombre
// del campo en el payload de envío coincide exactamente con este valor).
// Requiere dos peticiones: (1) subir el archivo a /{phone_number_id}/media para
// obtener un media-id, (2) enviar el mensaje referenciando ese media-id — WhatsApp
// no acepta un link a un servidor propio como el nuestro (ver ServeUpload, exige
// JWT), así que la subida directa es la única opción.
func SendWhatsAppMedia(ch *models.Channel, to, waType, localFilePath, mimeType, caption string) (SendResult, error) {
	phoneID, _ := ch.Credentials["phone_number_id"].(string)
	token, _ := ch.Credentials["access_token"].(string)
	if phoneID == "" || token == "" {
		return SendResult{}, fmt.Errorf("credenciales WhatsApp incompletas")
	}

	var msgID string
	cbErr := whatsappBreaker.Call(func() error {
		mediaID, err := uploadWhatsAppMedia(phoneID, token, localFilePath, mimeType)
		if err != nil {
			return err
		}

		mediaObj := map[string]any{"id": mediaID}
		if caption != "" {
			mediaObj["caption"] = caption
		}
		payload := map[string]any{
			"messaging_product": "whatsapp",
			"to":                to,
			"type":              waType,
			waType:              mediaObj,
		}
		bodyBytes, _ := json.Marshal(payload)
		apiURL := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/messages", phoneID)

		req, reqErr := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
		if reqErr != nil {
			return reqErr
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{Timeout: 15 * time.Second}
		resp, doErr := client.Do(req)
		if doErr != nil {
			return fmt.Errorf("WhatsApp send media: %w", doErr)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("WhatsApp API %d: %s", resp.StatusCode, string(respBytes))
		}

		var result struct {
			Messages []struct {
				ID string `json:"id"`
			} `json:"messages"`
		}
		if err := json.Unmarshal(respBytes, &result); err != nil || len(result.Messages) == 0 {
			return fmt.Errorf("respuesta inválida de WhatsApp")
		}
		msgID = result.Messages[0].ID
		return nil
	})
	if cbErr != nil {
		return SendResult{}, cbErr
	}
	return SendResult{ExternalID: msgID}, nil
}

// uploadWhatsAppMedia sube un archivo local a POST /{phone_number_id}/media (multipart)
// y devuelve el media-id que Meta asigna, usado luego para referenciarlo al enviar.
func uploadWhatsAppMedia(phoneID, token, localFilePath, mimeType string) (string, error) {
	file, err := os.Open(localFilePath)
	if err != nil {
		return "", fmt.Errorf("abrir adjunto: %w", err)
	}
	defer file.Close()

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	writer.WriteField("messaging_product", "whatsapp")
	writer.WriteField("type", mimeType)
	part, err := createMultipartFilePart(writer, "file", filepath.Base(localFilePath), mimeType)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, file); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	apiURL := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/media", phoneID)
	req, err := http.NewRequest("POST", apiURL, &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("subir adjunto a WhatsApp: %w", err)
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("WhatsApp media upload %d: %s", resp.StatusCode, string(respBytes))
	}

	var result struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBytes, &result); err != nil || result.ID == "" {
		return "", fmt.Errorf("respuesta inválida al subir adjunto")
	}
	return result.ID, nil
}
