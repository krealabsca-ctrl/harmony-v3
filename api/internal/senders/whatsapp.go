package senders

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
