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

// SendMessenger envía un mensaje a Facebook Messenger vía Graph API.
// Devuelve el ID de mensaje del proveedor.
func SendMessenger(ch *models.Channel, to, body string) (SendResult, error) {
	pageID, _ := ch.Credentials["page_id"].(string)
	token, _ := ch.Credentials["access_token"].(string)

	if pageID == "" || token == "" {
		return SendResult{}, fmt.Errorf("credenciales Messenger incompletas")
	}

	payload := map[string]any{
		"recipient": map[string]any{
			"id": to,
		},
		"message": map[string]any{
			"text": body,
		},
	}

	var msgID string
	if cbErr := messengerBreaker.Call(func() error {
		bodyBytes, _ := json.Marshal(payload)
		apiURL := fmt.Sprintf("https://graph.facebook.com/v18.0/me/messages")

		req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("Messenger send: %w", err)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Messenger API %d: %s", resp.StatusCode, string(respBytes))
		}

		var result struct {
			MessageID string `json:"message_id"`
		}
		if err := json.Unmarshal(respBytes, &result); err != nil || result.MessageID == "" {
			return fmt.Errorf("respuesta inválida de Messenger")
		}
		msgID = result.MessageID
		return nil
	}); cbErr != nil {
		return SendResult{}, cbErr
	}

	return SendResult{ExternalID: msgID}, nil
}
