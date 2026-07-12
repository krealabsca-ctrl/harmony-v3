package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"harmony-api/internal/database"
	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ── Webhook helpers ────────────────────────────────────────────────────────────

type channelResult struct {
	DB            *gorm.DB
	ChannelID     uint
	CompanyID     uint
	WebhookSecret string
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
			if db.Select("id, webhook_secret").Where("public_id = ?", publicID).First(&ch).Error == nil {
				return &channelResult{DB: db, ChannelID: ch.ID, CompanyID: lk.CompanyID, WebhookSecret: ch.WebhookSecret}, nil
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
		if db.Select("id, webhook_secret").Where("public_id = ?", publicID).First(&ch).Error == nil {
			rememberChannelLookup(publicID, co.ID, co.DBName)
			return &channelResult{DB: db, ChannelID: ch.ID, CompanyID: co.ID, WebhookSecret: ch.WebhookSecret}, nil
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

	body := readBodyAndVerifyMeta(c, res.WebhookSecret)
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
					} `json:"messages"`
				} `json:"value"`
			} `json:"changes"`
		} `json:"entry"`
	}

	if err := bindJSON(body, &payload); err != nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	for _, entry := range payload.Entry {
		for _, change := range entry.Changes {
			for _, wMsg := range change.Value.Messages {
				if wMsg.Type != "text" || wMsg.Text.Body == "" {
					continue
				}

				// Si es un reply (context.id presente), verificar si es una aprobación de pub_post.
				// C-02: se pasa wMsg.From para validar que el remitente sea el número aprobador.
				if wMsg.Context.ID != "" {
					if ProcessPubApprovalReply(res.DB, wMsg.Context.ID, wMsg.From, wMsg.Text.Body) {
						continue // procesado como aprobación — no entra al inbox normal
					}
				}

				senderName := wMsg.From
				for _, ct := range change.Value.Contacts {
					if ct.WaID == wMsg.From {
						senderName = ct.Profile.Name
						break
					}
				}
				_ = ProcessInbound(res.DB, res.ChannelID, wMsg.From, senderName, wMsg.Text.Body, wMsg.ID)
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

	body := readBodyAndVerifyMeta(c, res.WebhookSecret)
	if body == nil {
		return
	}

	var payload struct {
		Entry []struct {
			Messaging []struct {
				Sender  struct{ ID string `json:"id"` } `json:"sender"`
				Message struct {
					Mid  string `json:"mid"`
					Text string `json:"text"`
				} `json:"message"`
			} `json:"messaging"`
		} `json:"entry"`
	}

	if err := bindJSON(body, &payload); err != nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	for _, entry := range payload.Entry {
		for _, ev := range entry.Messaging {
			// M-12: ignorar eventos sin texto o sin remitente (delivery/read receipts,
			// echos de mensajes salientes) que crearían contactos/conversaciones fantasma.
			if ev.Message.Text == "" || ev.Sender.ID == "" {
				continue
			}
			_ = ProcessInbound(res.DB, res.ChannelID, ev.Sender.ID, "", ev.Message.Text, ev.Message.Mid)
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
		} `json:"message"`
	}

	if err := bindJSON(body, &payload); err != nil || payload.Message.Text == "" {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	senderID := strconv.FormatInt(payload.Message.From.ID, 10)
	senderName := payload.Message.From.FirstName
	if payload.Message.From.LastName != "" {
		senderName += " " + payload.Message.From.LastName
	}
	extID := strconv.Itoa(payload.Message.MessageID)

	_ = ProcessInbound(res.DB, res.ChannelID, senderID, senderName, payload.Message.Text, extID)
	c.JSON(http.StatusOK, gin.H{})
}

// ── helpers ───────────────────────────────────────────────────────────────────

// bindJSON deserializa un []byte ya leído en target.
func bindJSON(body []byte, target any) error {
	return json.Unmarshal(body, target)
}
