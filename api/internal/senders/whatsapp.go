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
		plantilla := map[string]any{
			"name": tpl.Name,
			"language": map[string]any{
				"code": tpl.Language,
			},
		}
		// Valores de los marcadores {{1}}, {{2}}… Meta los exige cuando la plantilla
		// los tiene: sin esto rechaza el envío por cantidad de parámetros incorrecta.
		if len(tpl.BodyParams) > 0 {
			params := make([]map[string]any, 0, len(tpl.BodyParams))
			for _, v := range tpl.BodyParams {
				params = append(params, map[string]any{"type": "text", "text": v})
			}
			plantilla["components"] = []map[string]any{
				{"type": "body", "parameters": params},
			}
		}
		payload = map[string]any{
			"messaging_product": "whatsapp",
			"to":                to,
			"type":              "template",
			"template":          plantilla,
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

// MarkWhatsAppRead le indica a Meta que el mensaje entrante messageID (su wamid)
// fue leído por la empresa — es lo que hace que el cliente vea el doble check
// azul en su WhatsApp. No pasa nada del lado de Harmony si no se llama: el
// cliente igual recibe el mensaje entregado (un check), solo no ve confirmación
// de lectura.
func MarkWhatsAppRead(ch *models.Channel, messageID string) error {
	phoneID, _ := ch.Credentials["phone_number_id"].(string)
	token, _ := ch.Credentials["access_token"].(string)
	if phoneID == "" || token == "" {
		return fmt.Errorf("credenciales WhatsApp incompletas")
	}
	if messageID == "" {
		return fmt.Errorf("falta el ID del mensaje a marcar como leído")
	}

	payload := map[string]any{
		"messaging_product": "whatsapp",
		"status":            "read",
		"message_id":        messageID,
	}

	return whatsappBreaker.Call(func() error {
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
			return fmt.Errorf("WhatsApp mark read: %w", err)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("WhatsApp API %d: %s", resp.StatusCode, string(respBytes))
		}
		return nil
	})
}

// SendWhatsAppMedia sube un archivo local a la Graph API y lo envía como mensaje
// multimedia. waType debe ser "image", "audio", "video" o "document" (el nombre
// del campo en el payload de envío coincide exactamente con este valor).
// Requiere dos peticiones: (1) subir el archivo a /{phone_number_id}/media para
// obtener un media-id, (2) enviar el mensaje referenciando ese media-id — WhatsApp
// no acepta un link a un servidor propio como el nuestro (ver ServeUpload, exige
// JWT), así que la subida directa es la única opción.
func SendWhatsAppMedia(ch *models.Channel, to, waType, localFilePath, mimeType, caption, filename string) (SendResult, error) {
	phoneID, _ := ch.Credentials["phone_number_id"].(string)
	token, _ := ch.Credentials["access_token"].(string)
	if phoneID == "" || token == "" {
		return SendResult{}, fmt.Errorf("credenciales WhatsApp incompletas")
	}

	var msgID string
	cbErr := whatsappBreaker.Call(func() error {
		mediaID, err := uploadWhatsAppMedia(phoneID, token, localFilePath, mimeType, filename)
		if err != nil {
			return err
		}

		mediaObj := map[string]any{"id": mediaID}
		if caption != "" {
			mediaObj["caption"] = caption
		}
		// "filename" es lo que WhatsApp muestra en la burbuja del documento del
		// lado del cliente. Sin este campo el archivo llega como "Sin título" aunque
		// el nombre real sí se haya guardado correctamente en Harmony.
		if waType == "document" && filename != "" {
			mediaObj["filename"] = filename
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
func uploadWhatsAppMedia(phoneID, token, localFilePath, mimeType, filename string) (string, error) {
	file, err := os.Open(localFilePath)
	if err != nil {
		return "", fmt.Errorf("abrir adjunto: %w", err)
	}
	defer file.Close()

	if filename == "" {
		filename = filepath.Base(localFilePath)
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	writer.WriteField("messaging_product", "whatsapp")
	writer.WriteField("type", mimeType)
	part, err := createMultipartFilePart(writer, "file", filename, mimeType)
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
