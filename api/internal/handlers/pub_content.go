package handlers

// pub_content.go — Generación de contenido IA y flujo de aprobación iterativa por WhatsApp.
//
// Flujo completo:
//  1. POST /pub/generate  → TriggerPubGeneration
//  2. Claude genera texto + prompt de imagen
//  3. DALL-E 3 genera la imagen
//  4. Si approval_required: envía imagen + texto al aprobador por WhatsApp
//  5. WhatsApp webhook recibe reply → ProcessPubApprovalReply
//     - "aprobado" → marca post como publicado
//     - cualquier otro texto → se toma como feedback, regenera con historial y vuelve al paso 4
//
// Dependencias externas:
//   - Anthropic API  (clave global: config.App.AnthropicKey)
//   - OpenAI API     (clave por empresa: pub_settings.openai_api_key)
//   - Meta Graph API (credenciales por canal WhatsApp: channel.credentials)

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"harmony-api/internal/circuitbreaker"
	"harmony-api/internal/config"
	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// claudePubBreaker protege las llamadas a Claude para generación de contenido.
var claudePubBreaker = circuitbreaker.New(5, 60*time.Second)

// whatsappPubBreaker protege los envíos de aprobación vía WhatsApp.
var whatsappPubBreaker = circuitbreaker.New(5, 60*time.Second)

// pubGenSemaphore limita las goroutines concurrentes de generación de contenido (M-26).
// Cada generación retiene memoria hasta ~165s (Claude + DALL-E + descarga); sin tope,
// muchos usuarios/tenants podrían lanzar un número ilimitado de goroutines de larga vida.
var pubGenSemaphore = make(chan struct{}, 10)

// runPubGeneration ejecuta generatePostForAgent respetando el semáforo y con recover
// para que un panic en background no tumbe el proceso (M-26 / C-27). Si no hay capacidad
// marca el post como error (cuando postID != 0) en lugar de bloquear.
func runPubGeneration(db *gorm.DB, settings *PubSettingsFull, agent *PubAgent, topic string, postID uint, history []map[string]string) {
	select {
	case pubGenSemaphore <- struct{}{}:
	default:
		log.Printf("WARN: generación de contenido rechazada (sin capacidad) company=%d", settings.CompanyID)
		if postID != 0 {
			db.Table("pub_posts").Where("id = ?", postID).Update("status", "error")
		}
		return
	}
	go func() {
		defer func() {
			<-pubGenSemaphore
			if r := recover(); r != nil {
				log.Printf("PANIC en generatePostForAgent: %v", r)
			}
		}()
		generatePostForAgent(db, settings, agent, topic, postID, history)
	}()
}

// ─── Modelos extendidos ───────────────────────────────────────────────────────

