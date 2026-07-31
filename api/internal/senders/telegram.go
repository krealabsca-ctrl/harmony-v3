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

// telegramMediaField traduce el tipo interno de Harmony ("image"/"audio"/"video"/
// "document") al nombre de campo/endpoint que espera el Bot API de Telegram —
// que usa "photo", no "image", para fotos.
type telegramMediaKind struct {
	field    string
	endpoint string
}

var telegramMediaKinds = map[string]telegramMediaKind{
	"image":    {"photo", "sendPhoto"},
	"audio":    {"audio", "sendAudio"},
	"video":    {"video", "sendVideo"},
	"document": {"document", "sendDocument"},
}

// SendTelegramMedia envía un archivo adjunto vía Bot API. msgType debe ser
// "image", "audio", "video" o "document" (tipo interno de Harmony, no el nombre
// de campo de Telegram).
func SendTelegramMedia(ch *models.Channel, to, msgType, localFilePath, mimeType, filename string) (SendResult, error) {
	botToken, _ := ch.Credentials["bot_token"].(string)
	if botToken == "" {
		return SendResult{}, fmt.Errorf("credenciales Telegram incompletas")
	}
	kind, ok := telegramMediaKinds[msgType]
	if !ok {
		return SendResult{}, fmt.Errorf("tipo de adjunto no soportado por Telegram: %s", msgType)
	}

	file, err := os.Open(localFilePath)
	if err != nil {
		return SendResult{}, fmt.Errorf("abrir adjunto: %w", err)
	}
	defer file.Close()

	if filename == "" {
		filename = filepath.Base(localFilePath)
	}
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	writer.WriteField("chat_id", to)
	part, err := createMultipartFilePart(writer, kind.field, filename, mimeType)
	if err != nil {
		return SendResult{}, err
	}
	if _, err := io.Copy(part, file); err != nil {
		return SendResult{}, err
	}
	if err := writer.Close(); err != nil {
		return SendResult{}, err
	}

	var msgID string
	cbErr := telegramBreaker.Call(func() error {
		apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/%s", botToken, kind.endpoint)

		req, reqErr := http.NewRequest("POST", apiURL, bytes.NewReader(buf.Bytes()))
		if reqErr != nil {
			return reqErr
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())

		client := &http.Client{Timeout: 30 * time.Second}
		resp, doErr := client.Do(req)
		if doErr != nil {
			return fmt.Errorf("Telegram send media: %w", doErr)
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
	})
	if cbErr != nil {
		return SendResult{}, cbErr
	}
	return SendResult{ExternalID: msgID}, nil
}
