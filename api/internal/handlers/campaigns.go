package handlers

// campaigns.go — Handlers HTTP para la gestión de campañas de mensajería masiva.
//
// Este archivo define los modelos de datos, helpers y handlers para el módulo de
// campañas de Harmony. Una campaña representa un envío masivo de mensajes a un
// conjunto de destinatarios a través de un canal (p.ej. WhatsApp). Se admiten
// campañas de tipo broadcast, drip y triggered, con estados: draft, scheduled,
// running, completed, cancelled y failed.
//
// Endpoints cubiertos:
//   GET  /campaigns               → ListCampaigns
//   GET  /campaigns/:id           → GetCampaign
//   POST /campaigns               → CreateCampaign
//   PUT  /campaigns/:id/launch    → LaunchCampaign
//   PUT  /campaigns/:id/cancel    → CancelCampaign
//   GET  /pricing                 → ListPricing

import (
	"bytes"
	"encoding/csv"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// e164Re valida números de teléfono en formato E.164 (M-05). Se aceptan opcionalmente
// con "+" inicial; entre 8 y 15 dígitos, sin ceros iniciales.
var e164Re = regexp.MustCompile(`^\+?[1-9]\d{7,14}$`)

// cleanPhone normaliza y valida un teléfono; devuelve ("", false) si no es válido.
func cleanPhone(p string) (string, bool) {
	p = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", ".", "").Replace(strings.TrimSpace(p))
	if e164Re.MatchString(p) {
		return p, true
	}
	return "", false
}

// ─── Models ───────────────────────────────────────────────────────────────────

// Campaign representa una campaña de mensajería masiva en el sistema.
// Contiene toda la configuración, métricas de envío y metadatos necesarios
// para gestionar el ciclo de vida completo de una campaña.
//
// Campos calculados (no persisten en BD):
//   - ChannelName:  nombre legible del canal asociado
//   - TemplateName: nombre legible de la plantilla de mensaje asociada
type Campaign struct {
	ID              uint           `gorm:"primarykey" json:"id"`
	CompanyID       uint           `gorm:"not null;index" json:"company_id"`
	DepartmentID    *uint          `json:"department_id"`
	ChannelID       *uint          `json:"channel_id"`
	TemplateID      *uint          `json:"template_id"`
	CreatedBy       *uint          `json:"created_by"`
	Name            string         `json:"name"`
	Description     string         `json:"description"`
	Status          string         `json:"status"` // draft, scheduled, running, completed, cancelled, failed
	Type            string         `json:"type"`   // broadcast, drip, triggered
	CountryCode     string         `json:"country_code"`
	CostPerMessage  float64        `json:"cost_per_message"`
	TotalCost       float64        `json:"total_cost"`
	ScheduledAt     *time.Time     `json:"scheduled_at"`
	StartedAt       *time.Time     `json:"started_at"`
	CompletedAt     *time.Time     `json:"completed_at"`
	TotalRecipients int            `json:"total_recipients"`
	SentCount       int            `json:"sent_count"`
	DeliveredCount  int            `json:"delivered_count"`
	ReadCount       int            `json:"read_count"`
	FailedCount     int            `json:"failed_count"`
	VariablesMap    map[string]any `gorm:"serializer:json" json:"variables_map,omitempty"`
	Filters         map[string]any `gorm:"serializer:json" json:"filters,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       *time.Time     `gorm:"index" json:"-"`

	// Calculados (no en BD)
	ChannelName  string `gorm:"-" json:"channel_name"`
	TemplateName string `gorm:"-" json:"template_name"`
}

// TableName indica a GORM el nombre exacto de la tabla en la base de datos.
func (Campaign) TableName() string { return "campaigns" }

// CampaignRecipient representa un destinatario individual dentro de una campaña.
// Registra el número de teléfono, el estado del envío hacia ese contacto
// y cualquier mensaje de error que haya ocurrido durante el proceso.
type CampaignRecipient struct {
	ID           uint       `gorm:"primarykey" json:"id"`
	CampaignID   uint       `json:"campaign_id"`
	Phone        string     `json:"phone"`
	Status       string     `json:"status"` // pending, sent, delivered, failed, read
	ErrorMessage *string    `gorm:"column:error_message" json:"error"`
	SentAt       *time.Time `json:"sent_at"`
}

// TableName indica a GORM el nombre exacto de la tabla en la base de datos.
func (CampaignRecipient) TableName() string { return "campaign_recipients" }

// ─── Helpers ──────────────────────────────────────────────────────────────────

// enrichCampaign agrega información desnormalizada a una campaña consultando
// las tablas relacionadas de canales y plantillas de mensajes.
//
// Parámetros:
//   - db: conexión activa a la base de datos (GORM)
//   - c:  puntero a la campaña que se desea enriquecer (se modifica in-place)
//
// Resultado: los campos ChannelName y TemplateName de la campaña quedan
// poblados si existen los registros correspondientes en la BD.
func enrichCampaign(db *gorm.DB, c *Campaign) {
	// Obtener el nombre del canal solo si la campaña tiene uno asignado
	if c.ChannelID != nil {
		var ch struct{ Name string }
		db.Table("channels").Select("name").Where("id = ?", *c.ChannelID).Scan(&ch)
		c.ChannelName = ch.Name
	}
	// Obtener el nombre de la plantilla solo si la campaña tiene una asignada
	if c.TemplateID != nil {
		var tpl struct{ Name string }
		db.Table("message_templates").Select("name").Where("id = ?", *c.TemplateID).Scan(&tpl)
		c.TemplateName = tpl.Name
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// ListCampaigns devuelve una lista paginada de campañas con soporte de filtro
// por estado. Responde al endpoint GET /campaigns.
//
// Query params aceptados:
//   - page       (int, default 1): número de página solicitada
//   - status[]   ([]string, opcional): filtro por uno o más estados, p.ej.
//                ?status[]=draft&status[]=scheduled
//
// Retorna:
//   200 OK — objeto JSON con las claves:
//     - data:  arreglo de Campaign enriquecidas (con ChannelName y TemplateName)
//     - meta:  metadatos de paginación (current_page, last_page, per_page, total, from, to)
//     - links: arreglo vacío (reservado para hipervínculos HATEOAS)
func ListCampaigns(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	// Parsear el número de página; si es menor a 1 se corrige a 1
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	perPage := 20
	// Fórmula de offset para paginación: (página_actual - 1) × registros_por_página
	offset := (page - 1) * perPage

	// Filtrar por status[]
	statuses := c.QueryArray("status[]")

	q := db.Model(&Campaign{})
	if len(statuses) > 0 {
		q = q.Where("status IN ?", statuses)
	}

	// Contar el total de registros antes de aplicar el límite/offset
	var total int64
	q.Count(&total)

	var campaigns []Campaign
	q.Order("created_at DESC").Limit(perPage).Offset(offset).Find(&campaigns)

	// Enriquecer con nombre de canal y plantilla
	for i := range campaigns {
		enrichCampaign(db, &campaigns[i])
	}

	// Calcular la última página considerando el residuo de la división
	lastPage := int(total) / perPage
	if int(total)%perPage != 0 {
		lastPage++
	}
	if lastPage < 1 {
		lastPage = 1
	}
	// "from" y "to" indican el rango de registros mostrados en esta página
	from := offset + 1
	to := offset + len(campaigns)
	// Si no hay resultados, ambos índices van a cero para evitar mostrar "1-0"
	if total == 0 {
		from = 0
		to = 0
	}

	c.JSON(http.StatusOK, gin.H{
		"data": campaigns,
		"meta": gin.H{
			"current_page": page,
			"last_page":    lastPage,
			"per_page":     perPage,
			"total":        total,
			"from":         from,
			"to":           to,
		},
		"links": []gin.H{},
	})
}

// GetCampaign devuelve el detalle completo de una campaña junto con la lista
// de todos sus destinatarios. Responde al endpoint GET /campaigns/:id.
//
// Path params:
//   - id (int): identificador único de la campaña
//
// Retorna:
//   200 OK  — objeto JSON con la clave "data" que contiene:
//     - campaign:   Campaign enriquecida
//     - recipients: arreglo de CampaignRecipient ordenados por ID ascendente
//   400 Bad Request  — si el ID no es un número válido
//   404 Not Found    — si no existe una campaña con ese ID
func GetCampaign(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "ID inválido"})
		return
	}

	var campaign Campaign
	if err := db.First(&campaign, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Campaña no encontrada"})
		return
	}
	enrichCampaign(db, &campaign)

	var recipients []CampaignRecipient
	db.Where("campaign_id = ?", id).Order("id ASC").Find(&recipients)

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"campaign":   campaign,
			"recipients": recipients,
		},
	})
}

// CreateCampaign crea una nueva campaña en estado "draft" junto con todos sus
// destinatarios. Acepta datos enviados como multipart/form-data, incluyendo
// opcionalmente un archivo CSV con los teléfonos. Responde a POST /campaigns.
//
// Form fields aceptados:
//   - name           (string, requerido): nombre de la campaña
//   - channel_id     (uint, requerido):   ID del canal de envío
//   - template_id    (uint, opcional):    ID de la plantilla de mensaje
//   - phones         (string, opcional):  lista de teléfonos separados por coma
//   - csv_file       (file, opcional):    archivo CSV cuya primera columna son teléfonos
//   - scheduled_at   (string, opcional):  fecha/hora de envío programado (formato "2006-01-02T15:04")
//   - country_code   (string, opcional):  código de país ISO 3166-1 (default "CR")
//   - cost_per_message (float, opcional): costo en USD por mensaje enviado
//
// Retorna:
//   201 Created             — objeto JSON con la campaña recién creada en "data"
//   422 Unprocessable Entity — si faltan campos requeridos o son inválidos
//   500 Internal Server Error — si falla la inserción en la base de datos
func CreateCampaign(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "El nombre es requerido"})
		return
	}

	channelID, err := strconv.ParseUint(c.PostForm("channel_id"), 10, 64)
	if err != nil || channelID == 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Canal requerido"})
		return
	}

	// template_id es opcional; solo se asigna si viene un valor numérico positivo
	var templateID *uint
	if tidStr := c.PostForm("template_id"); tidStr != "" {
		tid, err := strconv.ParseUint(tidStr, 10, 64)
		if err == nil && tid > 0 {
			t := uint(tid)
			templateID = &t
		}
	}

	// Parsear teléfonos enviados como texto separado por comas
	var phones []string
	if phonesStr := c.PostForm("phones"); phonesStr != "" {
		for _, p := range strings.Split(phonesStr, ",") {
			// M-05: validar formato E.164 en vez de solo len >= 8.
			if clean, ok := cleanPhone(p); ok {
				phones = append(phones, clean)
			}
		}
	}

	// Si viene CSV, leer el archivo y agregar los teléfonos de la primera columna
	if file, err := c.FormFile("csv_file"); err == nil {
		// FIX: Limitar tamaño del CSV a 5 MB para evitar DoS por archivos gigantes
		const maxCSVBytes = 5 * 1024 * 1024
		if file.Size > maxCSVBytes {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "El archivo CSV supera el límite de 5 MB"})
			return
		}
		f, err := file.Open()
		if err == nil {
			defer f.Close()
			// M-06: io.ReadAll con LimitReader — f.Read(buf) podía leer parcialmente y
			// truncar el CSV silenciosamente, perdiendo destinatarios sin error.
			buf, readErr := io.ReadAll(io.LimitReader(f, maxCSVBytes))
			if readErr != nil {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "No se pudo leer el CSV"})
				return
			}
			// FIX HIGH-06: límite de filas para prevenir DoS por CSV con millones de líneas
			const maxCSVRows = 50000
			reader := csv.NewReader(bytes.NewReader(buf))
			reader.FieldsPerRecord = -1 // permitir filas con distinto número de columnas
			rows, _ := reader.ReadAll()
			for i, rec := range rows {
				if len(phones) >= maxCSVRows {
					break
				}
				if len(rec) == 0 {
					continue
				}
				// Tomar solo la primera columna de cada fila.
				raw := strings.TrimSpace(rec[0])
				lower := strings.ToLower(raw)
				// Saltar la fila de encabezado si contiene "phone" o "telefono".
				if i == 0 && (lower == "phone" || lower == "telefono") {
					continue
				}
				// M-05: validar formato E.164.
				if clean, ok := cleanPhone(raw); ok {
					phones = append(phones, clean)
				}
			}
		}
	}

	// Parsear la fecha/hora de envío programado en formato ISO local (sin zona horaria)
	var scheduledAt *time.Time
	if saStr := c.PostForm("scheduled_at"); saStr != "" {
		t, err := time.Parse("2006-01-02T15:04", saStr)
		if err == nil {
			scheduledAt = &t
		}
	}

	// País por defecto: Costa Rica (CR)
	countryCode := c.PostForm("country_code")
	if countryCode == "" {
		countryCode = "CR"
	}
	costPerMsg, _ := strconv.ParseFloat(c.PostForm("cost_per_message"), 64)
	// Costo total = costo por mensaje × número de destinatarios únicos
	totalCost := costPerMsg * float64(len(phones))

	chID := uint(channelID)
	createdBy := c.GetUint("user_id")
	camp := Campaign{
		CompanyID:       c.GetUint("company_id"),
		Name:            name,
		ChannelID:       &chID,
		TemplateID:      templateID,
		TotalRecipients: len(phones),
		Status:          "draft",
		Type:            "broadcast",
		ScheduledAt:     scheduledAt,
		CreatedBy:       &createdBy,
		CountryCode:     countryCode,
		CostPerMessage:  costPerMsg,
		TotalCost:       totalCost,
	}
	if err := db.Create(&camp).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al crear la campaña"})
		return
	}

	// Crear destinatarios en lotes de 500 para evitar queries demasiado grandes
	if len(phones) > 0 {
		recipients := make([]CampaignRecipient, len(phones))
		for i, p := range phones {
			recipients[i] = CampaignRecipient{
				CampaignID: camp.ID,
				Phone:      p,
				Status:     "pending",
			}
		}
		db.CreateInBatches(recipients, 500)
	}

	enrichCampaign(db, &camp)
	c.JSON(http.StatusCreated, gin.H{"data": camp})
}

// LaunchCampaign cambia el estado de una campaña de "draft" a "running",
// iniciando así el proceso de envío. Solo campañas en borrador pueden lanzarse.
// Responde al endpoint PUT /campaigns/:id/launch.
//
// Path params:
//   - id (int): identificador único de la campaña
//
// Retorna:
//   200 OK               — campaña actualizada con mensaje de confirmación
//   400 Bad Request      — si el ID no es un número válido
//   404 Not Found        — si no existe una campaña con ese ID
//   422 Unprocessable    — si la campaña no está en estado "draft"
func LaunchCampaign(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	// M-07: verificar el permiso por-usuario can_send_campaigns además del rol. Un admin
	// puede revocar el envío de campañas a un supervisor; ese flag debe respetarse aquí.
	var caller models.User
	if db.First(&caller, c.GetUint("user_id")).Error == nil {
		if caller.Role != models.RoleAdmin && !caller.CanSendCampaigns {
			c.JSON(http.StatusForbidden, gin.H{"message": "Sin permiso para lanzar campañas"})
			return
		}
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "ID inválido"})
		return
	}

	var campaign Campaign
	if err := db.First(&campaign, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Campaña no encontrada"})
		return
	}

	// Solo se permite lanzar campañas que aún estén en borrador
	if campaign.Status != "draft" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Solo se pueden iniciar campañas en estado borrador"})
		return
	}

	db.Model(&campaign).Update("status", "running")
	enrichCampaign(db, &campaign)

	c.JSON(http.StatusOK, gin.H{"data": campaign, "message": "Campaña iniciada correctamente"})
}

// CancelCampaign cancela una campaña que esté en cualquier estado activo,
// registrando la fecha y hora de finalización. Las campañas ya completadas
// o canceladas no pueden volver a cancelarse. Responde a PUT /campaigns/:id/cancel.
//
// Path params:
//   - id (int): identificador único de la campaña
//
// Retorna:
//   200 OK               — campaña actualizada con mensaje de confirmación
//   400 Bad Request      — si el ID no es un número válido
//   404 Not Found        — si no existe una campaña con ese ID
//   422 Unprocessable    — si la campaña ya está en estado "completed" o "cancelled"
func CancelCampaign(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "ID inválido"})
		return
	}

	var campaign Campaign
	if err := db.First(&campaign, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Campaña no encontrada"})
		return
	}

	// No se puede cancelar una campaña que ya terminó (completada o ya cancelada)
	if campaign.Status == "completed" || campaign.Status == "cancelled" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Esta campaña ya no puede cancelarse"})
		return
	}

	// Registrar el momento exacto de la cancelación como fecha de completado
	now := time.Now()
	db.Model(&campaign).Updates(map[string]any{
		"status":       "cancelled",
		"completed_at": now,
	})
	// Actualizar también el struct en memoria para que la respuesta refleje el nuevo estado
	campaign.Status = "cancelled"
	campaign.CompletedAt = &now

	c.JSON(http.StatusOK, gin.H{"data": campaign, "message": "Campaña cancelada"})
}

// ─── Modelo de tarifas WhatsApp ───────────────────────────────────────────────

// WhatsAppPricing representa una fila de la tabla whatsapp_pricing.
// Cada fila tiene los precios por conversación de 24 horas para un país específico,
// separados por categoría de mensaje según el esquema de Meta Business API.
type WhatsAppPricing struct {
	ID             uint      `gorm:"primarykey" json:"id"`
	CountryCode    string    `json:"country_code"`
	CountryName    string    `json:"country_name"`
	Marketing      float64   `json:"marketing"`
	Utility        float64   `json:"utility"`
	Authentication float64   `json:"authentication"`
	Service        float64   `json:"service"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (WhatsAppPricing) TableName() string { return "whatsapp_pricing" }

// ListPricing devuelve todas las tarifas de WhatsApp almacenadas en la base de datos,
// ordenadas por nombre de país. Si la tabla está vacía (no se ejecutó la migración 003),
// devuelve un arreglo vacío para no romper la UI.
//
// Responde a: GET /admin/whatsapp-pricing
//
// Retorna:
//
//	200 OK — { data: WhatsAppPricing[] } ordenado por country_name ASC
func ListPricing(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	// The DB stores one row per (country, category). Pivot to one row per country
	// with marketing/utility/authentication/service columns.
	var rows []WhatsAppPricing
	db.Raw(`SELECT
		MIN(id) AS id,
		country_code,
		MAX(country_name) AS country_name,
		MAX(price_usd) FILTER (WHERE category = 'marketing')      AS marketing,
		MAX(price_usd) FILTER (WHERE category = 'utility')        AS utility,
		MAX(price_usd) FILTER (WHERE category = 'authentication')  AS authentication,
		MAX(price_usd) FILTER (WHERE category = 'service')        AS service,
		MAX(updated_at) AS updated_at,
		MAX(created_at) AS created_at
	FROM whatsapp_pricing
	GROUP BY country_code
	ORDER BY MAX(country_name) ASC`).Scan(&rows)
	c.JSON(http.StatusOK, gin.H{"data": rows})
}

// UpdatePricing actualiza los cuatro campos de precio para un país específico.
// Acepta valores numéricos (float) para marketing, utility, authentication y service.
// El campo updated_at se actualiza automáticamente por GORM.
//
// Parámetros de ruta:
//   - :id — ID del registro whatsapp_pricing a actualizar
//
// Body JSON (todos opcionales; solo se actualizan los campos enviados):
//   - marketing      float64
//   - utility        float64
//   - authentication float64
//   - service        float64
//
// Retorna:
//
//	200 OK   — { data: WhatsAppPricing } con los valores actualizados
//	404      — si el ID no existe
func UpdatePricing(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")

	var row WhatsAppPricing
	if err := db.First(&row, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Tarifa no encontrada"})
		return
	}

	var req struct {
		Marketing      *float64 `json:"marketing"`
		Utility        *float64 `json:"utility"`
		Authentication *float64 `json:"authentication"`
		Service        *float64 `json:"service"`
	}
	c.ShouldBindJSON(&req)

	// Solo actualizar los campos que fueron enviados explícitamente en el body
	updates := map[string]any{}
	if req.Marketing != nil {
		updates["marketing"] = *req.Marketing
	}
	if req.Utility != nil {
		updates["utility"] = *req.Utility
	}
	if req.Authentication != nil {
		updates["authentication"] = *req.Authentication
	}
	if req.Service != nil {
		updates["service"] = *req.Service
	}

	if len(updates) > 0 {
		db.Model(&row).Updates(updates)
		db.First(&row, id) // Recargar para devolver valores actualizados
	}

	c.JSON(http.StatusOK, gin.H{"data": row})
}

// metaNameToCode mapea los nombres de mercado del CSV oficial de Meta al código ISO
// (o código corto ≤10 chars) usado internamente en whatsapp_pricing.country_code.
var metaNameToCode = map[string]string{
	"argentina":                      "AR",
	"brazil":                         "BR",
	"chile":                          "CL",
	"colombia":                       "CO",
	"egypt":                          "EG",
	"france":                         "FR",
	"germany":                        "DE",
	"hong kong":                      "HK",
	"hungary":                        "HU",
	"india":                          "IN",
	"indonesia":                      "ID",
	"israel":                         "IL",
	"italy":                          "IT",
	"malaysia":                       "MY",
	"mexico":                         "MX",
	"netherlands":                    "NL",
	"nigeria":                        "NG",
	"pakistan":                       "PK",
	"peru":                           "PE",
	"poland":                         "PL",
	"qatar":                          "QA",
	"romania":                        "RO",
	"russia":                         "RU",
	"saudi arabia":                   "SA",
	"singapore":                      "SG",
	"south africa":                   "ZA",
	"spain":                          "ES",
	"turkey":                         "TR",
	"united arab emirates":           "AE",
	"united kingdom":                 "GB",
	"north america":                  "NA",
	"rest of africa":                 "ROA",
	"rest of asia pacific":           "ROAPAC",
	"rest of central & eastern europe": "ROCEE",
	"rest of latin america":          "ROLAM",
	"rest of middle east":            "ROME",
	"rest of western europe":         "ROWEU",
	"other":                          "OTHER",
}

// ImportPricingCSV importa tarifas desde el CSV oficial de Meta (WhatsApp Business Platform)
// subido vía multipart/form-data o desde texto pegado en JSON { csv: "..." }.
//
// Formato soportado (Meta rate card):
//
//	Market,Currency,Marketing,Utility,Authentication,Authentication-International,Service
//
// Las primeras filas de comentario y el encabezado se detectan automáticamente.
// Los valores "n/a" se tratan como 0.0.
// Si el país ya existe (por country_code) se actualizan sus precios (upsert).
func ImportPricingCSV(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	// Leer contenido: primero multipart, luego JSON fallback
	var rawBytes []byte
	file, fh, err := c.Request.FormFile("file")
	if err == nil {
		defer file.Close()
		// FIX: Limitar tamaño del CSV a 5 MB para evitar DoS
		const maxImportCSVBytes = 5 * 1024 * 1024
		if fh.Size > maxImportCSVBytes {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "El archivo supera el límite de 5 MB"})
			return
		}
		rawBytes, err = io.ReadAll(file)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "No se pudo leer el archivo"})
			return
		}
	} else {
		var req struct {
			CSV string `json:"csv" binding:"required"`
		}
		if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Sube un archivo CSV o envía el campo csv en el body"})
			return
		}
		rawBytes = []byte(req.CSV)
	}

	// encoding/csv maneja campos con saltos de línea entre comillas (como el header de Meta)
	reader := csv.NewReader(bytes.NewReader(rawBytes))
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true

	parsePrice := func(s string) float64 {
		s = strings.TrimSpace(s)
		if s == "" || strings.EqualFold(s, "n/a") {
			return 0
		}
		v, _ := strconv.ParseFloat(s, 64)
		return v
	}

	imported := 0
	skipped := 0
	headerFound := false

	// Índices de columnas — se detectan del header para ser robustos ante reordenamientos
	colMarket := -1
	colMarketing := -1
	colUtility := -1
	colAuth := -1
	colService := -1

	for {
		record, readErr := reader.Read()
		if readErr != nil {
			break // EOF u otro error de lectura
		}

		// Buscar la fila de encabezado (contiene "Market" o "market")
		if !headerFound {
			for i, cell := range record {
				switch strings.ToLower(strings.TrimSpace(cell)) {
				case "market":
					colMarket = i
				case "marketing":
					colMarketing = i
				case "utility":
					colUtility = i
				case "authentication":
					colAuth = i
				case "service":
					colService = i
				}
			}
			if colMarket >= 0 && colMarketing >= 0 {
				headerFound = true
			}
			continue // esta fila era el header o un comentario, no es dato
		}

		// Filas de datos
		if colMarket < 0 || colMarket >= len(record) {
			skipped++
			continue
		}
		market := strings.TrimSpace(record[colMarket])
		if market == "" {
			skipped++
			continue
		}

		getCol := func(idx int) float64 {
			if idx < 0 || idx >= len(record) {
				return 0
			}
			return parsePrice(record[idx])
		}
		mkt := getCol(colMarketing)
		utl := getCol(colUtility)
		auth := getCol(colAuth)
		svc := getCol(colService)

		// Resolver country_code desde el mapa Meta→ISO
		code, ok := metaNameToCode[strings.ToLower(market)]
		if !ok {
			skipped++
			continue
		}

		// Upsert por country_code
		var existing WhatsAppPricing
		db.Where("country_code = ?", code).First(&existing)
		if existing.ID > 0 {
			db.Model(&existing).Updates(map[string]any{
				"marketing":      mkt,
				"utility":        utl,
				"authentication": auth,
				"service":        svc,
			})
		} else {
			db.Create(&WhatsAppPricing{
				CountryCode:    code,
				CountryName:    market,
				Marketing:      mkt,
				Utility:        utl,
				Authentication: auth,
				Service:        svc,
			})
		}
		imported++
	}

	c.JSON(http.StatusOK, gin.H{"imported": imported, "skipped": skipped})
}
