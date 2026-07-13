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

// SendInstagram envía un mensaje a Instagram Direct vía Graph API.
// Usa la misma familia de API que Messenger con parámetro adicional para IG.
func SendInstagram(ch *models.Channel, to, body string) (SendResult, error) {
	igBusinessID, _ := ch.Credentials["ig_business_id"].(string)
	token, _ := ch.Credentials["access_token"].(string)

	if igBusinessID == "" || token == "" {
		return SendResult{}, fmt.Errorf("credenciales Instagram incompletas")
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
	if cbErr := instagramBreaker.Call(func() error {
		bodyBytes, _ := json.Marshal(payload)
		apiURL := fmt.Sprintf("https://graph.instagram.com/v18.0/%s/messages", igBusinessID)

		req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("Instagram send: %w", err)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Instagram API %d: %s", resp.StatusCode, string(respBytes))
		}

		var result struct {
			MessageID string `json:"message_id"`
		}
		if err := json.Unmarshal(respBytes, &result); err != nil || result.MessageID == "" {
			return fmt.Errorf("respuesta inválida de Instagram")
		}
		msgID = result.MessageID
		return nil
	}); cbErr != nil {
		return SendResult{}, cbErr
	}

	return SendResult{ExternalID: msgID}, nil
}
