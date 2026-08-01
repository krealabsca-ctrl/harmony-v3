package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"harmony-api/internal/database"
	"harmony-api/internal/models"
	"harmony-api/internal/senders"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ── Webhook helpers ────────────────────────────────────────────────────────────

// mediaSemaphore limita a 20 las descargas de adjuntos entrantes concurrentes
// (mismo límite y mismo motivo que botSemaphore en inbound.go: evita agotar
// memoria/goroutines si llegan muchos mensajes multimedia a la vez). La descarga
// del adjunto (2 peticiones HTTP al proveedor para WhatsApp/Telegram) se dispara
// en una goroutine para no bloquear la respuesta 200 al webhook — el proveedor
// espera esa respuesta rápido, igual que ya razona runBotFlow para el bot.
var mediaSemaphore = make(chan struct{}, 20)

// processMediaAsync adquiere un cupo de mediaSemaphore (bloqueante si está lleno,
// pero sin bloquear el webhook porque corre en su propia goroutine) y ejecuta fn,
// que debe hacer la descarga del adjunto y llamar a ProcessInboundMedia.
func processMediaAsync(fn func()) {
	go func() {
		mediaSemaphore <- struct{}{}
		defer func() { <-mediaSemaphore }()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("PANIC procesando adjunto entrante: %v", r)
			}
		}()
		fn()
	}()
}

type channelResult struct {
	DB        *gorm.DB
	ChannelID uint
	CompanyID uint
	// WebhookSecret es el token de verificación del webhook: el valor que se
	// registra en Meta como "Verify Token" y que solo se usa en el handshake GET.
	WebhookSecret string
	// AppSecret es la clave secreta de la aplicación de Meta, con la que Meta
	// firma cada notificación (X-Hub-Signature-256). Son DOS valores distintos:
	// confundirlos hace que la verificación pase pero que todos los mensajes
	// entrantes se descarten por firma inválida.
	AppSecret string
}

// signingSecret devuelve la clave con la que validar la firma de Meta: el
// app_secret de las credenciales del canal y, si no está configurado, el
// webhook_secret como respaldo (instalaciones donde ambos se registraron igual).
func (r *channelResult) signingSecret() string {
	if r.AppSecret != "" {
		return r.AppSecret
	}
	return r.WebhookSecret
}

