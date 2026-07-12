package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ─── Models ───────────────────────────────────────────────────────────────────

type PubPost struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	CompanyID   uint            `json:"company_id"`
	Title       string          `json:"title"`
	Body        string          `json:"body"`
	Platforms   json.RawMessage `gorm:"type:jsonb" json:"platforms"`
	Status      string          `json:"status"`
	ScheduledAt *time.Time      `json:"scheduled_at"`
	PublishedAt *time.Time      `json:"published_at"`
	Metrics     json.RawMessage `gorm:"type:jsonb" json:"metrics"`
	CreatedAt   time.Time       `json:"created_at"`
}

func (PubPost) TableName() string { return "pub_posts" }

type PubLead struct {
	ID         uint      `gorm:"primarykey" json:"id"`
	CompanyID  uint      `json:"company_id"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	Phone      string    `json:"phone"`
	Source     string    `json:"source"`
	Platform   string    `json:"platform"`
	Status     string    `json:"status"`
	CampaignID *uint     `json:"campaign_id"`
	CreatedAt  time.Time `json:"created_at"`
}

func (PubLead) TableName() string { return "pub_leads" }

type PubCampaign struct {
	ID          uint            `gorm:"primarykey" json:"id"`
	CompanyID   uint            `json:"company_id"`
	Name        string          `json:"name"`
	Type        string          `gorm:"column:type" json:"type"`
	Platforms   json.RawMessage `gorm:"type:jsonb;column:platforms" json:"platforms"`
	Status      string          `json:"status"`
	BudgetType  string          `json:"budget_type"`
	Budget      float64         `gorm:"column:budget" json:"budget"`
	Spent       float64         `gorm:"column:spent" json:"spent"`
	StartDate   *time.Time      `json:"start_date"`
	EndDate     *time.Time      `json:"end_date"`
	Impressions int             `json:"impressions"`
	Clicks      int             `json:"clicks"`
	Conversions int             `json:"conversions"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
	DeletedAt   *time.Time      `gorm:"index" json:"-"`

	// calculados
	PostsCount int `gorm:"-" json:"posts_count"`
}

func (PubCampaign) TableName() string { return "pub_campaigns" }

type PubSettings struct {
	ID                  uint            `gorm:"primarykey" json:"id"`
	CompanyID           uint            `json:"company_id"`
	DefaultCurrency     string          `json:"default_currency"`
	MonthlyBudgetLimit  float64         `json:"monthly_budget_limit"`
	AutoApproveThreshold float64        `json:"auto_approve_threshold"`
	NotificationEmails  json.RawMessage `gorm:"type:jsonb" json:"notification_emails"`
	CreatedAt           time.Time       `json:"created_at"`
	UpdatedAt           time.Time       `json:"updated_at"`
}

func (PubSettings) TableName() string { return "pub_settings" }

// ─── Dashboard ────────────────────────────────────────────────────────────────