// PubPostFull extiende PubPost con los campos añadidos en la migración 012.
type PubPostFull struct {
	ID              uint            `gorm:"primarykey" json:"id"`
	CompanyID       uint            `json:"company_id"`
	AgentID         *uint           `gorm:"column:agent_id" json:"agent_id"`
	Title           string          `json:"title"`
	Body            string          `json:"body"`
	Platforms       json.RawMessage `gorm:"type:jsonb" json:"platforms"`
	Status          string          `json:"status"`
	ScheduledAt     *time.Time      `json:"scheduled_at"`
	PublishedAt     *time.Time      `json:"published_at"`
	ImageURL        string          `gorm:"column:image_url" json:"image_url"`
	ImagePath       string          `gorm:"column:image_path" json:"image_path"`
	ApprovalStatus  string          `gorm:"column:approval_status" json:"approval_status"`
	ApprovalWAMsgID string          `gorm:"column:approval_wa_message_id" json:"approval_wa_message_id"`
	ApprovalPhone   string          `gorm:"column:approval_phone" json:"approval_phone"`
	RevisionHistory json.RawMessage `gorm:"column:revision_history;type:jsonb" json:"revision_history"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

func (PubPostFull) TableName() string { return "pub_posts" }

// PubSettingsFull extiende PubSettings con los campos añadidos en las migraciones 012 y 013.
type PubSettingsFull struct {
	ID                   uint            `gorm:"primarykey" json:"id"`
	CompanyID            uint            `json:"company_id"`
	DefaultCurrency      string          `json:"default_currency"`
	MonthlyBudgetLimit   float64         `json:"monthly_budget_limit"`
	AutoApproveThreshold float64         `json:"auto_approve_threshold"`
	NotificationEmails   json.RawMessage `gorm:"type:jsonb" json:"notification_emails"`
	OpenAIApiKey         string          `gorm:"column:openai_api_key" json:"-"` // B-11: nunca serializar la API key
	ApprovalRequired     bool            `gorm:"column:approval_required" json:"approval_required"`
	ApprovalPhone        string          `gorm:"column:approval_phone" json:"approval_phone"`
	ImageStyle           string          `gorm:"column:image_style" json:"image_style"`
	WaChannelID          *uint           `gorm:"column:wa_channel_id" json:"wa_channel_id"`
	LeadThreshold        int             `gorm:"column:lead_threshold" json:"lead_threshold"`
	LeadWhatsappNumbers  string          `gorm:"column:lead_whatsapp_numbers" json:"lead_whatsapp_numbers"`
	LeadKeywords         string          `gorm:"column:lead_keywords" json:"lead_keywords"`
	CreatedAt            time.Time       `json:"created_at"`
	UpdatedAt            time.Time       `json:"updated_at"`
}

func (PubSettingsFull) TableName() string { return "pub_settings" }

// ─── Claude: generación de texto ─────────────────────────────────────────────

type generatedContent struct {
	Caption     string   `json:"caption"`
	Hashtags    []string `json:"hashtags"`
	ImagePrompt string   `json:"image_prompt"`
}

// callClaudeForCaption genera caption + hashtags + prompt de imagen usando Claude.
// revisionHistory contiene las revisiones anteriores con el feedback recibido.
func callClaudeForCaption(
	anthropicKey, topic string,
	kit *PubBrandKit,
	docs []PubDocument,
	platforms []string,
	revisionHistory []map[string]string,
) (generatedContent, error) {
	var zero generatedContent

	// ── System prompt con contexto de Brand Kit ────────────────────────────────
	system := "Eres un experto en marketing de contenido y redes sociales. Generas contenido atractivo, auténtico y optimizado para cada plataforma."

	if kit != nil && kit.ID != 0 {
		if kit.Tone != "" {
			system += fmt.Sprintf("\n\nTono de marca: %s.", kit.Tone)
		}
		if kit.TargetAudience != "" {
			system += fmt.Sprintf("\nPúblico objetivo: %s.", kit.TargetAudience)
		}
		var avoidWords []string
		if json.Unmarshal(kit.AvoidWords, &avoidWords) == nil && len(avoidWords) > 0 {
			system += fmt.Sprintf("\nPalabras a evitar: %s.", strings.Join(avoidWords, ", "))
		}
		if kit.ExtraInstructions != "" {
			system += fmt.Sprintf("\nInstrucciones adicionales: %s", kit.ExtraInstructions)
		}
	}

	// Documentos de conocimiento de la empresa
	for _, doc := range docs {
		if doc.IsActive && doc.ProcessingStatus == "done" && doc.ExtractedText != "" {
			excerpt := doc.ExtractedText
			if len(excerpt) > 2000 {
				excerpt = excerpt[:2000]
			}
			system += fmt.Sprintf("\n\nContexto del documento '%s':\n%s", doc.Name, excerpt)
		}
	}

	system += "\n\nResponde SIEMPRE con JSON válido sin markdown, sin bloques de código, sin explicaciones. Solo el objeto JSON."

	// ── User prompt ────────────────────────────────────────────────────────────
	platformStr := strings.Join(platforms, ", ")
	if platformStr == "" {
		platformStr = "instagram, facebook"
	}

	user := fmt.Sprintf(`Crea una publicación de marketing para el tema: "%s"
Plataformas destino: %s

Responde con este JSON exacto (sin markdown):
{
  "caption": "texto principal de la publicación (máximo 2200 caracteres)",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
  "image_prompt": "descripción detallada en inglés para DALL-E, sin texto en la imagen, estilo profesional"
}`, topic, platformStr)

	// Si hay historial de revisiones, incorporarlo
	if len(revisionHistory) > 0 {
		user += "\n\nHistorial de versiones anteriores (incorpora TODOS los cambios acumulados):"
		for i, rev := range revisionHistory {
			user += fmt.Sprintf("\n  Versión %d — caption: %s | Cambio solicitado: %s",
				i+1, truncateStr(rev["caption"], 200), rev["feedback"])
		}
		user += "\n\nGenera la siguiente versión aplicando todos los cambios indicados."
	}

	// ── Llamada a la API de Claude ─────────────────────────────────────────────
	payload := map[string]any{
		"model":      "claude-sonnet-4-6",
		"max_tokens": 1500,
		"system":     system,
		"messages":   []map[string]any{{"role": "user", "content": user}},
	}
	bodyBytes, _ := json.Marshal(payload)

	var rawText string
	if cbErr := claudePubBreaker.Call(func() error {
		req, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", anthropicKey)
		req.Header.Set("anthropic-version", "2023-06-01")
		client := &http.Client{Timeout: 45 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("Claude request: %w", err)
		}
		defer resp.Body.Close()
		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Claude API %d: %s", resp.StatusCode, string(respBytes))
		}
		var claudeResp struct {
			Content []struct{ Text string `json:"text"` } `json:"content"`
		}
		if err := json.Unmarshal(respBytes, &claudeResp); err != nil || len(claudeResp.Content) == 0 {
			return fmt.Errorf("respuesta inválida de Claude")
		}
		rawText = claudeResp.Content[0].Text
		return nil
	}); cbErr != nil {
		return zero, cbErr
	}

	// Limpiar posibles delimitadores markdown que Claude a veces incluye
	raw := strings.TrimSpace(rawText)
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	raw = strings.TrimSpace(raw)

	var gen generatedContent
	if err := json.Unmarshal([]byte(raw), &gen); err != nil {
		return zero, fmt.Errorf("JSON inválido de Claude: %w — raw: %s", err, raw)
	}
	return gen, nil
}

// ─── DALL-E 3: generación de imagen ──────────────────────────────────────────

var imageStyleDescriptions = map[string]string{
	"realistic":   "photorealistic, high quality, professional",
	"illustrated": "illustrated, modern artistic style, vibrant colors",
	"minimalist":  "minimalist, clean design, elegant, simple",
	"3d":          "3D rendered, high quality, depth and shadows",
}

// callDallE genera una imagen con DALL-E 3 y devuelve la URL temporal de OpenAI.
func callDallE(openaiKey, imagePrompt, style, tone string) (string, error) {
	styleDesc, ok := imageStyleDescriptions[style]
	if !ok {
		styleDesc = imageStyleDescriptions["realistic"]
	}

	prompt := fmt.Sprintf(
		"Marketing image, %s. Subject: %s. Brand tone: %s. "+
			"NO text overlay, NO watermarks, NO letters on the image. "+
			"Professional, high resolution, suitable for social media.",
		styleDesc, imagePrompt, tone,
	)

	payload := map[string]any{
		"model":   "dall-e-3",
		"prompt":  prompt,
		"n":       1,
		"size":    "1024x1024",
		"quality": "standard",
	}
	bodyBytes, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", "https://api.openai.com/v1/images/generations", bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("DALL-E request build: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+openaiKey)

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("DALL-E request: %w", err)
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("DALL-E API %d: %s", resp.StatusCode, string(respBytes))
	}

	var result struct {
		Data []struct{ URL string `json:"url"` } `json:"data"`
	}
	if err := json.Unmarshal(respBytes, &result); err != nil || len(result.Data) == 0 {
		return "", fmt.Errorf("respuesta inválida de DALL-E")
	}
	return result.Data[0].URL, nil
}

// downloadAndSaveImage descarga la imagen generada por DALL-E y la guarda localmente.
// La URL de OpenAI expira en ~1 hora, por eso se descarga inmediatamente.
func downloadAndSaveImage(companyID uint, imageURL string) (string, error) {
	// B-03: solo aceptar URLs https del CDN de OpenAI/Azure Blob para acotar SSRF.
	u, err := url.Parse(imageURL)
	if err != nil || u.Scheme != "https" ||
		!(strings.HasSuffix(u.Hostname(), ".openai.com") ||
			strings.HasSuffix(u.Hostname(), ".oaiusercontent.com") ||
			strings.HasSuffix(u.Hostname(), ".blob.core.windows.net")) {
		return "", fmt.Errorf("URL de imagen no permitida")
	}

	// FIX: Timeout explícito para evitar que la goroutine quede bloqueada indefinidamente
	httpClient := &http.Client{Timeout: 30 * time.Second}
	resp, err := httpClient.Get(imageURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	dir := fmt.Sprintf("uploads/company_%d/pub/posts", companyID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	filename := fmt.Sprintf("%d.png", time.Now().UnixNano())
	localPath := filepath.Join(dir, filename)

	f, err := os.Create(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	// C-05: limitar el tamaño de la descarga (20 MB) para no llenar el disco.
	_, err = io.Copy(f, io.LimitReader(resp.Body, 20<<20))
	return localPath, err
}

// ─── WhatsApp: envío del mensaje de aprobación ───────────────────────────────

type waCredentials struct {
	PhoneNumberID string
	AccessToken   string
}

func loadWaCredentials(db *gorm.DB, channelID uint) (*waCredentials, error) {
	var ch models.Channel
	if err := db.First(&ch, channelID).Error; err != nil {
		return nil, fmt.Errorf("canal %d no encontrado", channelID)
	}
	if ch.Type != models.ChannelWhatsApp {
		return nil, fmt.Errorf("canal %d no es WhatsApp", channelID)
	}
	phoneID, _ := ch.Credentials["phone_number_id"].(string)
	token, _ := ch.Credentials["access_token"].(string)
	if phoneID == "" || token == "" {
		return nil, fmt.Errorf("credenciales WhatsApp incompletas en canal %d", channelID)
	}
	return &waCredentials{PhoneNumberID: phoneID, AccessToken: token}, nil
}

// sendWhatsAppApproval envía el post generado al aprobador y devuelve el WA message ID.
// Si imageURL está vacía, envía solo texto.
func sendWhatsAppApproval(wa *waCredentials, toPhone, caption, imageURL string, revision int) (string, error) {
	versionLabel := ""
	if revision > 0 {
		versionLabel = fmt.Sprintf(" (revisión %d)", revision)
	}

	msgBody := fmt.Sprintf(
		"🤖 *Post generado por IA%s*\n\n%s\n\n"+
			"✅ Responde *aprobado* para publicar\n"+
			"✏️ O describe los cambios que deseas",
		versionLabel, truncateStr(caption, 900),
	)

	var payload map[string]any
	if imageURL != "" {
		payload = map[string]any{
			"messaging_product": "whatsapp",
			"to":                toPhone,
			"type":              "image",
			"image":             map[string]any{"link": imageURL, "caption": msgBody},
		}
	} else {
		payload = map[string]any{
			"messaging_product": "whatsapp",
			"to":                toPhone,
			"type":              "text",
			"text":              map[string]any{"body": msgBody},
		}
	}

	bodyBytes, _ := json.Marshal(payload)
	apiURL := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/messages", wa.PhoneNumberID)

	var msgID string
	if cbErr := whatsappPubBreaker.Call(func() error {
		req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+wa.AccessToken)
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
			Messages []struct{ ID string `json:"id"` } `json:"messages"`
		}
		if err := json.Unmarshal(respBytes, &result); err != nil || len(result.Messages) == 0 {
			return fmt.Errorf("respuesta inválida de WhatsApp")
		}
		msgID = result.Messages[0].ID
		return nil
	}); cbErr != nil {
		return "", cbErr
	}
	return msgID, nil
}

// ─── Orquestador: genera → guarda → envía ────────────────────────────────────

// generatePostForAgent ejecuta el ciclo completo de generación para un agente.
// postID=0 → crea un post nuevo. postID>0 → actualiza el post existente (regeneración).
func generatePostForAgent(
	db *gorm.DB,
	settings *PubSettingsFull,
	agent *PubAgent,
	topic string,
	postID uint,
	revisionHistory []map[string]string,
) {
	companyID := settings.CompanyID

	// ── Cargar contexto de Brand Kit y documentos ──────────────────────────────
	var kit PubBrandKit
	db.Where("company_id = ?", companyID).First(&kit)

	var docs []PubDocument
	db.Where("company_id = ? AND is_active = true AND processing_status = 'done'", companyID).Find(&docs)

	var platforms []string
	json.Unmarshal(agent.Platforms, &platforms)

	var agentCfg map[string]any
	json.Unmarshal(agent.Config, &agentCfg)
	imageStyle, _ := agentCfg["image_style"].(string)
	if imageStyle == "" {
		imageStyle = settings.ImageStyle
	}
	if imageStyle == "" {
		imageStyle = "realistic"
	}

	// ── 1. Claude: texto + prompt de imagen ───────────────────────────────────
	gen, err := callClaudeForCaption(config.App.AnthropicKey, topic, &kit, docs, platforms, revisionHistory)
	if err != nil {
		// FIX: No fallar silenciosamente — marcar post como error en la DB
		if postID != 0 {
			db.Table("pub_posts").Where("id = ?", postID).Updates(map[string]any{
				"approval_status": "error",
				"status":          "draft",
			})
		}
		return
	}

	fullCaption := gen.Caption
	if len(gen.Hashtags) > 0 {
		fullCaption += "\n\n" + strings.Join(gen.Hashtags, " ")
	}

	// ── 2. DALL-E 3: imagen ────────────────────────────────────────────────────
	imageURL := ""
	localImagePath := ""
	if settings.OpenAIApiKey != "" {
		tone := kit.Tone
		if tone == "" {
			tone = "profesional"
		}
		if url, err := callDallE(settings.OpenAIApiKey, gen.ImagePrompt, imageStyle, tone); err == nil {
			imageURL = url
			if path, err := downloadAndSaveImage(companyID, imageURL); err == nil {
				localImagePath = path
			}
		}
	}

	// ── 3. Persistir post ──────────────────────────────────────────────────────
	revHistBytes, _ := json.Marshal(revisionHistory)
	if revisionHistory == nil {
		revHistBytes = json.RawMessage("[]")
	}

	revision := len(revisionHistory) // 0 = primera versión

	if postID == 0 {
		// Crear post nuevo
		post := PubPostFull{
			CompanyID:       companyID,
			AgentID:         &agent.ID,
			Title:           truncateStr(topic, 100),
			Body:            fullCaption,
			Platforms:       agent.Platforms,
			Status:          "pending_approval",
			ImageURL:        imageURL,
			ImagePath:       localImagePath,
			ApprovalStatus:  "pending",
			ApprovalPhone:   settings.ApprovalPhone,
			RevisionHistory: revHistBytes,
		}
		if err := db.Create(&post).Error; err != nil {
			return
		}
		postID = post.ID
	} else {
		// Actualizar post existente con la nueva versión
		db.Table("pub_posts").Where("id = ?", postID).Updates(map[string]any{
			"body":              fullCaption,
			"image_url":         imageURL,
			"image_path":        localImagePath,
			"approval_status":   "pending",
			"revision_history":  revHistBytes,
		})
	}

	// ── 4. Enviar aprobación por WhatsApp si está configurado ─────────────────
	if !settings.ApprovalRequired || settings.ApprovalPhone == "" || settings.WaChannelID == nil {
		// Sin aprobación manual → publicar directamente
		db.Table("pub_posts").Where("id = ?", postID).Updates(map[string]any{
			"status":          "published",
			"approval_status": "approved",
		})
		return
	}

	wa, err := loadWaCredentials(db, *settings.WaChannelID)
	if err != nil {
		return
	}

	msgID, err := sendWhatsAppApproval(wa, settings.ApprovalPhone, fullCaption, imageURL, revision)
	if err != nil {
		return
	}

	db.Table("pub_posts").Where("id = ?", postID).Update("approval_wa_message_id", msgID)
}

// ─── HTTP handler: disparar generación ───────────────────────────────────────

// TriggerPubGeneration — POST /pub/generate
// Dispara la generación de contenido para un agente de forma asíncrona.
// Body: { "agent_id": 1, "topic": "Promoción de verano" }
func TriggerPubGeneration(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	var req struct {
		AgentID uint   `json:"agent_id" binding:"required"`
		Topic   string `json:"topic"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	var agent PubAgent
	if err := db.Where("id = ? AND deleted_at IS NULL", req.AgentID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Agente no encontrado"})
		return
	}
	if !agent.Enabled {
		c.JSON(http.StatusBadRequest, gin.H{"message": "El agente está deshabilitado"})
		return
	}
	if agent.Type != "content" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Solo los agentes de tipo 'content' pueden generar posts"})
		return
	}

	// Verificar config de IA
	if config.App.AnthropicKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Clave de Anthropic no configurada"})
		return
	}

	var settings PubSettingsFull
	db.Where("company_id = ?", companyID).First(&settings)
	settings.CompanyID = companyID // garantizar que esté seteado si no existía registro

	if settings.OpenAIApiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Clave de OpenAI no configurada en los ajustes de publicidad"})
		return
	}

	// Determinar tema
	topic := strings.TrimSpace(req.Topic)
	if topic == "" {
		var cfg map[string]any
		json.Unmarshal(agent.Config, &cfg)
		topic, _ = cfg["topic"].(string)
	}
	if topic == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Se requiere un tema (topic) para generar el contenido"})
		return
	}

	// Responder inmediatamente y procesar en background
	runPubGeneration(db, &settings, &agent, topic, 0, nil)

	c.JSON(http.StatusAccepted, gin.H{"message": "Generación iniciada. El post aparecerá en la lista cuando esté listo."})
}