// credAppSecret extrae el app_secret de las credenciales cifradas del canal.
func credAppSecret(ch models.Channel) string {
	if v, ok := ch.Credentials["app_secret"]; ok {
		if s, isStr := v.(string); isStr {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// findChannelByPublicID resuelve el public_id (UUID) de un canal a su DB, ID interno
// y webhook_secret. Usar UUID en las URLs de webhook evita enumerar canales por ID.
//
// C-07: primero consulta channel_lookup en O(1). Solo si no hay entrada (o quedó
// obsoleta) cae al escaneo de empresas, y en ese caso rellena el lookup para que
// las siguientes llamadas sean directas. Esto evita abrir la conexión de TODAS las
// empresas en cada webhook, que agotaba el pool.
func findChannelByPublicID(publicID string) (*channelResult, error) {
	// 1. Camino rápido: lookup directo.
	var lk struct {
		CompanyID uint   `gorm:"column:company_id"`
		DBName    string `gorm:"column:db_name"`
	}
	if err := database.SystemDB.Table("channel_lookup").
		Select("company_id, db_name").
		Where("public_id = ?", publicID).Take(&lk).Error; err == nil {
		if db, e := database.GetCompanyDB(lk.CompanyID, lk.DBName); e == nil {
			var ch models.Channel
			if db.Select("id, webhook_secret, credentials").Where("public_id = ?", publicID).First(&ch).Error == nil {
				return &channelResult{DB: db, ChannelID: ch.ID, CompanyID: lk.CompanyID, WebhookSecret: ch.WebhookSecret, AppSecret: credAppSecret(ch)}, nil
			}
		}
		// Entrada obsoleta (canal borrado o empresa inactiva): eliminarla y reintentar por escaneo.
		database.SystemDB.Exec("DELETE FROM channel_lookup WHERE public_id = ?", publicID)
	}

	// 2. Camino lento: escaneo (solo la primera vez por canal) + backfill del lookup.
	var companies []struct {
		ID     uint   `gorm:"column:id"`
		DBName string `gorm:"column:db_name"`
	}
	database.SystemDB.Table("companies").
		Select("id, db_name").
		Where("is_active = true AND db_name != ''").
		Scan(&companies)

	for _, co := range companies {
		db, err := database.GetCompanyDB(co.ID, co.DBName)
		if err != nil {
			continue
		}
		var ch models.Channel
		if db.Select("id, webhook_secret, credentials").Where("public_id = ?", publicID).First(&ch).Error == nil {
			rememberChannelLookup(publicID, co.ID, co.DBName)
			return &channelResult{DB: db, ChannelID: ch.ID, CompanyID: co.ID, WebhookSecret: ch.WebhookSecret, AppSecret: credAppSecret(ch)}, nil
		}
	}
	return nil, nil
}

// rememberChannelLookup guarda (o actualiza) la resolución public_id → empresa (C-07).
func rememberChannelLookup(publicID string, companyID uint, dbName string) {
	database.SystemDB.Exec(`
		INSERT INTO channel_lookup (public_id, company_id, db_name)
		VALUES (?, ?, ?)
		ON CONFLICT (public_id) DO UPDATE SET company_id = EXCLUDED.company_id, db_name = EXCLUDED.db_name`,
		publicID, companyID, dbName)
}

// verifyMetaSignature valida la firma HMAC-SHA256 incluida por Meta en el header
// X-Hub-Signature-256 de sus webhooks (WhatsApp, Messenger, Instagram).
// Usa hmac.Equal para comparación en tiempo constante y evitar timing attacks.
func verifyMetaSignature(secret string, body []byte, sigHeader string) bool {
	if secret == "" || sigHeader == "" {
		return false
	}
	const prefix = "sha256="
	if len(sigHeader) <= len(prefix) {
		return false
	}
	got, err := hex.DecodeString(sigHeader[len(prefix):])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := mac.Sum(nil)
	return hmac.Equal(got, expected)
}

// maxWebhookBody limita el tamaño del body de un webhook (C-05). Los webhooks son
// endpoints públicos sin autenticación; sin este límite un POST de varios GB agota
// la memoria del proceso (OOM).
const maxWebhookBody = 1 << 20 // 1 MB

// readBodyAndVerifyMeta lee el body (con límite), valida la firma Meta y lo devuelve.
// Devuelve nil si la firma es inválida; Meta siempre recibe 200 OK.
func readBodyAndVerifyMeta(c *gin.Context, secret string) []byte {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxWebhookBody)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{})
		return nil
	}
	sig := c.GetHeader("X-Hub-Signature-256")
	if !verifyMetaSignature(secret, body, sig) {
		// Rechazamos silenciosamente: Meta exige 200 siempre, pero no procesamos.
		c.JSON(http.StatusOK, gin.H{})
		return nil
	}
	return body
}

// verifyMetaSubscription valida el hub.verify_token de un GET de suscripción de
// Meta (WhatsApp/Messenger/Instagram) contra el WebhookSecret del canal (C-03).
// Devuelve true y escribe el challenge si es válido; de lo contrario responde 403.
func verifyMetaSubscription(c *gin.Context) bool {
	res, err := findChannelByPublicID(c.Param("publicId"))
	if err != nil || res == nil {
		c.AbortWithStatus(http.StatusForbidden)
		return false
	}
	if c.Query("hub.mode") != "subscribe" || c.Query("hub.verify_token") != res.WebhookSecret {
		c.AbortWithStatus(http.StatusForbidden)
		return false
	}
	c.String(http.StatusOK, c.Query("hub.challenge"))
	return true
}

// ── WhatsApp ───────────────────────────────────────────────────────────────────

