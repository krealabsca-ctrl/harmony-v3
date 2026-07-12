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

// SendTelegram envía un mensaje a Telegram Bot API.
// Devuelve el message_id del proveedor.
func SendTelegram(ch *models.Channel, to, body string) (SendResult, error) {
	botToken, _ := ch.Credentials["bot_token"].(string)

	if botToken == "" {
		return SendResult{}, fmt.Errorf("credenciales Telegram incompletas")
	}

	payload := map[string]any{
		"chat_id": to,
		"text":    body,
	}

	var msgID string
	if cbErr := telegramBreaker.Call(func() error {
		bodyBytes, _ := json.Marshal(payload)
		apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)

		req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("Telegram send: %w", err)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Telegram API %d: %s", resp.StatusCode, string(respBytes))
		}

		var result struct {
			OK     bool `json:"ok"`
			Result struct {
				MessageID int `json:"message_id"`
			} `json:"result"`
		}
		if err := json.Unmarshal(respBytes, &result); err != nil || !result.OK {
			return fmt.Errorf("respuesta inválida de Telegram")
		}
		msgID = fmt.Sprintf("%d", result.Result.MessageID)
		return nil
	}); cbErr != nil {
		return SendResult{}, cbErr
	}

	return SendResult{ExternalID: msgID}, nil
}
