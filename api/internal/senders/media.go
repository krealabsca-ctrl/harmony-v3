package senders

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"time"

	"harmony-api/internal/circuitbreaker"
	"harmony-api/internal/models"
)

// MaxInboundMediaBytes limita el tamaño de un adjunto entrante descargado desde
// el proveedor. 20MB cubre con margen los topes de WhatsApp (16MB para
// documento/video, 5MB imagen, 16MB audio) sin arriesgar agotar memoria/disco
// con un adjunto anómalo.
const MaxInboundMediaBytes int64 = 20 << 20

var mediaHTTPClient = &http.Client{Timeout: 30 * time.Second}

// downloadAndStore descarga sourceURL (con Authorization: Bearer bearerToken si no
// está vacío), limitando el body a MaxInboundMediaBytes+1 para detectar archivos
// que exceden el tope sin leerlos por completo (mismo estilo que
// readBodyAndVerifyMeta en handlers/stubs.go), y guarda el resultado en
// uploads/company_<companyID>/attachments/<nombre-único>.
func downloadAndStore(breaker *circuitbreaker.Breaker, sourceURL, bearerToken string, companyID uint) (fileURL, mimeType string, size int64, err error) {
	cbErr := breaker.Call(func() error {
		req, reqErr := http.NewRequest("GET", sourceURL, nil)
		if reqErr != nil {
			return reqErr
		}
		if bearerToken != "" {
			req.Header.Set("Authorization", "Bearer "+bearerToken)
		}
		resp, doErr := mediaHTTPClient.Do(req)
		if doErr != nil {
			return fmt.Errorf("descarga de adjunto: %w", doErr)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			return fmt.Errorf("descarga de adjunto: proveedor respondió %d", resp.StatusCode)
		}

		data, readErr := io.ReadAll(io.LimitReader(resp.Body, MaxInboundMediaBytes+1))
		if readErr != nil {
			return fmt.Errorf("leer adjunto: %w", readErr)
		}
		if int64(len(data)) > MaxInboundMediaBytes {
			return fmt.Errorf("adjunto excede el tamaño máximo permitido (%dMB)", MaxInboundMediaBytes>>20)
		}

		detectedMime := resp.Header.Get("Content-Type")
		if detectedMime == "" {
			detectedMime = http.DetectContentType(data)
		}

		uploadsDir := filepath.Join("uploads", fmt.Sprintf("company_%d", companyID), "attachments")
		if mkErr := os.MkdirAll(uploadsDir, 0755); mkErr != nil {
			return fmt.Errorf("crear directorio de adjuntos: %w", mkErr)
		}

		ext := ""
		if exts, extErr := mime.ExtensionsByType(detectedMime); extErr == nil && len(exts) > 0 {
			ext = exts[0]
		}
		safeName := fmt.Sprintf("%d-%d%s", companyID, time.Now().UnixNano(), ext)
		savePath := filepath.Join(uploadsDir, safeName)

		if writeErr := os.WriteFile(savePath, data, 0644); writeErr != nil {
			return fmt.Errorf("guardar adjunto: %w", writeErr)
		}

		fileURL = fmt.Sprintf("/uploads/company_%d/attachments/%s", companyID, safeName)
		mimeType = detectedMime
		size = int64(len(data))
		return nil
	})
	if cbErr != nil {
		return "", "", 0, cbErr
	}
	return fileURL, mimeType, size, nil
}

// WhatsAppFetchMedia resuelve un media-id de WhatsApp a sus bytes y los guarda
// localmente. Meta exige el access_token en DOS peticiones: primero para resolver
// el media-id a una URL de descarga firmada y temporal, y luego para la propia
// descarga de esa URL (a diferencia de Messenger/Instagram, cuya URL ya es pública).
func WhatsAppFetchMedia(ch *models.Channel, mediaID string, companyID uint) (fileURL, mimeType string, size int64, err error) {
	token, _ := ch.Credentials["access_token"].(string)
	if token == "" {
		return "", "", 0, fmt.Errorf("credenciales WhatsApp incompletas")
	}

	var mediaURL string
	cbErr := whatsappBreaker.Call(func() error {
		apiURL := fmt.Sprintf("https://graph.facebook.com/v18.0/%s", mediaID)
		req, reqErr := http.NewRequest("GET", apiURL, nil)
		if reqErr != nil {
			return reqErr
		}
		req.Header.Set("Authorization", "Bearer "+token)

		resp, doErr := mediaHTTPClient.Do(req)
		if doErr != nil {
			return fmt.Errorf("resolver media-id: %w", doErr)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("WhatsApp media API %d: %s", resp.StatusCode, string(respBytes))
		}

		var result struct {
			URL string `json:"url"`
		}
		if jsonErr := json.Unmarshal(respBytes, &result); jsonErr != nil || result.URL == "" {
			return fmt.Errorf("respuesta inválida al resolver media-id")
		}
		mediaURL = result.URL
		return nil
	})
	if cbErr != nil {
		return "", "", 0, cbErr
	}

	// La descarga en sí reusa el mismo breaker (mismo dominio de fallo: la API de Meta).
	return downloadAndStore(whatsappBreaker, mediaURL, token, companyID)
}

// MetaFetchMedia descarga un adjunto de Messenger/Instagram desde su URL de CDN
// pública (payload.url del webhook) — a diferencia de WhatsApp, no requiere
// Authorization: la URL en sí ya está firmada por Meta y es de un solo uso/corta duración.
func MetaFetchMedia(cdnURL string, companyID uint) (fileURL, mimeType string, size int64, err error) {
	return downloadAndStore(metaCDNBreaker, cdnURL, "", companyID)
}