func PubDashboard(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	var postsThisMonth, pendingApproval int64
	now := time.Now()
	firstOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	db.Model(&PubPost{}).Where("created_at >= ?", firstOfMonth).Count(&postsThisMonth)
	db.Model(&PubPost{}).Where("status = ?", "pending_approval").Count(&pendingApproval)

	var leadsCapturados int64
	db.Model(&PubLead{}).Count(&leadsCapturados)

	// Posts recientes: extraemos la primera plataforma del array JSONB para
	// cumplir el contrato del frontend (campo "platform" singular string).
	type rawPost struct {
		ID          uint            `json:"id"`
		Title       string          `json:"title"`
		Platforms   json.RawMessage `json:"platforms"`
		Status      string          `json:"status"`
		ScheduledAt *time.Time      `json:"scheduled_at"`
		Thumbnail   string          `json:"thumbnail"`
	}
	var rawPosts []rawPost
	db.Table("pub_posts").
		Select("id, title, platforms, status, scheduled_at, COALESCE(thumbnail_url, '') AS thumbnail").
		Order("created_at DESC").Limit(5).Scan(&rawPosts)

	type dashPost struct {
		ID          uint       `json:"id"`
		Title       string     `json:"title"`
		Platform    string     `json:"platform"`
		Status      string     `json:"status"`
		ScheduledAt *time.Time `json:"scheduledAt"`
		Thumbnail   string     `json:"thumbnail"`
	}
	recentPosts := make([]dashPost, 0, len(rawPosts))
	for _, p := range rawPosts {
		platform := "instagram"
		var arr []string
		if json.Unmarshal(p.Platforms, &arr) == nil && len(arr) > 0 {
			platform = arr[0]
		}
		recentPosts = append(recentPosts, dashPost{
			ID:          p.ID,
			Title:       p.Title,
			Platform:    platform,
			Status:      p.Status,
			ScheduledAt: p.ScheduledAt,
			Thumbnail:   p.Thumbnail,
		})
	}

	type dashLead struct {
		ID        uint      `json:"id"`
		Name      string    `json:"name"`
		Message   string    `json:"message"`
		Platform  string    `json:"platform"`
		CreatedAt time.Time `json:"createdAt"`
	}
	var rawLeads []struct {
		ID        uint      `json:"id"`
		Name      string    `json:"name"`
		Message   string    `json:"message"`
		Platform  string    `json:"platform"`
		CreatedAt time.Time `json:"created_at"`
	}
	db.Table("pub_leads").
		Select("id, name, COALESCE(message, '') AS message, platform, created_at").
		Order("created_at DESC").Limit(5).Scan(&rawLeads)

	recentLeads := make([]dashLead, 0, len(rawLeads))
	for _, l := range rawLeads {
		recentLeads = append(recentLeads, dashLead{
			ID:        l.ID,
			Name:      l.Name,
			Message:   l.Message,
			Platform:  l.Platform,
			CreatedAt: l.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"kpis": gin.H{
			"postsThisMonth":  postsThisMonth,
			"pendingApproval": pendingApproval,
			"leadsCapturados": leadsCapturados,
			"totalReach":      0,
		},
		"recentPosts": recentPosts,
		"recentLeads": recentLeads,
	})
}

// ─── Posts ────────────────────────────────────────────────────────────────────

func ListPubPosts(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var posts []PubPost
	db.Order("created_at DESC").Find(&posts)
	c.JSON(http.StatusOK, gin.H{"data": posts})
}

func CreatePubPost(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		Title       string     `json:"title" binding:"required"`
		Body        string     `json:"body"`
		Platforms   []string   `json:"platforms"`
		ScheduledAt *time.Time `json:"scheduled_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	platforms, _ := json.Marshal(req.Platforms)
	status := "draft"
	if req.ScheduledAt != nil {
		status = "scheduled"
	}
	post := PubPost{
		CompanyID:   c.GetUint("company_id"),
		Title:       req.Title,
		Body:        req.Body,
		Platforms:   platforms,
		Status:      status,
		ScheduledAt: req.ScheduledAt,
	}
	db.Create(&post)
	c.JSON(http.StatusCreated, gin.H{"data": post})
}

func UpdatePubPost(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	companyID := c.GetUint("company_id")
	var post PubPost
	// FIX IDOR: verificar company_id para evitar acceso cruzado entre empresas
	if err := db.Where("id = ? AND company_id = ?", id, companyID).First(&post).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Post no encontrado"})
		return
	}
	// FIX Mass Assignment: usar struct tipado en lugar de map[string]any
	var req struct {
		Title       string          `json:"title"`
		Body        string          `json:"body"`
		Platforms   json.RawMessage `json:"platforms"`
		Status      string          `json:"status"`
		ScheduledAt *time.Time      `json:"scheduled_at"`
	}
	c.ShouldBindJSON(&req)
	updates := map[string]any{}
	if req.Title != "" {
		updates["title"] = req.Title
	}
	if req.Body != "" {
		updates["body"] = req.Body
	}
	if len(req.Platforms) > 0 {
		updates["platforms"] = req.Platforms
	}
	if req.Status != "" {
		updates["status"] = req.Status
	}
	if req.ScheduledAt != nil {
		updates["scheduled_at"] = req.ScheduledAt
	}
	if len(updates) > 0 {
		db.Model(&post).Updates(updates)
	}
	c.JSON(http.StatusOK, gin.H{"data": post})
}

func DeletePubPost(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	companyID := c.GetUint("company_id")
	// FIX IDOR: verificar ownership antes de eliminar
	db.Where("id = ? AND company_id = ?", id, companyID).Delete(&PubPost{})
	c.JSON(http.StatusNoContent, nil)
}

// ─── Leads ────────────────────────────────────────────────────────────────────

func ListPubLeads(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")
	var leads []PubLead
	// FIX IDOR: filtrar por company_id para no exponer leads de otras empresas
	db.Where("company_id = ?", companyID).Order("created_at DESC").Find(&leads)
	c.JSON(http.StatusOK, gin.H{"data": leads})
}

// ─── Analytics ────────────────────────────────────────────────────────────────

func PubAnalytics(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	platform := c.Query("platform")
	from := c.Query("from")
	to := c.Query("to")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	perPage := 20
	offset := (page - 1) * perPage

	q := db.Model(&PubPost{}).Where("status = ?", "published")
	if platform != "" {
		q = q.Where("? = ANY(platforms::text[])", platform)
	}
	if from != "" {
		q = q.Where("published_at >= ?", from)
	}
	if to != "" {
		q = q.Where("published_at <= ?", to+" 23:59:59")
	}

	var total int64
	q.Count(&total)

	var posts []PubPost
	q.Order("published_at DESC").Limit(perPage).Offset(offset).Find(&posts)

	lastPage := int(total) / perPage
	if int(total)%perPage != 0 {
		lastPage++
	}
	if lastPage < 1 {
		lastPage = 1
	}

	// Build post metrics response
	type PostMetric struct {
		ID           uint    `json:"id"`
		Title        string  `json:"title"`
		Platform     string  `json:"platform"`
		PublishedAt  string  `json:"published_at"`
		Reach        int64   `json:"reach"`
		Likes        int64   `json:"likes"`
		Comments     int64   `json:"comments"`
		Shares       int64   `json:"shares"`
		CTR          float64 `json:"ctr"`
		ThumbnailURL *string `json:"thumbnail_url"`
	}

	toMetric := func(p PubPost) PostMetric {
		var platforms []string
		json.Unmarshal(p.Platforms, &platforms)
		pl := ""
		if len(platforms) > 0 {
			pl = platforms[0]
		}
		var metrics map[string]any
		json.Unmarshal(p.Metrics, &metrics)
		getInt := func(key string) int64 {
			if v, ok := metrics[key]; ok {
				switch n := v.(type) {
				case float64:
					return int64(n)
				case int64:
					return n
				}
			}
			return 0
		}
		getFloat := func(key string) float64 {
			if v, ok := metrics[key]; ok {
				if n, ok := v.(float64); ok {
					return n
				}
			}
			return 0
		}
		pub := ""
		if p.PublishedAt != nil {
			pub = p.PublishedAt.Format(time.RFC3339)
		}
		return PostMetric{
			ID:          p.ID,
			Title:       p.Title,
			Platform:    pl,
			PublishedAt: pub,
			Reach:       getInt("reach"),
			Likes:       getInt("likes"),
			Comments:    getInt("comments"),
			Shares:      getInt("shares"),
			CTR:         getFloat("ctr"),
		}
	}

	postMetrics := make([]PostMetric, len(posts))
	var totalReach, totalLikes, totalComments, totalShares, totalLeads int64
	for i, p := range posts {
		pm := toMetric(p)
		postMetrics[i] = pm
		totalReach += pm.Reach
		totalLikes += pm.Likes
		totalComments += pm.Comments
		totalShares += pm.Shares
	}
	db.Model(&PubLead{}).Count(&totalLeads)

	// Top 3 posts by reach
	topPosts := postMetrics
	if len(topPosts) > 3 {
		topPosts = topPosts[:3]
	}

	c.JSON(http.StatusOK, gin.H{
		"kpis": gin.H{
			"reach":    totalReach,
			"likes":    totalLikes,
			"comments": totalComments,
			"shares":   totalShares,
			"leads":    totalLeads,
		},
		"top_posts": topPosts,
		"posts": gin.H{
			"data":         postMetrics,
			"current_page": page,
			"last_page":    lastPage,
			"per_page":     perPage,
			"total":        total,
			"links":        []gin.H{},
		},
	})
}

// ─── Campaigns (pub) ──────────────────────────────────────────────────────────

func ListPubCampaigns(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	perPage := 20
	offset := (page - 1) * perPage

	var total int64
	db.Model(&PubCampaign{}).Count(&total)

	var campaigns []PubCampaign
	db.Order("created_at DESC").Limit(perPage).Offset(offset).Find(&campaigns)

	for i := range campaigns {
		var cnt int64
		db.Model(&PubPost{}).Where("company_id = ?", campaigns[i].CompanyID).Count(&cnt)
		campaigns[i].PostsCount = int(cnt)
		if campaigns[i].Platforms == nil {
			campaigns[i].Platforms = json.RawMessage("[]")
		}
	}

	lastPage := int(total) / perPage
	if int(total)%perPage != 0 {
		lastPage++
	}
	if lastPage < 1 {
		lastPage = 1
	}

	c.JSON(http.StatusOK, gin.H{
		"data": campaigns,
		"meta": gin.H{
			"current_page": page,
			"last_page":    lastPage,
			"per_page":     perPage,
			"total":        total,
			"from":         offset + 1,
			"to":           offset + len(campaigns),
		},
		"links": []gin.H{},
	})
}

func GetPubCampaign(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	var campaign PubCampaign
	if err := db.First(&campaign, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Campaña no encontrada"})
		return
	}
	var posts []PubPost
	db.Where("company_id = ?", campaign.CompanyID).Find(&posts)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"campaign": campaign, "posts": posts}})
}

func CreatePubCampaign(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		Name       string             `json:"name" binding:"required"`
		Type       string             `json:"type"`
		Platforms  []string           `json:"platforms"`
		BudgetType string             `json:"budget_type"`
		Budget     float64            `json:"budget"`
		StartDate  *time.Time         `json:"start_date"`
		EndDate    *time.Time         `json:"end_date"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	platforms := req.Platforms
	if platforms == nil {
		platforms = []string{}
	}
	platformsJSON, _ := json.Marshal(platforms)
	campaign := PubCampaign{
		CompanyID:  c.GetUint("company_id"),
		Name:       req.Name,
		Type:       req.Type,
		Platforms:  json.RawMessage(platformsJSON),
		BudgetType: req.BudgetType,
		Budget:     req.Budget,
		StartDate:  req.StartDate,
		EndDate:    req.EndDate,
		Status:     "draft",
	}
	db.Create(&campaign)
	c.JSON(http.StatusCreated, gin.H{"data": campaign})
}

func UpdatePubCampaign(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	companyID := c.GetUint("company_id")
	var campaign PubCampaign
	// FIX IDOR: verificar company_id para evitar acceso cruzado
	if err := db.Where("id = ? AND company_id = ?", id, companyID).First(&campaign).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Campaña no encontrada"})
		return
	}
	// FIX Mass Assignment: solo campos editables por el usuario
	var req struct {
		Name       string          `json:"name"`
		Status     string          `json:"status"`
		BudgetType string          `json:"budget_type"`
		Budget     *float64        `json:"budget"`
		StartDate  *time.Time      `json:"start_date"`
		EndDate    *time.Time      `json:"end_date"`
		Platforms  json.RawMessage `json:"platforms"`
	}
	c.ShouldBindJSON(&req)
	updates := map[string]any{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Status != "" {
		updates["status"] = req.Status
	}
	if req.BudgetType != "" {
		updates["budget_type"] = req.BudgetType
	}
	if req.Budget != nil {
		updates["budget"] = *req.Budget
	}
	if req.StartDate != nil {
		updates["start_date"] = req.StartDate
	}
	if req.EndDate != nil {
		updates["end_date"] = req.EndDate
	}
	if len(req.Platforms) > 0 {
		updates["platforms"] = req.Platforms
	}
	if len(updates) > 0 {
		db.Model(&campaign).Updates(updates)
	}
	c.JSON(http.StatusOK, gin.H{"data": campaign})
}

// ─── Settings (pub) ───────────────────────────────────────────────────────────

func GetPubSettings(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	var settings PubSettings
	if err := db.Where("company_id = ?", companyID).First(&settings).Error; err != nil {
		// Return defaults if not configured yet
		c.JSON(http.StatusOK, gin.H{
			"require_approval":      false,
			"approval_whatsapp":     "",
			"lead_score_threshold":  60,
			"lead_alert_numbers":    []string{},
			"lead_keywords":         []string{},
			"platform_limits":       []gin.H{},
			"openai_api_key":        "",
			"default_currency":      "USD",
			"monthly_budget_limit":  0,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"require_approval":     false,
		"approval_whatsapp":    "",
		"lead_score_threshold": 60,
		"lead_alert_numbers":   []string{},
		"lead_keywords":        []string{},
		"platform_limits":      []gin.H{},
		"openai_api_key":       "",
		"default_currency":     settings.DefaultCurrency,
		"monthly_budget_limit": settings.MonthlyBudgetLimit,
	})
}

func UpdatePubSettings(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	var req struct {
		DefaultCurrency      string  `json:"default_currency"`
		MonthlyBudgetLimit   float64 `json:"monthly_budget_limit"`
		AutoApproveThreshold float64 `json:"auto_approve_threshold"`
	}
	c.ShouldBindJSON(&req)

	var settings PubSettings
	result := db.Where("company_id = ?", companyID).First(&settings)
	if result.Error != nil {
		settings = PubSettings{
			CompanyID:       companyID,
			DefaultCurrency: req.DefaultCurrency,
			MonthlyBudgetLimit: req.MonthlyBudgetLimit,
			AutoApproveThreshold: req.AutoApproveThreshold,
		}
		db.Create(&settings)
	} else {
		db.Model(&settings).Updates(map[string]any{
			"default_currency":       req.DefaultCurrency,
			"monthly_budget_limit":   req.MonthlyBudgetLimit,
			"auto_approve_threshold": req.AutoApproveThreshold,
		})
	}

	c.JSON(http.StatusOK, gin.H{"message": "Configuración guardada"})
}

// ─── Agents IA (pub) ──────────────────────────────────────────────────────────

type PubAgent struct {
	ID           uint            `gorm:"primarykey" json:"id"`
	CompanyID    uint            `json:"company_id"`
	Name         string          `json:"name"`
	Type         string          `json:"type"`
	Instructions string          `json:"instructions"`
	Model        string          `gorm:"column:model" json:"model"`
	Enabled      bool            `gorm:"column:enabled" json:"enabled"`
	Platforms    json.RawMessage `gorm:"type:jsonb" json:"platforms"`
	Config       json.RawMessage `gorm:"type:jsonb" json:"config"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
	DeletedAt    *time.Time      `gorm:"index" json:"-"`
}

func (PubAgent) TableName() string { return "pub_agents" }

func ListPubAgents(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	agents := make([]PubAgent, 0)
	db.Where("deleted_at IS NULL").Order("created_at ASC").Find(&agents)

	// Asegurar que platforms y config nunca sean null en JSON
	for i := range agents {
		if len(agents[i].Platforms) == 0 {
			agents[i].Platforms = json.RawMessage("[]")
		}
		if len(agents[i].Config) == 0 {
			agents[i].Config = json.RawMessage("{}")
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": agents})
}

func CreatePubAgent(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		Name         string          `json:"name" binding:"required"`
		Type         string          `json:"type"`
		Model        string          `json:"model"`
		Instructions string          `json:"instructions"`
		Enabled      bool            `json:"enabled"`
		Platforms    json.RawMessage `json:"platforms"`
		Config       json.RawMessage `json:"config"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	agentType := req.Type
	if agentType == "" {
		agentType = "content"
	}
	model := req.Model
	if model == "" {
		model = "claude-sonnet-4-6"
	}
	platforms := req.Platforms
	if len(platforms) == 0 {
		platforms = json.RawMessage("[]")
	}
	cfg := req.Config
	if len(cfg) == 0 {
		cfg = json.RawMessage("{}")
	}
	agent := PubAgent{
		CompanyID:    c.GetUint("company_id"),
		Name:         req.Name,
		Type:         agentType,
		Model:        model,
		Instructions: req.Instructions,
		Enabled:      req.Enabled,
		Platforms:    platforms,
		Config:       cfg,
	}
	db.Create(&agent)
	c.JSON(http.StatusCreated, gin.H{"data": agent})
}

func UpdatePubAgent(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	companyID := c.GetUint("company_id")
	var agent PubAgent
	// FIX IDOR: verificar company_id
	if err := db.Where("id = ? AND company_id = ?", id, companyID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Agente no encontrado"})
		return
	}
	// FIX Mass Assignment: solo campos editables
	var req struct {
		Name         string          `json:"name"`
		Instructions string          `json:"instructions"`
		Model        string          `json:"model"`
		Enabled      *bool           `json:"enabled"`
		Platforms    json.RawMessage `json:"platforms"`
		Config       json.RawMessage `json:"config"`
	}
	c.ShouldBindJSON(&req)
	updates := map[string]any{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Instructions != "" {
		updates["instructions"] = req.Instructions
	}
	if req.Model != "" {
		updates["model"] = req.Model
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if len(req.Platforms) > 0 {
		updates["platforms"] = req.Platforms
	}
	if len(req.Config) > 0 {
		updates["config"] = req.Config
	}
	if len(updates) > 0 {
		db.Model(&agent).Updates(updates)
	}
	// Re-leer para devolver el estado actualizado completo
	db.Where("id = ? AND company_id = ?", id, companyID).First(&agent)
	if len(agent.Platforms) == 0 {
		agent.Platforms = json.RawMessage("[]")
	}
	if len(agent.Config) == 0 {
		agent.Config = json.RawMessage("{}")
	}
	c.JSON(http.StatusOK, gin.H{"data": agent})
}

func DeletePubAgent(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	companyID := c.GetUint("company_id")
	// FIX IDOR: verificar ownership antes de eliminar
	db.Where("id = ? AND company_id = ?", id, companyID).Delete(&PubAgent{})
	c.JSON(http.StatusNoContent, nil)
}

// ─── Comments ─────────────────────────────────────────────────────────────────

type PubComment struct {
	ID           uint       `gorm:"primarykey" json:"id"`
	CompanyID    uint       `json:"company_id"`
	PostID       *uint      `json:"post_id"`
	Platform     string     `json:"platform"`
	AuthorName   string     `json:"author_name"`
	AuthorAvatar string     `json:"author_avatar"`
	Body         string     `json:"body"`
	Sentiment    string     `json:"sentiment"`
	Status       string     `json:"status"`
	RepliedAt    *time.Time `json:"replied_at"`
	ReplyBody    string     `json:"reply_body"`
	ExternalID   string     `json:"external_id"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func (PubComment) TableName() string { return "pub_comments" }

func ListPubComments(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	perPage := 20
	offset := (page - 1) * perPage

	statusFilter := c.Query("status")
	platformFilter := c.Query("platform")
	q := c.Query("q")

	query := db.Model(&PubComment{}).Where("company_id = ?", companyID)
	if statusFilter != "" {
		query = query.Where("status = ?", statusFilter)
	}
	if platformFilter != "" {
		query = query.Where("platform = ?", platformFilter)
	}
	if q != "" {
		like := "%" + q + "%"
		query = query.Where("author_name ILIKE ? OR body ILIKE ?", like, like)
	}

	var total int64
	query.Count(&total)

	comments := make([]PubComment, 0)
	query.Order("created_at DESC").Limit(perPage).Offset(offset).Find(&comments)

	lastPage := int(total) / perPage
	if int(total)%perPage != 0 {
		lastPage++
	}
	if lastPage < 1 {
		lastPage = 1
	}

	// Conteos por estado para los badges
	var cntPending, cntReplied, cntHidden int64
	db.Model(&PubComment{}).Where("company_id = ? AND status = ?", companyID, "pending").Count(&cntPending)
	db.Model(&PubComment{}).Where("company_id = ? AND status = ?", companyID, "replied").Count(&cntReplied)
	db.Model(&PubComment{}).Where("company_id = ? AND status = ?", companyID, "hidden").Count(&cntHidden)

	c.JSON(http.StatusOK, gin.H{
		"data": comments,
		"meta": gin.H{
			"current_page": page,
			"last_page":    lastPage,
			"per_page":     perPage,
			"total":        total,
		},
		"counts": gin.H{
			"pending": cntPending,
			"replied": cntReplied,
			"hidden":  cntHidden,
			"all":     total,
		},
	})
}

func ReplyPubComment(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	companyID := c.GetUint("company_id")

	var comment PubComment
	if err := db.Where("id = ? AND company_id = ?", id, companyID).First(&comment).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Comentario no encontrado"})
		return
	}

	var req struct {
		ReplyBody string `json:"reply_body" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	now := time.Now()
	db.Model(&comment).Updates(map[string]any{
		"reply_body": req.ReplyBody,
		"replied_at": now,
		"status":     "replied",
	})

	c.JSON(http.StatusOK, gin.H{"data": comment})
}

func UpdatePubCommentStatus(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	companyID := c.GetUint("company_id")

	var comment PubComment
	if err := db.Where("id = ? AND company_id = ?", id, companyID).First(&comment).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Comentario no encontrado"})
		return
	}

	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	db.Model(&comment).Update("status", req.Status)
	c.JSON(http.StatusOK, gin.H{"data": comment})
}

// ─── Brand Kit (v2 schema) ────────────────────────────────────────────────────

type PubBrandKit struct {
	ID                uint            `gorm:"primarykey" json:"id"`
	CompanyID         uint            `json:"company_id"`
	LogoPath          string          `gorm:"column:logo_path" json:"logo_path"`
	Colors            json.RawMessage `gorm:"type:jsonb" json:"colors"`
	ContactInfo       json.RawMessage `gorm:"type:jsonb" json:"contact_info"`
	Tone              string          `json:"tone"`
	TargetAudience    string          `json:"target_audience"`
	AvoidWords        json.RawMessage `gorm:"type:jsonb" json:"avoid_words"`
	ExtraInstructions string          `json:"extra_instructions"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

func (PubBrandKit) TableName() string { return "pub_brand_kit" }

func GetPubBrandKit(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	var kit PubBrandKit
	if err := db.Where("company_id = ?", companyID).First(&kit).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{
			"id":                 0,
			"company_id":         companyID,
			"logo_path":          "",
			"colors":             []string{"#6D28D9"},
			"contact_info":       map[string]string{},
			"tone":               "profesional",
			"target_audience":    "",
			"avoid_words":        []string{},
			"extra_instructions": "",
		})
		return
	}
	if kit.Colors == nil {
		kit.Colors = json.RawMessage(`["#6D28D9"]`)
	}
	if kit.ContactInfo == nil {
		kit.ContactInfo = json.RawMessage("{}")
	}
	if kit.AvoidWords == nil {
		kit.AvoidWords = json.RawMessage("[]")
	}
	c.JSON(http.StatusOK, kit)
}

// SavePubBrandKit acepta multipart/form-data para poder recibir el archivo de logo
// junto con los demás campos del brand kit.
func SavePubBrandKit(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	// Campos de texto del formulario
	colorsRaw := c.PostForm("colors")
	if colorsRaw == "" {
		colorsRaw = `["#6D28D9"]`
	}
	contactInfoRaw := c.PostForm("contact_info")
	if contactInfoRaw == "" {
		contactInfoRaw = "{}"
	}
	avoidWordsRaw := c.PostForm("avoid_words")
	if avoidWordsRaw == "" {
		avoidWordsRaw = "[]"
	}
	tone := c.PostForm("tone")
	if tone == "" {
		tone = "profesional"
	}
	targetAudience    := c.PostForm("target_audience")
	extraInstructions := c.PostForm("extra_instructions")

	// Guardar logo si se subió uno nuevo
	logoPath := ""
	file, header, err := c.Request.FormFile("logo")
	if err == nil && header != nil {
		defer file.Close()
		ext := strings.ToLower(filepath.Ext(header.Filename))
		dir := fmt.Sprintf("uploads/company_%d/pub", companyID)
		if mkErr := os.MkdirAll(dir, 0755); mkErr == nil {
			dst := filepath.Join(dir, "logo"+ext)
			if out, oErr := os.Create(dst); oErr == nil {
				io.Copy(out, file)
				out.Close()
				// Ruta relativa que usa ServeUpload
				logoPath = fmt.Sprintf("company_%d/pub/logo%s", companyID, ext)
			}
		}
	}

	updates := map[string]any{
		"colors":              json.RawMessage(colorsRaw),
		"contact_info":        json.RawMessage(contactInfoRaw),
		"avoid_words":         json.RawMessage(avoidWordsRaw),
		"tone":                tone,
		"target_audience":     targetAudience,
		"extra_instructions":  extraInstructions,
	}
	if logoPath != "" {
		updates["logo_path"] = logoPath
	}

	var kit PubBrandKit
	if db.Where("company_id = ?", companyID).First(&kit).Error != nil {
		kit = PubBrandKit{
			CompanyID:         companyID,
			Colors:            json.RawMessage(colorsRaw),
			ContactInfo:       json.RawMessage(contactInfoRaw),
			AvoidWords:        json.RawMessage(avoidWordsRaw),
			Tone:              tone,
			TargetAudience:    targetAudience,
			ExtraInstructions: extraInstructions,
		}
		if logoPath != "" {
			kit.LogoPath = logoPath
		}
		db.Create(&kit)
	} else {
		db.Model(&kit).Updates(updates)
	}

	// Recargar para devolver estado completo
	db.Where("company_id = ?", companyID).First(&kit)
	c.JSON(http.StatusOK, gin.H{"message": "Marca guardada correctamente.", "data": kit})
}

// ─── Pub Documents ─────────────────────────────────────────────────────────────

type PubDocument struct {
	ID               uint      `gorm:"primarykey" json:"id"`
	CompanyID        uint      `json:"company_id"`
	Name             string    `json:"name"`
	FilePath         string    `json:"file_path"`
	MimeType         string    `json:"mime_type"`
	ExtractedText    string    `gorm:"column:extracted_text" json:"-"`
	IsActive         bool      `gorm:"column:is_active" json:"is_active"`
	ProcessingStatus string    `json:"processing_status"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (PubDocument) TableName() string { return "pub_documents" }

func ListPubDocuments(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")
	var docs []PubDocument
	db.Where("company_id = ?", companyID).Order("created_at DESC").Find(&docs)
	if docs == nil {
		docs = []PubDocument{}
	}
	c.JSON(http.StatusOK, gin.H{"data": docs})
}

func UploadPubDocument(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")

	docName := strings.TrimSpace(c.PostForm("doc_name"))
	if docName == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "El nombre del documento es requerido"})
		return
	}

	file, header, err := c.Request.FormFile("doc_file")
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "El archivo es requerido"})
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowed := map[string]bool{".pdf": true, ".docx": true, ".txt": true}
	if !allowed[ext] {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Tipo de archivo no permitido (PDF, DOCX, TXT)"})
		return
	}

	dir := fmt.Sprintf("uploads/company_%d/pub/docs", companyID)
	if mkErr := os.MkdirAll(dir, 0755); mkErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al crear directorio"})
		return
	}

	unique := fmt.Sprintf("doc_%d%s", time.Now().UnixNano(), ext)
	dst := filepath.Join(dir, unique)
	out, oErr := os.Create(dst)
	if oErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al guardar archivo"})
		return
	}
	io.Copy(out, file)
	out.Close()

	mimeMap := map[string]string{
		".pdf":  "application/pdf",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".txt":  "text/plain",
	}

	doc := PubDocument{
		CompanyID:        companyID,
		Name:             docName,
		FilePath:         fmt.Sprintf("company_%d/pub/docs/%s", companyID, unique),
		MimeType:         mimeMap[ext],
		IsActive:         true,
		ProcessingStatus: "pending",
	}
	db.Create(&doc)

	c.JSON(http.StatusCreated, gin.H{"message": "Documento subido correctamente.", "data": doc})
}

func TogglePubDocument(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")
	id := c.Param("id")

	var doc PubDocument
	if err := db.Where("id = ? AND company_id = ?", id, companyID).First(&doc).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Documento no encontrado"})
		return
	}
	db.Model(&doc).Update("is_active", !doc.IsActive)
	c.JSON(http.StatusOK, gin.H{"data": doc})
}

func DeletePubDocument(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	companyID := c.GetUint("company_id")
	id := c.Param("id")

	var doc PubDocument
	if err := db.Where("id = ? AND company_id = ?", id, companyID).First(&doc).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Documento no encontrado"})
		return
	}
	// Eliminar el archivo físico
	if doc.FilePath != "" {
		os.Remove(filepath.Join("uploads", doc.FilePath))
	}
	db.Delete(&doc)
	c.JSON(http.StatusNoContent, nil)
}