// ─── Procesamiento de replies de aprobación (llamado desde webhook WhatsApp) ─

// normalizePhone deja solo los dígitos de un teléfono para comparar números en
// distintos formatos ("+506 8888-7777" == "50688887777").
func normalizePhone(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ProcessPubApprovalReply evalúa si un mensaje WA entrante es un reply a un post pendiente.
// replyToMsgID es el context.id del mensaje entrante (ID del mensaje original que se envió).
// fromPhone es el remitente del reply de WhatsApp.
// Devuelve true si el mensaje fue procesado como aprobación/feedback (y no debe ir al inbox normal).
func ProcessPubApprovalReply(db *gorm.DB, replyToMsgID, fromPhone, replyText string) bool {
	if replyToMsgID == "" {
		return false
	}

	var post PubPostFull
	if err := db.Where("approval_wa_message_id = ?", replyToMsgID).First(&post).Error; err != nil {
		return false // no hay post pendiente con ese WA message ID
	}

	// C-02: validar que el reply provenga del número aprobador configurado. Sin esto,
	// cualquier contacto que responda al mismo número (citando el message ID) podría
	// aprobar y publicar contenido corporativo sin autorización.
	if normalizePhone(fromPhone) == "" || normalizePhone(fromPhone) != normalizePhone(post.ApprovalPhone) {
		return false
	}

	normalized := strings.ToLower(strings.TrimSpace(replyText))

	if normalized == "aprobado" || normalized == "approved" || normalized == "aprobado." {
		// ── Aprobado → publicar ────────────────────────────────────────────────
		db.Table("pub_posts").Where("id = ?", post.ID).Updates(map[string]any{
			"status":                  "published",
			"approval_status":         "approved",
			"approval_wa_message_id":  "",
		})
		return true
	}

	// ── Feedback → regenerar con historial acumulado ───────────────────────────
	var history []map[string]string
	json.Unmarshal(post.RevisionHistory, &history)

	// FIX: Límite de revisiones para evitar loop infinito de feedback
	const maxRevisions = 10
	if len(history) >= maxRevisions {
		db.Table("pub_posts").Where("id = ?", post.ID).Updates(map[string]any{
			"approval_status":        "rejected",
			"approval_wa_message_id": "",
		})
		return true
	}

	// Agregar versión actual al historial antes de regenerar
	history = append(history, map[string]string{
		"caption":  post.Body,
		"feedback": replyText,
	})

	// Marcar como "regenerando" y limpiar el WA message ID anterior
	db.Table("pub_posts").Where("id = ?", post.ID).Updates(map[string]any{
		"approval_status":        "regenerating",
		"approval_wa_message_id": "",
	})

	// Cargar configuración de la empresa
	var settings PubSettingsFull
	db.Where("company_id = ?", post.CompanyID).First(&settings)
	settings.CompanyID = post.CompanyID

	// Cargar agente si disponible
	var agent PubAgent
	if post.AgentID != nil {
		db.First(&agent, post.AgentID)
	}
	if agent.ID == 0 {
		// Agente no disponible — usar defaults mínimos
		agent = PubAgent{
			CompanyID: post.CompanyID,
			Type:      "content",
			Enabled:   true,
			Platforms: post.Platforms,
		}
	}

	// Regenerar en background con el historial completo
	runPubGeneration(db, &settings, &agent, post.Title, post.ID, history)

	return true
}

// ─── Handler: configuración completa de pub settings ─────────────────────────

// GetPubSettingsFull — GET /pub/settings (reemplaza la versión stub)
func GetPubSettingsFull(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	var s PubSettingsFull
	db.Where("company_id = ?", companyID).First(&s)

	// No exponer la API key completa — solo si está configurada
	hasOpenAI := s.OpenAIApiKey != ""
	maskedKey := ""
	if hasOpenAI && len(s.OpenAIApiKey) > 8 {
		maskedKey = s.OpenAIApiKey[:4] + "****" + s.OpenAIApiKey[len(s.OpenAIApiKey)-4:]
	}

	leadThreshold := s.LeadThreshold
	if leadThreshold == 0 {
		leadThreshold = 70
	}

	c.JSON(http.StatusOK, gin.H{
		"default_currency":       s.DefaultCurrency,
		"monthly_budget_limit":   s.MonthlyBudgetLimit,
		"approval_required":      s.ApprovalRequired,
		"approval_phone":         s.ApprovalPhone,
		"image_style":            s.ImageStyle,
		"wa_channel_id":          s.WaChannelID,
		"has_openai_key":         hasOpenAI,
		"openai_api_key_masked":  maskedKey,
		"lead_threshold":         leadThreshold,
		"lead_whatsapp_numbers":  s.LeadWhatsappNumbers,
		"lead_keywords":          s.LeadKeywords,
	})
}

// UpdatePubSettingsFull — PUT /pub/settings (reemplaza la versión stub)
func UpdatePubSettingsFull(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	var req struct {
		DefaultCurrency     string  `json:"default_currency"`
		MonthlyBudgetLimit  float64 `json:"monthly_budget_limit"`
		ApprovalRequired    bool    `json:"approval_required"`
		ApprovalPhone       string  `json:"approval_phone"`
		ImageStyle          string  `json:"image_style"`
		WaChannelID         *uint   `json:"wa_channel_id"`
		OpenAIApiKey        string  `json:"openai_api_key"` // vacío = no cambiar
		LeadThreshold       int     `json:"lead_threshold"`
		LeadWhatsappNumbers string  `json:"lead_whatsapp_numbers"`
		LeadKeywords        string  `json:"lead_keywords"`
	}
	// B-02: validar el bind; un body malformado no debe sobrescribir settings con ceros/vacíos.
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	updates := map[string]any{
		"default_currency":      req.DefaultCurrency,
		"monthly_budget_limit":  req.MonthlyBudgetLimit,
		"approval_required":     req.ApprovalRequired,
		"approval_phone":        req.ApprovalPhone,
		"image_style":           req.ImageStyle,
		"wa_channel_id":         req.WaChannelID,
		"lead_threshold":        req.LeadThreshold,
		"lead_whatsapp_numbers": req.LeadWhatsappNumbers,
		"lead_keywords":         req.LeadKeywords,
	}
	if req.OpenAIApiKey != "" {
		updates["openai_api_key"] = req.OpenAIApiKey
	}

	var s PubSettingsFull
	result := db.Where("company_id = ?", companyID).First(&s)
	if result.Error != nil {
		s = PubSettingsFull{
			CompanyID:           companyID,
			DefaultCurrency:     req.DefaultCurrency,
			MonthlyBudgetLimit:  req.MonthlyBudgetLimit,
			ApprovalRequired:    req.ApprovalRequired,
			ApprovalPhone:       req.ApprovalPhone,
			ImageStyle:          req.ImageStyle,
			WaChannelID:         req.WaChannelID,
			LeadThreshold:       req.LeadThreshold,
			LeadWhatsappNumbers: req.LeadWhatsappNumbers,
			LeadKeywords:        req.LeadKeywords,
		}
		if req.OpenAIApiKey != "" {
			s.OpenAIApiKey = req.OpenAIApiKey
		}
		db.Create(&s)
	} else {
		db.Model(&s).Updates(updates)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Configuración guardada"})
}