// TelegramFetchMedia resuelve un file_id de Telegram a sus bytes y los guarda
// localmente. Requiere dos peticiones: getFile (el bot_token va en la URL, no en
// un header) para obtener file_path, y luego la descarga del archivo — esta
// segunda petición no necesita autenticación adicional porque el propio
// file_path/URL actúa como credencial de un solo uso.
func TelegramFetchMedia(ch *models.Channel, fileID string, companyID uint) (fileURL, mimeType string, size int64, err error) {
	botToken, _ := ch.Credentials["bot_token"].(string)
	if botToken == "" {
		return "", "", 0, fmt.Errorf("credenciales Telegram incompletas")
	}

	var filePath string
	cbErr := telegramBreaker.Call(func() error {
		apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/getFile?file_id=%s", botToken, fileID)
		resp, doErr := mediaHTTPClient.Get(apiURL)
		if doErr != nil {
			return fmt.Errorf("resolver file_id: %w", doErr)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Telegram getFile API %d: %s", resp.StatusCode, string(respBytes))
		}

		var result struct {
			OK     bool `json:"ok"`
			Result struct {
				FilePath string `json:"file_path"`
			} `json:"result"`
		}
		if jsonErr := json.Unmarshal(respBytes, &result); jsonErr != nil || !result.OK || result.Result.FilePath == "" {
			return fmt.Errorf("respuesta inválida al resolver file_id")
		}
		filePath = result.Result.FilePath
		return nil
	})
	if cbErr != nil {
		return "", "", 0, cbErr
	}

	downloadURL := fmt.Sprintf("https://api.telegram.org/file/bot%s/%s", botToken, filePath)
	return downloadAndStore(telegramBreaker, downloadURL, "", companyID)
}

// createMultipartFilePart agrega una parte de archivo a un multipart.Writer con
// el Content-Type real del archivo. writer.CreateFormFile de la librería estándar
// fija "application/octet-stream" sin importar el archivo — los proveedores
// (confirmado con Meta: "Received file of type 'application/octet-stream'")
// rechazan la subida si el Content-Type no coincide con un tipo soportado, así
// que hay que fijarlo explícitamente. filename debe ser solo el nombre base, sin
// la ruta local del servidor.
func createMultipartFilePart(writer *multipart.Writer, fieldname, filename, mimeType string) (io.Writer, error) {
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, fieldname, filename))
	h.Set("Content-Type", mimeType)
	return writer.CreatePart(h)
}

// sendMetaAttachment sube un archivo local directo en el POST de envío (campo
// "filedata") a la URL de mensajería de Meta (Messenger o Instagram, mismo
// formato). Se usa en vez de "payload.url" porque nuestros adjuntos salientes
// viven en /uploads, que exige JWT — Meta no podría autenticarse para bajarlos.
func sendMetaAttachment(breaker *circuitbreaker.Breaker, apiURL, token, to, attachType, localFilePath, mimeType, filename string) (SendResult, error) {
	file, err := os.Open(localFilePath)
	if err != nil {
		return SendResult{}, fmt.Errorf("abrir adjunto: %w", err)
	}
	defer file.Close()

	if filename == "" {
		filename = filepath.Base(localFilePath)
	}
	recipientJSON, _ := json.Marshal(map[string]any{"id": to})
	messageJSON, _ := json.Marshal(map[string]any{
		"attachment": map[string]any{
			"type":    attachType,
			"payload": map[string]any{"is_reusable": true},
		},
	})

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	writer.WriteField("recipient", string(recipientJSON))
	writer.WriteField("message", string(messageJSON))
	part, err := createMultipartFilePart(writer, "filedata", filename, mimeType)
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
	cbErr := breaker.Call(func() error {
		req, reqErr := http.NewRequest("POST", apiURL, bytes.NewReader(buf.Bytes()))
		if reqErr != nil {
			return reqErr
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, doErr := client.Do(req)
		if doErr != nil {
			return fmt.Errorf("enviar adjunto: %w", doErr)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Meta API %d: %s", resp.StatusCode, string(respBytes))
		}

		var result struct {
			MessageID string `json:"message_id"`
		}
		if jsonErr := json.Unmarshal(respBytes, &result); jsonErr != nil || result.MessageID == "" {
			return fmt.Errorf("respuesta inválida al enviar adjunto")
		}
		msgID = result.MessageID
		return nil
	})
	if cbErr != nil {
		return SendResult{}, cbErr
	}
	return SendResult{ExternalID: msgID}, nil
}

// sendMetaSenderAction llama a la Send API con un "sender_action" — mark_seen es
// lo que le muestra al cliente que su mensaje fue visto (el equivalente de Meta
// al doble check azul de WhatsApp para Messenger/Instagram). A diferencia de
// WhatsApp, Meta no pide el ID de un mensaje puntual acá: mark_seen marca como
// visto todo lo que el cliente envió hasta ahora.
func sendMetaSenderAction(breaker *circuitbreaker.Breaker, apiURL, token, recipientID, action string) error {
	payload := map[string]any{
		"recipient":     map[string]any{"id": recipientID},
		"sender_action": action,
	}
	bodyBytes, _ := json.Marshal(payload)

	return breaker.Call(func() error {
		req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{Timeout: 15 * time.Second}
		resp, doErr := client.Do(req)
		if doErr != nil {
			return fmt.Errorf("sender_action: %w", doErr)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Meta API %d: %s", resp.StatusCode, string(respBytes))
		}
		return nil
	})
}