func WhatsAppVerify(c *gin.Context) {
	// Valida hub.verify_token contra el valor almacenado en el canal, evitando que
	// cualquiera pueda confirmar el webhook con solo conocer la URL.
	verifyMetaSubscription(c)
}

func WhatsAppHandle(c *gin.Context) {
	res, err := findChannelByPublicID(c.Param("publicId"))
	if err != nil || res == nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	body := readBodyAndVerifyMeta(c, res.signingSecret())
	if body == nil {
		return // ya respondió 200
	}

	var payload struct {
		Entry []struct {
			Changes []struct {
				Value struct {
					Contacts []struct {
						Profile struct{ Name string `json:"name"` } `json:"profile"`
						WaID    string                              `json:"wa_id"`
					} `json:"contacts"`
					Messages []struct {
						From string `json:"from"`
						ID   string `json:"id"`
						Type string `json:"type"`
						Text struct {
							Body string `json:"body"`
						} `json:"text"`
						// Context contiene el ID del mensaje al que se está respondiendo
						Context struct {
							ID string `json:"id"`
						} `json:"context"`
						// Sub-objetos multimedia: WhatsApp solo llena el que coincide con Type.
						Image struct {
							ID       string `json:"id"`
							MimeType string `json:"mime_type"`
							Caption  string `json:"caption"`
						} `json:"image"`
						Video struct {
							ID       string `json:"id"`
							MimeType string `json:"mime_type"`
							Caption  string `json:"caption"`
						} `json:"video"`
						Audio struct {
							ID       string `json:"id"`
							MimeType string `json:"mime_type"`
						} `json:"audio"`
						Sticker struct {
							ID       string `json:"id"`
							MimeType string `json:"mime_type"`
						} `json:"sticker"`
						Document struct {
							ID       string `json:"id"`
							MimeType string `json:"mime_type"`
							Filename string `json:"filename"`
							Caption  string `json:"caption"`
						} `json:"document"`
					} `json:"messages"`
					// Statuses: actualizaciones de entrega/lectura de mensajes SALIENTES
					// (los que Harmony le mandó al cliente). Status llega como
					// "sent"/"delivered"/"read"/"failed", igual que messages.status.
					Statuses []struct {
						ID     string `json:"id"`
						Status string `json:"status"`
					} `json:"statuses"`
					// Campos del aviso message_template_status_update: Meta lo emite
					// cuando una plantilla cambia de estado (aprobada, rechazada,
					// deshabilitada). Es lo que permite reflejar el estado real sin
					// estar consultando a Meta.
					Event               string `json:"event"`
					MessageTemplateID   int64  `json:"message_template_id"`
					MessageTemplateName string `json:"message_template_name"`
					Reason              string `json:"reason"`
				} `json:"value"`
				// Field identifica el tipo de aviso: "messages" para mensajes y
				// estados de entrega, "message_template_status_update" para plantillas.
				Field string `json:"field"`
			} `json:"changes"`
		} `json:"entry"`
	}

	if err := bindJSON(body, &payload); err != nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	for _, entry := range payload.Entry {
		for _, change := range entry.Changes {
			// Aviso de cambio de estado de una plantilla (aprobada/rechazada por Meta).
			// Llega por el mismo webhook que los mensajes pero con otro "field", así que
			// se atiende antes y se sigue con el resto de changes.
			if change.Field == "message_template_status_update" {
				applyTemplateStatusUpdate(res.DB, res.CompanyID,
					change.Value.MessageTemplateName, change.Value.Event, change.Value.Reason)
				continue
			}

			for _, wMsg := range change.Value.Messages {
				senderName := wMsg.From
				for _, ct := range change.Value.Contacts {
					if ct.WaID == wMsg.From {
						senderName = ct.Profile.Name
						break
					}
				}

				if wMsg.Type == "text" {
					if wMsg.Text.Body == "" {
						continue
					}
					// Si es un reply (context.id presente), verificar si es una aprobación de pub_post.
					// C-02: se pasa wMsg.From para validar que el remitente sea el número aprobador.
					if wMsg.Context.ID != "" {
						if ProcessPubApprovalReply(res.DB, wMsg.Context.ID, wMsg.From, wMsg.Text.Body) {
							continue // procesado como aprobación — no entra al inbox normal
						}
					}
					_ = ProcessInbound(res.DB, res.ChannelID, wMsg.From, senderName, wMsg.Text.Body, wMsg.ID)
					continue
				}

				// Multimedia: resolver mediaID/mimeType/caption/nombre según el tipo. Cualquier
				// otro tipo (location, interactive, reaction, button, etc.) queda fuera de alcance.
				var mediaID, mimeType, caption, filename, msgType string
				switch wMsg.Type {
				case "image":
					mediaID, mimeType, caption, msgType = wMsg.Image.ID, wMsg.Image.MimeType, wMsg.Image.Caption, "image"
				case "video":
					mediaID, mimeType, caption, msgType = wMsg.Video.ID, wMsg.Video.MimeType, wMsg.Video.Caption, "video"
				case "audio":
					mediaID, mimeType, msgType = wMsg.Audio.ID, wMsg.Audio.MimeType, "audio"
				case "sticker":
					mediaID, mimeType, msgType = wMsg.Sticker.ID, wMsg.Sticker.MimeType, "sticker"
				case "document":
					mediaID, mimeType, caption, filename, msgType = wMsg.Document.ID, wMsg.Document.MimeType, wMsg.Document.Caption, wMsg.Document.Filename, "document"
				default:
					continue
				}
				if mediaID == "" {
					continue
				}

				// Descarga y procesamiento en background: Meta espera un 200 rápido y
				// resolver+bajar el adjunto son 2 peticiones HTTP de red que no deben
				// retrasar esa respuesta ni la llegada del mensaje a la bandeja.
				wMsg, senderName, mediaID, mimeType, caption, filename, msgType := wMsg, senderName, mediaID, mimeType, caption, filename, msgType
				processMediaAsync(func() {
					var channel models.Channel
					if res.DB.First(&channel, res.ChannelID).Error != nil {
						return
					}
					fileURL, resolvedMime, size, fetchErr := senders.WhatsAppFetchMedia(&channel, mediaID, res.CompanyID)
					if fetchErr != nil {
						log.Printf("ERROR: descargar adjunto WhatsApp (canal %d): %v", res.ChannelID, fetchErr)
						return
					}
					if mimeType == "" {
						mimeType = resolvedMime
					}
					_ = ProcessInboundMedia(res.DB, res.ChannelID, wMsg.From, senderName, caption, wMsg.ID, InboundAttachment{
						Type: msgType, FileURL: fileURL, OriginalName: filename, MimeType: mimeType, Size: size,
					})
				})
			}

			// Estados de mensajes salientes (entregado/leído). Es trabajo local (sin
			// llamadas HTTP externas), corre sincrónico — no hay razón para diferirlo.
			for _, st := range change.Value.Statuses {
				if st.Status != "sent" && st.Status != "delivered" && st.Status != "read" && st.Status != "failed" {
					continue // valores desconocidos (ej. futuros) se ignoran
				}
				UpdateMessageStatus(res.DB, res.CompanyID, st.ID, st.Status)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{})
}

// ── Messenger ──────────────────────────────────────────────────────────────────

func MessengerVerify(c *gin.Context) {
	// C-03: validar hub.verify_token igual que WhatsApp (antes devolvía el challenge
	// incondicionalmente, permitiendo secuestrar la suscripción del webhook).
	verifyMetaSubscription(c)
}

func MessengerHandle(c *gin.Context) {
	res, err := findChannelByPublicID(c.Param("publicId"))
	if err != nil || res == nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	body := readBodyAndVerifyMeta(c, res.signingSecret())
	if body == nil {
		return
	}

	var payload struct {
		Entry []struct {
			Messaging []struct {
				Sender  struct{ ID string `json:"id"` } `json:"sender"`
				Message struct {
					Mid         string `json:"mid"`
					Text        string `json:"text"`
					Attachments []struct {
						Type    string `json:"type"` // image | audio | video | file
						Payload struct {
							URL string `json:"url"`
						} `json:"payload"`
					} `json:"attachments"`
				} `json:"message"`
				// Delivery trae los mids concretos que se entregaron — igual de
				// preciso que WhatsApp. Read en cambio solo trae un timestamp
				// ("todo lo enviado hasta acá ya se leyó"), sin lista de mensajes.
				Delivery *struct {
					Mids []string `json:"mids"`
				} `json:"delivery"`
				Read *struct {
					Watermark int64 `json:"watermark"`
				} `json:"read"`
			} `json:"messaging"`
		} `json:"entry"`
	}

	if err := bindJSON(body, &payload); err != nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	for _, entry := range payload.Entry {
		for _, ev := range entry.Messaging {
			// M-12: ignorar eventos sin remitente que crearían contactos/conversaciones
			// fantasma. delivery/read SÍ traen sender.id (el contacto que entregó/leyó).
			if ev.Sender.ID == "" {
				continue
			}
			if ev.Delivery != nil {
				for _, mid := range ev.Delivery.Mids {
					UpdateMessageStatus(res.DB, res.CompanyID, mid, "delivered")
				}
				continue
			}
			if ev.Read != nil {
				MarkOutboundReadBefore(res.DB, res.CompanyID, res.ChannelID, ev.Sender.ID, time.UnixMilli(ev.Read.Watermark))
				continue
			}
			if ev.Message.Text != "" {
				_ = ProcessInbound(res.DB, res.ChannelID, ev.Sender.ID, "", ev.Message.Text, ev.Message.Mid)
				continue
			}
			if len(ev.Message.Attachments) == 0 {
				continue
			}

			// messages.type no tiene el valor 'file': Messenger lo usa para
			// documentos genéricos, se traduce a 'document' (único valor válido).
			att := ev.Message.Attachments[0]
			msgType := att.Type
			if msgType == "file" {
				msgType = "document"
			}
			if att.Payload.URL == "" {
				continue
			}

			// Descarga en background: no retrasar la respuesta 200 al webhook.
			ev, msgType, payloadURL := ev, msgType, att.Payload.URL
			processMediaAsync(func() {
				fileURL, mimeType, size, fetchErr := senders.MetaFetchMedia(payloadURL, res.CompanyID)
				if fetchErr != nil {
					log.Printf("ERROR: descargar adjunto Messenger/Instagram (canal %d): %v", res.ChannelID, fetchErr)
					return
				}
				_ = ProcessInboundMedia(res.DB, res.ChannelID, ev.Sender.ID, "", "", ev.Message.Mid, InboundAttachment{
					Type: msgType, FileURL: fileURL, MimeType: mimeType, Size: size,
				})
			})
		}
	}
	c.JSON(http.StatusOK, gin.H{})
}

// ── Instagram ──────────────────────────────────────────────────────────────────

func InstagramVerify(c *gin.Context) {
	// C-03: validar hub.verify_token (comparte lógica y App Secret con Messenger).
	verifyMetaSubscription(c)
}

func InstagramHandle(c *gin.Context) {
	// Instagram DMs comparten estructura con Messenger y usan el mismo App Secret.
	MessengerHandle(c)
}

// ── Telegram ───────────────────────────────────────────────────────────────────

func TelegramHandle(c *gin.Context) {
	res, err := findChannelByPublicID(c.Param("publicId"))
	if err != nil || res == nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	// FIX: El secret es OBLIGATORIO para Telegram. Telegram no tiene firma HMAC
	// como Meta, por lo que el secret es la única capa de autenticación.
	// Si el canal no tiene secret configurado, rechazar el webhook.
	if res.WebhookSecret == "" || c.GetHeader("X-Telegram-Bot-Api-Secret-Token") != res.WebhookSecret {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	// C-05: limitar el tamaño del body también en el webhook de Telegram.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxWebhookBody)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	var payload struct {
		Message struct {
			MessageID int `json:"message_id"`
			From      struct {
				ID        int64  `json:"id"`
				FirstName string `json:"first_name"`
				LastName  string `json:"last_name"`
			} `json:"from"`
			Text string `json:"text"`
			// Photo trae varias resoluciones del mismo archivo; se toma la última
			// (la de mayor calidad). El resto de tipos multimedia vienen ya en un
			// único objeto.
			Photo []struct {
				FileID string `json:"file_id"`
			} `json:"photo"`
			Voice struct {
				FileID   string `json:"file_id"`
				MimeType string `json:"mime_type"`
			} `json:"voice"`
			Audio struct {
				FileID   string `json:"file_id"`
				MimeType string `json:"mime_type"`
			} `json:"audio"`
			Video struct {
				FileID   string `json:"file_id"`
				MimeType string `json:"mime_type"`
			} `json:"video"`
			Document struct {
				FileID   string `json:"file_id"`
				MimeType string `json:"mime_type"`
				FileName string `json:"file_name"`
			} `json:"document"`
			Caption string `json:"caption"`
		} `json:"message"`
	}

	if err := bindJSON(body, &payload); err != nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	senderID := strconv.FormatInt(payload.Message.From.ID, 10)
	senderName := payload.Message.From.FirstName
	if payload.Message.From.LastName != "" {
		senderName += " " + payload.Message.From.LastName
	}
	extID := strconv.Itoa(payload.Message.MessageID)

	if payload.Message.Text != "" {
		_ = ProcessInbound(res.DB, res.ChannelID, senderID, senderName, payload.Message.Text, extID)
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	// Multimedia: revisar cada campo posible en orden. 'voice' no existe como
	// valor de messages.type, se guarda como 'audio' (mismo player en la UI).
	var fileID, mimeType, filename, msgType string
	switch {
	case len(payload.Message.Photo) > 0:
		fileID, msgType = payload.Message.Photo[len(payload.Message.Photo)-1].FileID, "image"
	case payload.Message.Voice.FileID != "":
		fileID, mimeType, msgType = payload.Message.Voice.FileID, payload.Message.Voice.MimeType, "audio"
	case payload.Message.Audio.FileID != "":
		fileID, mimeType, msgType = payload.Message.Audio.FileID, payload.Message.Audio.MimeType, "audio"
	case payload.Message.Video.FileID != "":
		fileID, mimeType, msgType = payload.Message.Video.FileID, payload.Message.Video.MimeType, "video"
	case payload.Message.Document.FileID != "":
		fileID, mimeType, filename, msgType = payload.Message.Document.FileID, payload.Message.Document.MimeType, payload.Message.Document.FileName, "document"
	default:
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	// Descarga y procesamiento en background: Telegram (igual que Meta) espera un
	// 200 rápido, y getFile+descarga son 2 peticiones HTTP que no deben retrasarlo.
	caption := payload.Message.Caption
	processMediaAsync(func() {
		var channel models.Channel
		if res.DB.First(&channel, res.ChannelID).Error != nil {
			return
		}
		fileURL, resolvedMime, size, fetchErr := senders.TelegramFetchMedia(&channel, fileID, res.CompanyID)
		if fetchErr != nil {
			log.Printf("ERROR: descargar adjunto Telegram (canal %d): %v", res.ChannelID, fetchErr)
			return
		}
		if mimeType == "" {
			mimeType = resolvedMime
		}
		_ = ProcessInboundMedia(res.DB, res.ChannelID, senderID, senderName, caption, extID, InboundAttachment{
			Type: msgType, FileURL: fileURL, OriginalName: filename, MimeType: mimeType, Size: size,
		})
	})
	c.JSON(http.StatusOK, gin.H{})
}

// ── helpers ───────────────────────────────────────────────────────────────────

// bindJSON deserializa un []byte ya leído en target.
func bindJSON(body []byte, target any) error {
	return json.Unmarshal(body, target)
}
