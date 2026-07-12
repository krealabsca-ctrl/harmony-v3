// Package handlers contiene los handlers HTTP de la API de Harmony v3.
//
// Este archivo implementa todos los endpoints relacionados con métricas y reportes:
//
//   - Dashboard: vista resumida del estado operativo en tiempo real, con dos modos:
//     "team" (admin/supervisor) y "agent" (agente individual).
//   - Monitor: lista paginada y filtrable de conversaciones activas para supervisión.
//   - Reports: reporte analítico completo con múltiples pestañas (resumen,
//     conversaciones, agentes, campañas, costos, por agente, por etiquetas).
//   - ExportReportCSV: exporta los datos de un reporte como CSV con BOM UTF-8
//     para compatibilidad con Microsoft Excel.
//
// Todos los handlers asumen que el middleware CompanyDB() ya inyectó la conexión
// GORM de la empresa en el contexto bajo la clave "db".
package handlers

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

// relativeTime convierte un time.Time a una cadena legible en formato relativo:
// "ahora", "5m", "3h" o "dd/mm" si es de días anteriores.
// Se usa para mostrar la última actividad en listas de conversaciones.
func relativeTime(t time.Time) string {
	mins := int(time.Since(t).Minutes())
	if mins < 1 {
		return "ahora"
	}
	if mins < 60 {
		return fmt.Sprintf("%dm", mins)
	}
	hrs := mins / 60
	if hrs < 24 {
		return fmt.Sprintf("%dh", hrs)
	}
	return t.Format("02/01")
}

// truncateStr recorta una cadena a n runas (no bytes) y agrega "…" si fue truncada.
// Trabaja con runas para no cortar caracteres multibyte (ej. emojis, acentos).
func truncateStr(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	runes := []rune(s)
	return string(runes[:n]) + "…"
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

// Dashboard es el handler principal del dashboard operativo.
//
// Métricas calculadas:
//   - Para team (admin/supervisor): KPIs globales del equipo (open/pending/closed),
//     tabla de agentes con sus estadísticas individuales en el período.
//   - Para agent: KPIs del agente autenticado, conversaciones recientes (hasta 15).
//
// Parámetros de query:
//   - date_from (string, "YYYY-MM-DD"): inicio del período; por defecto primer día del mes.
//   - date_to   (string, "YYYY-MM-DD"): fin del período; por defecto hoy.
//   - agent_id  (uint, solo en vista team): filtra por un agente específico.
//
// Respuesta (objeto JSON):
//   - view: "team" | "agent"
//   - Para team: total_open, total_pending, total_closed, total_closed_today,
//     agents ([]AgentRow), all_agents ([]AllAgentItem), date_from, date_to.
//   - Para agent: open_cases, pending_cases, closed_total, closed_today,
//     closed_week, conversations ([]ConvItem), date_from, date_to.
func Dashboard(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	userID := c.MustGet("user_id").(uint)
	role := c.GetString("role")

	now := time.Now()
	defaultFrom := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Format("2006-01-02")
	defaultTo := now.Format("2006-01-02")

	dateFrom := c.DefaultQuery("date_from", defaultFrom)
	dateTo := c.DefaultQuery("date_to", defaultTo)

	// Admin, supervisor y superadmin ven la vista de equipo; agentes ven la suya propia.
	isTeam := role == "admin" || role == "supervisor" || role == "superadmin"
	if isTeam {
		dashboardTeam(c, db, userID, role, dateFrom, dateTo)
	} else {
		dashboardAgent(c, db, userID, dateFrom, dateTo)
	}
}

// dashboardTeam genera la vista de equipo del dashboard.
//
// Si el usuario es supervisor, su scope se restringe automáticamente
// al departamento al que pertenece (campo department_id en users).
// El parámetro agent_id permite al admin/supervisor filtrar por un agente concreto.
func dashboardTeam(c *gin.Context, db *gorm.DB, userID uint, role string, dateFrom, dateTo string) {
	filterAgentID := c.Query("agent_id")
	filterDeptID := c.Query("dept_id")
	today := time.Now().Truncate(24 * time.Hour)

	// Scope de departamento: supervisor ve solo el suyo; admin puede filtrarlo con dept_id
	var deptScope *uint
	if role == "supervisor" {
		var me models.User
		if db.First(&me, userID).Error == nil {
			deptScope = me.DepartmentID
		}
	} else if filterDeptID != "" {
		// Admin con filtro explícito de departamento
		id, err := strconv.ParseUint(filterDeptID, 10, 64)
		if err == nil {
			uid := uint(id)
			deptScope = &uid
		}
	}

	base := func() *gorm.DB {
		q := db.Model(&models.Conversation{}).
			Where("created_at::date >= ?", dateFrom).
			Where("created_at::date <= ?", dateTo)
		if deptScope != nil {
			q = q.Where("department_id = ?", *deptScope)
		}
		if filterAgentID != "" {
			q = q.Where("agent_id = ?", filterAgentID)
		}
		return q
	}

	var totalOpen, totalClosed, totalClosedToday int64
	base().Where("status = ?", models.ConvOpen).Count(&totalOpen)
	base().Where("status = ?", models.ConvClosed).Count(&totalClosed)
	base().Where("status = ? AND updated_at >= ?", models.ConvClosed, today).Count(&totalClosedToday)

	// ── Agentes visibles ──────────────────────────────────────────────────
	agentQ := db.Model(&models.User{}).
		Where("role IN ? AND deleted_at IS NULL", []models.UserRole{models.RoleAgent, models.RoleSupervisor})
	if deptScope != nil {
		agentQ = agentQ.Where("department_id = ?", *deptScope)
	}
	if filterAgentID != "" {
		agentQ = agentQ.Where("id = ?", filterAgentID)
	}
	var agentList []models.User
	agentQ.Order("name").Find(&agentList)

	agentIDs := make([]uint, 0, len(agentList))
	for _, a := range agentList {
		agentIDs = append(agentIDs, a.ID)
	}

	type statRow struct {
		AgentID uint
		Status  string
		Cnt     int64
	}
	var statRows []statRow
	if len(agentIDs) > 0 {
		db.Model(&models.Conversation{}).
			Select("agent_id, status, COUNT(*) as cnt").
			Where("agent_id IN ?", agentIDs).
			Where("created_at::date >= ?", dateFrom).
			Where("created_at::date <= ?", dateTo).
			Group("agent_id, status").
			Scan(&statRows)
	}

	type statMap = map[string]int64
	agentStats := map[uint]statMap{}
	for _, r := range statRows {
		if agentStats[r.AgentID] == nil {
			agentStats[r.AgentID] = statMap{}
		}
		agentStats[r.AgentID][r.Status] += r.Cnt
	}

	type AgentRow struct {
		ID         uint   `json:"id"`
		Name       string `json:"name"`
		Role       string `json:"role"`
		IsOnline   bool   `json:"is_online"`
		StatOpen   int64  `json:"stat_open"`
		StatClosed int64  `json:"stat_closed"`
		StatTotal  int64  `json:"stat_total"`
	}
	agentRows := make([]AgentRow, 0, len(agentList))
	for _, a := range agentList {
		s := agentStats[a.ID]
		open := s["open"]
		closed := s["closed"]
		agentRows = append(agentRows, AgentRow{
			ID:         a.ID,
			Name:       a.Name,
			Role:       string(a.Role),
			IsOnline:   a.LastSeenAt != nil && time.Since(*a.LastSeenAt) < 2*time.Minute,
			StatOpen:   open,
			StatClosed: closed,
			StatTotal:  open + closed,
		})
	}

	// Lista de todos los agentes para el selector
	allAgentQ := db.Model(&models.User{}).
		Where("role IN ? AND deleted_at IS NULL", []models.UserRole{models.RoleAgent, models.RoleSupervisor}).
		Select("id, name, last_seen_at")
	if deptScope != nil {
		allAgentQ = allAgentQ.Where("department_id = ?", *deptScope)
	}
	type AllAgentItem struct {
		ID         uint       `json:"id"`
		Name       string     `json:"name"`
		LastSeenAt *time.Time `json:"-"`
		IsOnline   bool       `json:"is_online"`
	}
	var allAgentsRaw []AllAgentItem
	allAgentQ.Order("name").Scan(&allAgentsRaw)
	allAgents := make([]AllAgentItem, len(allAgentsRaw))
	for i, a := range allAgentsRaw {
		a.IsOnline = a.LastSeenAt != nil && time.Since(*a.LastSeenAt) < 2*time.Minute
		allAgents[i] = a
	}

	// Lista de departamentos para el filtro del admin
	type DeptItem struct {
		ID   uint   `json:"id"`
		Name string `json:"name"`
	}
	var allDepts []DeptItem
	if role == "admin" || role == "superadmin" {
		db.Table("departments").Select("id, name").Order("name").Scan(&allDepts)
	}

	c.JSON(http.StatusOK, gin.H{
		"view":               "team",
		"total_open":         totalOpen,
		"total_closed":       totalClosed,
		"total_closed_today": totalClosedToday,
		"agents":             agentRows,
		"all_agents":         allAgents,
		"all_departments":    allDepts,
		"date_from":          dateFrom,
		"date_to":            dateTo,
	})
}

// dashboardAgent genera la vista personal del agente autenticado.
//
// Calcula métricas del propio agente para el período seleccionado, más
// dos contadores fijos (cerradas hoy y esta semana) que son independientes
// del filtro de fecha para que siempre reflejen el ritmo de trabajo actual.
// Devuelve las últimas 15 conversaciones ordenadas por actividad reciente.
func dashboardAgent(c *gin.Context, db *gorm.DB, userID uint, dateFrom, dateTo string) {
	now := time.Now()
	today := now.Truncate(24 * time.Hour)
	// Calcular el inicio de la semana actual (lunes como primer día).
	weekStart := now.AddDate(0, 0, -int(now.Weekday()-1))
	if now.Weekday() == time.Sunday {
		// Si hoy es domingo, retroceder 6 días para llegar al lunes.
		weekStart = now.AddDate(0, 0, -6)
	}
	weekStart = weekStart.Truncate(24 * time.Hour)
	weekEnd := weekStart.AddDate(0, 0, 7)

	// Estadísticas del período seleccionado
	base := db.Model(&models.Conversation{}).
		Where("agent_id = ?", userID).
		Where("created_at::date >= ?", dateFrom).
		Where("created_at::date <= ?", dateTo)

	var openCases, pendingCases, closedTotal int64
	base.Where("status = ?", models.ConvOpen).Count(&openCases)
	base.Where("status = ?", models.ConvPending).Count(&pendingCases)
	base.Where("status = ?", models.ConvClosed).Count(&closedTotal)

	// Cerrados hoy y semana (independiente del filtro de período)
	// Se usa updated_at porque una conversación se "cierra" actualizando su estado.
	var closedToday, closedWeek int64
	db.Model(&models.Conversation{}).
		Where("agent_id = ? AND status = ? AND updated_at >= ?", userID, models.ConvClosed, today).
		Count(&closedToday)
	db.Model(&models.Conversation{}).
		Where("agent_id = ? AND status = ? AND updated_at >= ? AND updated_at < ?", userID, models.ConvClosed, weekStart, weekEnd).
		Count(&closedWeek)

	// Conversaciones del período: se precargan los contactos para mostrar el nombre.
	// NULLS LAST garantiza que conversaciones sin actividad van al final de la lista.
	var convs []models.Conversation
	base.Preload("Contact").
		Order("last_message_at DESC NULLS LAST").
		Limit(15).Find(&convs)

	type ConvItem struct {
		ID            uint   `json:"id"`
		ContactName   string `json:"contact_name"`
		CaseNumber    string `json:"case_number"`
		Status        string `json:"status"`
		LastMessageAt string `json:"last_message_at"`
	}
	items := make([]ConvItem, 0, len(convs))
	for _, cv := range convs {
		item := ConvItem{
			ID:         cv.ID,
			CaseNumber: cv.CaseNumber,
			Status:     string(cv.Status),
		}
		if cv.Contact != nil {
			item.ContactName = cv.Contact.Name
		}
		if cv.LastMessageAt != nil {
			// Se convierte a tiempo relativo legible ("5m", "2h", etc.)
			item.LastMessageAt = relativeTime(*cv.LastMessageAt)
		}
		items = append(items, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"view":          "agent",
		"open_cases":    openCases,
		"pending_cases": pendingCases,
		"closed_total":  closedTotal,
		"closed_today":  closedToday,
		"closed_week":   closedWeek,
		"conversations": items,
		"date_from":     dateFrom,
		"date_to":       dateTo,
	})
}

// MonitorConvItem es el DTO plano que devuelve el monitor.
// Aplana las relaciones Contact, Channel, Agent y Department en campos directos
// para evitar que el frontend tenga que navegar objetos anidados.
type MonitorConvItem struct {
	ID              uint         `json:"id"`
	CaseNumber      string       `json:"case_number"`
	Status          string       `json:"status"`
	LastMessageAt   *time.Time   `json:"last_message_at"`
	UnreadCount     int          `json:"unread_count"`
	WindowExpiresAt *time.Time   `json:"window_expires_at"`
	CreatedAt       time.Time    `json:"created_at"`
	ContactID       uint         `json:"contact_id"`
	ContactName     string       `json:"contact_name"`
	ContactPhone    string       `json:"contact_phone"`
	ContactAvatar   string       `json:"contact_avatar_url"`
	ChannelID       uint         `json:"channel_id"`
	ChannelName     string       `json:"channel_name"`
	ChannelType     string       `json:"channel_type"`
	AgentID         *uint        `json:"agent_id"`
	AgentName       string       `json:"agent_name"`
	DepartmentID    *uint        `json:"department_id"`
	DepartmentName  string       `json:"department_name"`
	Tags            []models.Tag `json:"tags"`
}

// Monitor devuelve la lista paginada de conversaciones activas (open + pending)
// para la vista de supervisión en tiempo real.
//
// Métricas calculadas:
//   - Conteos por estado (all, open, pending) sobre el scope actual (dept/agente),
//     independientes del filtro de status para mantener los badges de las pestañas.
//   - Lista paginada de conversaciones con todos sus datos denormalizados.
//
// Parámetros de query:
//   - q           (string):  búsqueda libre por número de caso, nombre o teléfono del contacto.
//   - agent_id    (string):  filtra por agente; "unassigned" muestra solo sin asignar.
//   - department_id (string): filtra por departamento. Para supervisores se fuerza al suyo.
//   - status      (string):  "" | "open" | "pending"; filtra la pestaña activa.
//   - page        (int):     número de página; 40 registros por página.
//
// Respuesta (objeto JSON):
//   - data    ([]MonitorConvItem): conversaciones de la página actual.
//   - total   (int64):            total de conversaciones con todos los filtros.
//   - meta    (objeto):           paginación { total, per_page, current_page, last_page }.
//   - counts  (objeto):           conteos de pestañas { all, open, pending }.
func Monitor(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	role, _ := c.Get("role")
	userID, _ := c.Get("user_id")

	// Parámetros de filtro
	q := c.Query("q")
	agentID := c.Query("agent_id")
	deptID := c.Query("department_id")
	statusFilter := c.Query("status") // "" | "open" | "pending"
	pageStr := c.DefaultQuery("page", "1")
	page, _ := strconv.Atoi(pageStr)
	if page < 1 {
		page = 1
	}
	const perPage = 40

	// Supervisor: forzar su propio departamento
	// Un supervisor no puede ver conversaciones de otros departamentos aunque
	// intente pasar un department_id diferente en la query.
	if role == "supervisor" {
		var me models.User
		if err := db.First(&me, userID.(uint)).Error; err == nil && me.DepartmentID != nil {
			deptID = strconv.FormatUint(uint64(*me.DepartmentID), 10)
		}
	}

	// Construcción de la query base
	// Solo se muestran conversaciones activas (open y pending); las cerradas
	// no aparecen en el monitor porque ya no requieren atención inmediata.
	base := db.Model(&models.Conversation{}).
		Where("conversations.status IN ?", []models.ConversationStatus{models.ConvOpen, models.ConvPending})

	if deptID != "" {
		base = base.Where("conversations.department_id = ?", deptID)
	}
	if agentID == "unassigned" {
		// Conversaciones que aún no tienen agente asignado (cola de entrada).
		base = base.Where("conversations.agent_id IS NULL")
	} else if agentID != "" {
		base = base.Where("conversations.agent_id = ?", agentID)
	}
	if statusFilter == "open" || statusFilter == "pending" {
		base = base.Where("conversations.status = ?", statusFilter)
	}
	if q != "" {
		// Búsqueda de texto libre: requiere JOIN con contacts para filtrar por nombre y teléfono.
		// Se usa ILIKE para búsqueda insensible a mayúsculas (PostgreSQL).
		like := "%" + q + "%"
		base = base.Joins("LEFT JOIN contacts ct ON ct.id = conversations.contact_id").
			Where("conversations.case_number ILIKE ? OR ct.name ILIKE ? OR ct.phone ILIKE ?", like, like, like)
	}

	// Conteos para las pestañas (siempre sobre el scope de dept/agente, sin filtro de status)
	// Se usa una query separada (baseCount) para que los badges de "open" y "pending"
	// no se vean afectados por el filtro de status de la pestaña activa.
	baseCount := db.Model(&models.Conversation{}).
		Where("conversations.status IN ?", []models.ConversationStatus{models.ConvOpen, models.ConvPending})
	if deptID != "" {
		baseCount = baseCount.Where("conversations.department_id = ?", deptID)
	}
	if agentID == "unassigned" {
		baseCount = baseCount.Where("conversations.agent_id IS NULL")
	} else if agentID != "" {
		baseCount = baseCount.Where("conversations.agent_id = ?", agentID)
	}

	var countAll, countOpen, countPending int64
	baseCount.Count(&countAll)
	baseCount.Where("conversations.status = ?", models.ConvOpen).Count(&countOpen)
	baseCount.Where("conversations.status = ?", models.ConvPending).Count(&countPending)

	// Total con todos los filtros aplicados (incluye filtro de status y búsqueda q)
	var total int64
	base.Count(&total)

	// Cargar conversaciones paginadas con todas sus relaciones precargadas.
	// NULLS LAST pone al final las conversaciones que nunca han recibido un mensaje.
	var convs []models.Conversation
	base.
		Preload("Contact").
		Preload("Agent").
		Preload("Channel").
		Preload("Tags").
		Order("conversations.last_message_at DESC NULLS LAST").
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&convs)

	// Mapa de nombres de departamentos
	// Se hace una sola query adicional para obtener los nombres de todos los
	// departamentos que aparecen en la página, evitando N+1 queries.
	deptIDs := make([]uint, 0, len(convs))
	for _, cv := range convs {
		if cv.DepartmentID != nil {
			deptIDs = append(deptIDs, *cv.DepartmentID)
		}
	}
	deptMap := map[uint]string{}
	if len(deptIDs) > 0 {
		var depts []struct {
			ID   uint
			Name string
		}
		db.Table("departments").Select("id, name").Where("id IN ?", deptIDs).Scan(&depts)
		for _, d := range depts {
			deptMap[d.ID] = d.Name
		}
	}

	// Armar DTOs aplanando las relaciones en MonitorConvItem
	items := make([]MonitorConvItem, 0, len(convs))
	for _, cv := range convs {
		deptName := ""
		if cv.DepartmentID != nil {
			deptName = deptMap[*cv.DepartmentID]
		}
		item := MonitorConvItem{
			ID:              cv.ID,
			CaseNumber:      cv.CaseNumber,
			Status:          string(cv.Status),
			LastMessageAt:   cv.LastMessageAt,
			UnreadCount:     cv.UnreadCount,
			WindowExpiresAt: cv.WindowExpiresAt,
			CreatedAt:       cv.CreatedAt,
			DepartmentID:    cv.DepartmentID,
			DepartmentName:  deptName,
			Tags:             cv.Tags,
		}
		if cv.Contact != nil {
			item.ContactID = cv.Contact.ID
			item.ContactName = cv.Contact.Name
			item.ContactPhone = cv.Contact.Phone
			item.ContactAvatar = cv.Contact.AvatarURL
		}
		if cv.Channel != nil {
			item.ChannelID = cv.Channel.ID
			item.ChannelName = cv.Channel.Name
			item.ChannelType = string(cv.Channel.Type)
		}
		if cv.Agent != nil {
			item.AgentID = &cv.Agent.ID
			item.AgentName = cv.Agent.Name
		}
		items = append(items, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  items,
		"total": total,
		"meta": gin.H{
			"total":        total,
			"per_page":     perPage,
			"current_page": page,
			// Cálculo de última página: ceil(total / perPage) sin usar float.
			"last_page": (total + perPage - 1) / perPage,
		},
		"counts": gin.H{
			"all":     countAll,
			"open":    countOpen,
			"pending": countPending,
		},
	})
}

// ─── Reports ──────────────────────────────────────────────────────────────────

// Reports genera el reporte analítico completo de la empresa para el período indicado.
//
// El reporte está estructurado en múltiples "pestañas" conceptuales que el frontend
// puede mostrar como tabs. Todas se calculan en una sola llamada HTTP para reducir
// la cantidad de round-trips.
//
// Métricas calculadas:
//
//   - Tab Resumen: totales de conversaciones por estado, mensajes (inbound/outbound),
//     costo de campañas y distribución por canal.
//
//   - Tab Conversaciones: serie temporal diaria, desglose por agente y por departamento.
//
//   - Tab Agentes: rendimiento individual con porcentaje de resolución
//     (closed / total * 100).
//
//   - Tab Campañas: estadísticas agregadas de campañas, detalle por campaña
//     (destinatarios, enviados, fallidos, % entrega, costo) y distribución por usuario.
//
//   - Tab Costos: costo total, costo promedio por campaña, canales con costo,
//     serie mensual, desglose por canal y por agente que envió la campaña.
//
//   - Tab Por Agente (paginada): misma información del tab Agentes pero paginada
//     (20 por página) para empresas con muchos agentes.
//
//   - Tab Por Tags: etiquetas activas en el período con conteos por estado y
//     porcentaje de resolución.
//
// Parámetros de query:
//   - from (string, "YYYY-MM-DD"): inicio del período; por defecto hace 1 mes.
//   - to   (string, "YYYY-MM-DD"): fin del período; por defecto hoy.
//   - page (int): página para la sección "por agente"; por defecto 1.
//
// Respuesta: objeto JSON con todas las claves de cada pestaña (ver comentarios inline).
func Reports(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	from := c.DefaultQuery("from", time.Now().AddDate(0, -1, 0).Format("2006-01-02"))
	to := c.DefaultQuery("to", time.Now().Format("2006-01-02"))

	// Filtro de departamento: supervisor siempre ve su depto; admin puede filtrar con dept_id
	role, _ := c.Get("role")
	userID, _ := c.Get("user_id")
	var deptFilter *uint
	if role == string(models.RoleSupervisor) {
		var u models.User
		if err := db.Select("department_id").First(&u, userID).Error; err == nil && u.DepartmentID != nil {
			deptFilter = u.DepartmentID
		}
	} else if deptIDStr := c.Query("dept_id"); deptIDStr != "" {
		if id, err := strconv.ParseUint(deptIDStr, 10, 64); err == nil {
			uid := uint(id)
			deptFilter = &uid
		}
	}

	// deptScope aplica el filtro de departamento a una query GORM sobre conversations
	deptScope := func(d *gorm.DB) *gorm.DB {
		if deptFilter != nil {
			return d.Where("conversations.department_id = ?", *deptFilter)
		}
		return d
	}

	// deptSQL / deptSQLArgs: fragmento SQL y argumento para raw queries
	deptSQL := ""
	var deptSQLArgs []interface{}
	if deptFilter != nil {
		deptSQL = " AND conversations.department_id = ?"
		deptSQLArgs = []interface{}{*deptFilter}
	}

	// Lista de departamentos disponibles (solo para admin)
	type AllDeptItem struct {
		ID   uint   `json:"id"`
		Name string `json:"name"`
	}
	allDepts := make([]AllDeptItem, 0)
	if role == string(models.RoleAdmin) {
		db.Table("departments").Select("id, name").Order("name").Scan(&allDepts)
	}

	// ── Tab Resumen ───────────────────────────────────────────────────────────
	var totalConvs, openConvs, closedConvs int64
	db.Model(&models.Conversation{}).Scopes(deptScope).
		Where("created_at::date >= ? AND created_at::date <= ?", from, to).
		Count(&totalConvs)
	db.Model(&models.Conversation{}).Scopes(deptScope).
		Where("created_at::date >= ? AND created_at::date <= ? AND status = ?", from, to, models.ConvOpen).
		Count(&openConvs)
	db.Model(&models.Conversation{}).Scopes(deptScope).
		Where("created_at::date >= ? AND created_at::date <= ? AND status = ?", from, to, models.ConvClosed).
		Count(&closedConvs)

	// Conteos de mensajes: JOIN con conversations para filtrar por la fecha del mensaje.
	// Se separa inbound (recibidos del cliente) de outbound (enviados por el agente/bot).
	var totalMsgs, inboundMsgs, outboundMsgs int64
	db.Model(&models.Message{}).
		Joins("JOIN conversations ON conversations.id = messages.conversation_id").
		Scopes(deptScope).
		Where("messages.created_at::date >= ? AND messages.created_at::date <= ?", from, to).
		Count(&totalMsgs)
	db.Model(&models.Message{}).
		Joins("JOIN conversations ON conversations.id = messages.conversation_id").
		Scopes(deptScope).
		Where("messages.created_at::date >= ? AND messages.created_at::date <= ? AND messages.direction = ?", from, to, "inbound").
		Count(&inboundMsgs)
	db.Model(&models.Message{}).
		Joins("JOIN conversations ON conversations.id = messages.conversation_id").
		Scopes(deptScope).
		Where("messages.created_at::date >= ? AND messages.created_at::date <= ? AND messages.direction = ?", from, to, "outbound").
		Count(&outboundMsgs)

	// Costo de campañas en el período
	// COALESCE evita que SUM devuelva NULL cuando no hay campañas en el período.
	type costResult struct {
		Total float64
	}
	var campaignCost costResult
	db.Raw(`SELECT COALESCE(SUM(total_cost), 0) AS total
		FROM campaigns
		WHERE created_at::date >= ? AND created_at::date <= ?`, from, to).
		Scan(&campaignCost)

	// Active campaigns (non-closed/failed)
	var activeCampaigns int64
	db.Table("campaigns").
		Where("created_at::date >= ? AND created_at::date <= ? AND status NOT IN ('completed','failed','cancelled')", from, to).
		Count(&activeCampaigns)

	// Conversaciones por canal: útil para ver qué plataforma genera más volumen.
	type ByChannelRow struct {
		ChannelName string `json:"channel_name"`
		Type        string `json:"type"`
		Total       int64  `json:"total"`
	}
	byChannel := make([]ByChannelRow, 0)
	db.Raw(`SELECT ch.name AS channel_name, ch.type, COUNT(c.id) AS total
		FROM conversations c
		JOIN channels ch ON ch.id = c.channel_id
		WHERE c.created_at::date >= ? AND c.created_at::date <= ?`+deptSQL+`
		GROUP BY ch.name, ch.type
		ORDER BY total DESC`, append([]interface{}{from, to}, deptSQLArgs...)...).
		Scan(&byChannel)

	// ── Tab Conversaciones ────────────────────────────────────────────────────

	// Serie temporal diaria: permite graficar la evolución del volumen de casos.
	// created_at::date trunca el timestamp a solo fecha (PostgreSQL).
	type ConvsByDayRow struct {
		Day   string `json:"day"`
		Total int64  `json:"total"`
	}
	convsByDay := make([]ConvsByDayRow, 0)
	db.Raw(`SELECT created_at::date AS day, COUNT(*) AS total
		FROM conversations
		WHERE created_at::date >= ? AND created_at::date <= ?`+deptSQL+`
		GROUP BY created_at::date
		ORDER BY day`, append([]interface{}{from, to}, deptSQLArgs...)...).
		Scan(&convsByDay)

	// Desglose por agente: LEFT JOIN para incluir conversaciones sin agente asignado.
	// COALESCE(u.name, 'Sin asignar') agrupa todas las conversaciones no asignadas bajo esa etiqueta.
	// COUNT(*) FILTER (WHERE ...) es sintaxis nativa de PostgreSQL para conditional aggregation.
	type ConvsByAgentRow struct {
		AgentName string `json:"agent_name"`
		Total     int64  `json:"total"`
		Open      int64  `json:"open"`
		Pending   int64  `json:"pending"`
		Closed    int64  `json:"closed"`
	}
	convsByAgent := make([]ConvsByAgentRow, 0)
	db.Raw(`SELECT
			COALESCE(u.name, 'Sin asignar') AS agent_name,
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE c.status = 'open') AS open,
			COUNT(*) FILTER (WHERE c.status = 'pending') AS pending,
			COUNT(*) FILTER (WHERE c.status = 'closed') AS closed
		FROM conversations c
		LEFT JOIN users u ON u.id = c.agent_id
		WHERE c.created_at::date >= ? AND c.created_at::date <= ?
		GROUP BY u.name
		ORDER BY total DESC`, from, to).
		Scan(&convsByAgent)

	// Desglose por departamento: mismo patrón que por agente.
	// COALESCE(d.name, 'Sin departamento') captura conversaciones sin departamento asignado.
	type ConvsByDeptRow struct {
		DeptName string `json:"dept_name"`
		Total    int64  `json:"total"`
		Open     int64  `json:"open"`
		Pending  int64  `json:"pending"`
		Closed   int64  `json:"closed"`
	}
	convsByDept := make([]ConvsByDeptRow, 0)
	db.Raw(`SELECT
			COALESCE(d.name, 'Sin departamento') AS dept_name,
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE c.status = 'open') AS open,
			COUNT(*) FILTER (WHERE c.status = 'pending') AS pending,
			COUNT(*) FILTER (WHERE c.status = 'closed') AS closed
		FROM conversations c
		LEFT JOIN departments d ON d.id = c.department_id
		WHERE c.created_at::date >= ? AND c.created_at::date <= ?
		GROUP BY d.name
		ORDER BY total DESC`, from, to).
		Scan(&convsByDept)

	// ── Tab Agentes ───────────────────────────────────────────────────────────

	// Rendimiento por agente con porcentaje de resolución.
	// INNER JOIN (no LEFT) porque aquí solo interesan conversaciones asignadas.
	// resolution_pct = cerradas / total * 100, redondeado a 1 decimal.
	// CASE WHEN COUNT(*) > 0 evita división por cero.
	type AgentPerfRow struct {
		ID            uint    `json:"id"`
		Name          string  `json:"name"`
		IsBot         bool    `json:"is_bot"`
		Total         int64   `json:"total"`
		OpenCount     int64   `json:"open_count"`
		PendingCount  int64   `json:"pending_count"`
		ClosedCount   int64   `json:"closed_count"`
		ResolutionPct float64 `json:"resolution_pct"`
	}
	agentPerformance := make([]AgentPerfRow, 0)
	db.Raw(`SELECT
			u.id,
			u.name,
			u.is_bot,
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE c.status = 'open') AS open_count,
			COUNT(*) FILTER (WHERE c.status = 'pending') AS pending_count,
			COUNT(*) FILTER (WHERE c.status = 'closed') AS closed_count,
			CASE WHEN COUNT(*) > 0
				THEN ROUND(COUNT(*) FILTER (WHERE c.status = 'closed') * 100.0 / COUNT(*), 1)
				ELSE 0
			END AS resolution_pct
		FROM conversations c
		JOIN users u ON u.id = c.agent_id
		WHERE c.created_at::date >= ? AND c.created_at::date <= ?
		GROUP BY u.id, u.name, u.is_bot
		ORDER BY total DESC`, from, to).
		Scan(&agentPerformance)

	// ── Tab Campañas ──────────────────────────────────────────────────────────

	// Estadísticas globales de todas las campañas en el período.
	// avg_delivery_pct = total enviados / total destinatarios * 100.
	// SUM(total_recipients) > 0 evita división por cero cuando todas las campañas
	// están en estado draft y aún no tienen destinatarios confirmados.
	type CampaignStatsRow struct {
		Total            int64   `json:"total"`
		TotalRecipients  int64   `json:"total_recipients"`
		TotalSent        int64   `json:"total_sent"`
		AvgDeliveryPct   float64 `json:"avg_delivery_pct"`
	}
	var campaignStats CampaignStatsRow
	db.Raw(`SELECT
			COUNT(*) AS total,
			COALESCE(SUM(total_recipients), 0) AS total_recipients,
			COALESCE(SUM(sent_count), 0) AS total_sent,
			CASE WHEN SUM(total_recipients) > 0
				THEN ROUND(SUM(sent_count) * 100.0 / SUM(total_recipients), 1)
				ELSE 0
			END AS avg_delivery_pct
		FROM campaigns
		WHERE created_at::date >= ? AND created_at::date <= ?`, from, to).
		Scan(&campaignStats)

	// Detalle por campaña: incluye quién la creó, el canal usado, métricas de envío y costos.
	// delivery_pct se calcula por campaña individual (puede diferir del promedio global).
	type CampaignRow struct {
		ID              uint       `json:"id"`
		Name            string     `json:"name"`
		CreatorName     string     `json:"creator_name"`
		ChannelName     string     `json:"channel_name"`
		Status          string     `json:"status"`
		TotalRecipients int64      `json:"total_recipients"`
		SentCount       int64      `json:"sent_count"`
		FailedCount     int64      `json:"failed_count"`
		CostPerMessage  float64    `json:"cost_per_message"`
		CreatedAt       time.Time  `json:"created_at"`
	}
	campaigns := make([]CampaignRow, 0)
	db.Raw(`SELECT
			camp.id,
			camp.name,
			COALESCE(u.name, '') AS creator_name,
			COALESCE(ch.name, '') AS channel_name,
			camp.status,
			camp.total_recipients,
			camp.sent_count,
			camp.failed_count,
			COALESCE(camp.cost_per_message, 0) AS cost_per_message,
			camp.created_at
		FROM campaigns camp
		LEFT JOIN users u ON u.id = camp.created_by
		LEFT JOIN channels ch ON ch.id = camp.channel_id
		WHERE camp.created_at::date >= ? AND camp.created_at::date <= ?
		ORDER BY camp.created_at DESC`, from, to).
		Scan(&campaigns)

	// Distribución de campañas por usuario: quién envía más campañas en el equipo.
	type CampaignsByUserRow struct {
		CreatorName   string  `json:"creator_name"`
		TotalCampaigns int64  `json:"total_campaigns"`
		TotalCost     float64 `json:"total_cost"`
	}
	campaignsByUser := make([]CampaignsByUserRow, 0)
	db.Raw(`SELECT
			COALESCE(u.name, 'Desconocido') AS creator_name,
			COUNT(*) AS total_campaigns,
			COALESCE(SUM(camp.total_cost), 0) AS total_cost
		FROM campaigns camp
		LEFT JOIN users u ON u.id = camp.created_by
		WHERE camp.created_at::date >= ? AND camp.created_at::date <= ?
		GROUP BY u.name
		ORDER BY total_campaigns DESC`, from, to).
		Scan(&campaignsByUser)

	// ── Tab Costos ────────────────────────────────────────────────────────────

	// Costo total de todas las campañas del período.
	var totalCost float64
	db.Raw(`SELECT COALESCE(SUM(total_cost), 0) FROM campaigns
		WHERE created_at::date >= ? AND created_at::date <= ?`, from, to).
		Scan(&totalCost)

	// Costo promedio por campaña: se calcula en Go para evitar división por cero en SQL.
	var avgCostPerCampaign float64
	if campaignStats.Total > 0 {
		avgCostPerCampaign = totalCost / float64(campaignStats.Total)
	}

	// Cantidad de canales distintos que generaron algún costo (total_cost > 0).
	// COUNT(DISTINCT channel_id) evita contar el mismo canal varias veces.
	type ChannelsWithCostResult struct {
		Count int64
	}
	var channelsWithCost ChannelsWithCostResult
	db.Raw(`SELECT COUNT(DISTINCT channel_id) AS count
		FROM campaigns
		WHERE created_at::date >= ? AND created_at::date <= ? AND total_cost > 0`, from, to).
		Scan(&channelsWithCost)

	// Serie mensual de costos: permite graficar la tendencia de gasto mes a mes.
	// TO_CHAR(created_at, 'YYYY-MM') agrupa por año-mes en formato texto ordenable.
	type CostByMonthRow struct {
		Month          string  `json:"month"`
		TotalCampaigns int64   `json:"total_campaigns"`
		TotalCost      float64 `json:"total_cost"`
	}
	costByMonth := make([]CostByMonthRow, 0)
	db.Raw(`SELECT
			TO_CHAR(created_at, 'YYYY-MM') AS month,
			COUNT(*) AS total_campaigns,
			COALESCE(SUM(total_cost), 0) AS total_cost
		FROM campaigns
		WHERE created_at::date >= ? AND created_at::date <= ?
		GROUP BY TO_CHAR(created_at, 'YYYY-MM')
		ORDER BY month`, from, to).
		Scan(&costByMonth)

	// Costo por canal: útil para comparar el precio de WhatsApp vs otros canales.
	// messages = total mensajes enviados por ese canal (sent_count acumulado).
	type CostByChannelRow struct {
		ChannelName string  `json:"channel_name"`
		Type        string  `json:"type"`
		TotalCost   float64 `json:"total_cost"`
	}
	costByChannel := make([]CostByChannelRow, 0)
	db.Raw(`SELECT
			COALESCE(ch.name, 'Desconocido') AS channel_name,
			COALESCE(ch.type, '') AS type,
			COALESCE(SUM(camp.total_cost), 0) AS total_cost
		FROM campaigns camp
		LEFT JOIN channels ch ON ch.id = camp.channel_id
		WHERE camp.created_at::date >= ? AND camp.created_at::date <= ?
		GROUP BY ch.name, ch.type
		ORDER BY total_cost DESC`, from, to).
		Scan(&costByChannel)

	// Costo individual por usuario: cuánto ha gastado cada persona que envía campañas.
	// templates_sent = suma de mensajes enviados en todas sus campañas del período.
	type IndividualCostRow struct {
		AgentName string  `json:"agent_name"`
		TotalMsgs int64   `json:"total_msgs"`
		TotalCost float64 `json:"total_cost"`
	}
	individualCosts := make([]IndividualCostRow, 0)
	db.Raw(`SELECT
			COALESCE(u.name, 'Desconocido') AS agent_name,
			COALESCE(SUM(camp.sent_count), 0) AS total_msgs,
			COALESCE(SUM(camp.total_cost), 0) AS total_cost
		FROM campaigns camp
		LEFT JOIN users u ON u.id = camp.created_by
		WHERE camp.created_at::date >= ? AND camp.created_at::date <= ?
		GROUP BY u.name
		ORDER BY total_cost DESC`, from, to).
		Scan(&individualCosts)

	var individTotalCost float64
	var individTotalCount int64
	for _, ic := range individualCosts {
		individTotalCost += ic.TotalCost
		individTotalCount += ic.TotalMsgs
	}

	// ── Tab Por Agente (paginado — conversaciones individuales) ──────────────
	pageStr := c.DefaultQuery("page", "1")
	page, _ := strconv.Atoi(pageStr)
	if page < 1 {
		page = 1
	}
	const perPage = 20

	filterAgentID := c.Query("agent_id")
	filterStatus  := c.Query("status")
	filterSearch  := c.Query("search")

	// Lista de agentes disponibles para el selector del filtro (incluye bot IA)
	type AgentListItem struct {
		ID    uint   `json:"id"`
		Name  string `json:"name"`
		IsBot bool   `json:"is_bot"`
	}
	agentList := make([]AgentListItem, 0)
	db.Raw(`SELECT id, name, is_bot FROM users WHERE deleted_at IS NULL ORDER BY is_bot ASC, name ASC`).Scan(&agentList)

	// Construir query de conversaciones con filtros opcionales
	convQ := `SELECT
			c.id,
			COALESCE(ct.name, '') AS contact_name,
			COALESCE(ct.phone, '') AS contact_phone,
			COALESCE(ch.name, '') AS channel_name,
			COALESCE(u.name, '') AS agent_name,
			c.status,
			c.created_at
		FROM conversations c
		LEFT JOIN contacts ct ON ct.id = c.contact_id
		LEFT JOIN channels ch ON ch.id = c.channel_id
		LEFT JOIN users u ON u.id = c.agent_id
		WHERE c.created_at::date >= @from AND c.created_at::date <= @to`
	convArgs := map[string]any{"from": from, "to": to}
	if filterAgentID != "" {
		convQ += ` AND c.agent_id = @agent_id`
		convArgs["agent_id"] = filterAgentID
	}
	if filterStatus != "" {
		convQ += ` AND c.status = @status`
		convArgs["status"] = filterStatus
	}
	if filterSearch != "" {
		convQ += ` AND (ct.name ILIKE @search OR ct.phone ILIKE @search)`
		convArgs["search"] = "%" + filterSearch + "%"
	}

	type PorAgentConvRow struct {
		ID          uint      `json:"id"`
		ContactName string    `json:"contact_name"`
		ContactPhone string   `json:"contact_phone"`
		ChannelName string    `json:"channel_name"`
		AgentName   string    `json:"agent_name"`
		Status      string    `json:"status"`
		CreatedAt   time.Time `json:"created_at"`
	}

	var porAgenteTotal int64
	db.Raw(`SELECT COUNT(*) FROM (`+convQ+`) sub`, convArgs).Scan(&porAgenteTotal)

	porAgenteData := make([]PorAgentConvRow, 0)
	db.Raw(convQ+` ORDER BY c.created_at DESC LIMIT @limit OFFSET @offset`, map[string]any{
		"from": from, "to": to,
		"agent_id": filterAgentID, "status": filterStatus,
		"search":  "%" + filterSearch + "%",
		"limit":   perPage,
		"offset":  (page - 1) * perPage,
	}).Scan(&porAgenteData)

	lastPagePorAgente := int(porAgenteTotal)/perPage + 1
	if int(porAgenteTotal)%perPage == 0 && porAgenteTotal > 0 {
		lastPagePorAgente = int(porAgenteTotal) / perPage
	}

	// Stats globales del período para los KPIs del tab
	type PorAgenteStats struct {
		Total   int64 `json:"total"`
		Open    int64 `json:"open"`
		Pending int64 `json:"pending"`
		Closed  int64 `json:"closed"`
	}
	var porAgenteStats PorAgenteStats
	db.Raw(`SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE status='open') AS open,
			COUNT(*) FILTER (WHERE status='pending') AS pending,
			COUNT(*) FILTER (WHERE status='closed') AS closed
		FROM conversations
		WHERE created_at::date >= ? AND created_at::date <= ?`, from, to).
		Scan(&porAgenteStats)

	// ── Tab Por Tags ──────────────────────────────────────────────────────────

	// Cantidad de etiquetas distintas usadas en el período.
	// Se une conversation_tags con conversations para respetar el filtro de fechas.
	var activeTags int64
	db.Raw(`SELECT COUNT(DISTINCT ct.tag_id)
		FROM conversation_tags ct
		JOIN conversations c ON c.id = ct.conversation_id
		WHERE c.created_at::date >= ? AND c.created_at::date <= ?`, from, to).
		Scan(&activeTags)

	// Estadísticas por etiqueta: mismo patrón de conditional aggregation que agentes.
	// resolution_pct indica qué porcentaje de conversaciones con esa etiqueta se cerraron.
	type TagStatRow struct {
		ID           uint    `json:"id"`
		TagName      string  `json:"tag_name"`
		Color        string  `json:"color"`
		Total        int64   `json:"total"`
		OpenCount    int64   `json:"open_count"`
		PendingCount int64   `json:"pending_count"`
		ClosedCount  int64   `json:"closed_count"`
	}
	tagStats := make([]TagStatRow, 0)
	db.Raw(`SELECT
			t.id,
			t.name AS tag_name,
			t.color,
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE c.status = 'open') AS open_count,
			COUNT(*) FILTER (WHERE c.status = 'pending') AS pending_count,
			COUNT(*) FILTER (WHERE c.status = 'closed') AS closed_count
		FROM conversation_tags ct
		JOIN tags t ON t.id = ct.tag_id
		JOIN conversations c ON c.id = ct.conversation_id
		WHERE c.created_at::date >= ? AND c.created_at::date <= ?
		GROUP BY t.id, t.name, t.color
		ORDER BY total DESC`, from, to).
		Scan(&tagStats)

	// ── Respuesta final ───────────────────────────────────────────────────────

	c.JSON(http.StatusOK, gin.H{
		"from": from,
		"to":   to,

		// Tab Resumen
		"total_convs":         totalConvs,
		"open_convs":          openConvs,
		"closed_convs":        closedConvs,
		"all_departments":     allDepts,
		"total_messages":      totalMsgs,
		"inbound_messages":    inboundMsgs,
		"outbound_messages":   outboundMsgs,
		"total_campaign_cost": campaignCost.Total,
		"active_campaigns":    activeCampaigns,
		"convs_by_channel":    byChannel,

		// Tab Conversaciones
		"convs_by_day":   convsByDay,
		"convs_by_agent": convsByAgent,
		"convs_by_dept":  convsByDept,

		// Tab Agentes
		"agent_stats": agentPerformance,

		// Tab Campañas
		"campaign_stats":    campaignStats,
		"campaigns":         campaigns,
		"campaigns_by_user": campaignsByUser,

		// Tab Costos
		"total_spent":           totalCost,
		"avg_cost_per_campaign": avgCostPerCampaign,
		"channels_with_cost":    channelsWithCost.Count,
		"cost_by_month":         costByMonth,
		"cost_by_channel":       costByChannel,
		"indiv_total_cost":      individTotalCost,
		"indiv_total_count":     individTotalCount,
		"indiv_cost_by_agent":   individualCosts,

		// Tab Por Agente (conversaciones individuales paginadas)
		"agent_list": agentList,
		"convs": gin.H{
			"data":         porAgenteData,
			"total":        porAgenteTotal,
			"current_page": page,
			"last_page":    lastPagePorAgente,
		},
		"stats": porAgenteStats,

		// Tab Por Tags
		"active_tags": activeTags,
		"tag_stats":   tagStats,
	})
}

// ExportReportCSV genera y descarga un archivo CSV con los datos del reporte solicitado.
// El archivo incluye BOM UTF-8 al inicio para que Microsoft Excel lo abra correctamente
// sin problemas de codificación con tildes y caracteres especiales del español.
//
// Métricas exportadas (según el parámetro type):
//   - "conversations": datos completos de cada conversación (caso, contacto, canal, agente, etc.).
//   - "agents":        rendimiento por agente (totales por estado y % resolución).
//   - "campaigns":     detalle de cada campaña (destinatarios, envíos, % entrega, fecha completada).
//
// Parámetros de query:
//   - type (string): "conversations" | "agents" | "campaigns"; por defecto "conversations".
//   - from (string, "YYYY-MM-DD"): inicio del período; por defecto hace 1 mes.
//   - to   (string, "YYYY-MM-DD"): fin del período; por defecto hoy.
//
// Respuesta:
//   - Content-Type: text/csv; charset=utf-8
//   - Content-Disposition: attachment; filename="reporte_<type>_<from>_<to>.csv"
//   - Body: CSV con encabezados en español y filas de datos.
// csvSafe neutraliza la inyección de fórmulas en CSV (A-11): si un valor empieza por
// =, +, -, @, tab o CR, se le antepone un apóstrofo para que Excel/Sheets no lo
// ejecute como fórmula al abrir el archivo (ej. nombres de contacto controlados por el atacante).
func csvSafe(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}

func ExportReportCSV(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	reportType := c.DefaultQuery("type", "conversations")
	from := c.DefaultQuery("from", time.Now().AddDate(0, -1, 0).Format("2006-01-02"))
	to := c.DefaultQuery("to", time.Now().Format("2006-01-02"))

	var buf bytes.Buffer
	// BOM UTF-8 (0xEF 0xBB 0xBF) para compatibilidad con Excel:
	// sin este prefijo, Excel interpreta el CSV como Latin-1 y las tildes se corrompen.
	buf.Write([]byte{0xEF, 0xBB, 0xBF})
	w := csv.NewWriter(&buf)

	switch reportType {

	case "conversations":
		// Encabezados en español para que el CSV sea legible sin necesidad de traducción.
		w.Write([]string{"Caso", "Contacto", "Teléfono", "Canal", "Agente", "Departamento", "Estado", "Creada", "Última actividad"})
		rows := []struct {
			CaseNumber    string     `gorm:"column:case_number"`
			ContactName   string     `gorm:"column:contact_name"`
			ContactPhone  string     `gorm:"column:contact_phone"`
			ChannelName   string     `gorm:"column:channel_name"`
			AgentName     string     `gorm:"column:agent_name"`
			DeptName      string     `gorm:"column:dept_name"`
			Status        string     `gorm:"column:status"`
			CreatedAt     time.Time  `gorm:"column:created_at"`
			LastMessageAt *time.Time `gorm:"column:last_message_at"`
		}{}
		// LEFT JOINs para incluir conversaciones sin contacto, canal, agente o departamento asignado.
		// COALESCE reemplaza NULL por texto legible en el CSV.
		db.Raw(`SELECT
			c.case_number, COALESCE(ct.name,'') AS contact_name, COALESCE(ct.phone,'') AS contact_phone,
			COALESCE(ch.name,'') AS channel_name, COALESCE(u.name,'Sin asignar') AS agent_name,
			COALESCE(d.name,'Sin departamento') AS dept_name, c.status, c.created_at, c.last_message_at
			FROM conversations c
			LEFT JOIN contacts ct ON ct.id = c.contact_id
			LEFT JOIN channels ch ON ch.id = c.channel_id
			LEFT JOIN users u ON u.id = c.agent_id
			LEFT JOIN departments d ON d.id = c.department_id
			WHERE c.created_at::date >= ? AND c.created_at::date <= ?
			ORDER BY c.created_at DESC`, from, to).Scan(&rows)
		for _, r := range rows {
			last := ""
			if r.LastMessageAt != nil {
				// Formato dd/mm/aaaa HH:MM legible para usuarios en Costa Rica.
				last = r.LastMessageAt.Format("02/01/2006 15:04")
			}
			w.Write([]string{
				csvSafe(r.CaseNumber), csvSafe(r.ContactName), csvSafe(r.ContactPhone), csvSafe(r.ChannelName),
				csvSafe(r.AgentName), csvSafe(r.DeptName), csvSafe(r.Status),
				r.CreatedAt.Format("02/01/2006 15:04"), last,
			})
		}

	case "agents":
		w.Write([]string{"Agente", "Total", "Abiertas", "Pendientes", "Cerradas", "% Resolución"})
		rows := []struct {
			AgentName     string  `gorm:"column:agent_name"`
			Total         int64   `gorm:"column:total"`
			Open          int64   `gorm:"column:open"`
			Pending       int64   `gorm:"column:pending"`
			Closed        int64   `gorm:"column:closed"`
			ResolutionPct float64 `gorm:"column:resolution_pct"`
		}{}
		// INNER JOIN porque solo se exportan agentes que tienen conversaciones en el período.
		db.Raw(`SELECT u.name AS agent_name,
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE c.status='open') AS open,
			COUNT(*) FILTER (WHERE c.status='pending') AS pending,
			COUNT(*) FILTER (WHERE c.status='closed') AS closed,
			CASE WHEN COUNT(*)>0 THEN ROUND(COUNT(*) FILTER (WHERE c.status='closed')*100.0/COUNT(*),1) ELSE 0 END AS resolution_pct
			FROM conversations c JOIN users u ON u.id=c.agent_id
			WHERE c.created_at::date >= ? AND c.created_at::date <= ?
			GROUP BY u.name ORDER BY total DESC`, from, to).Scan(&rows)
		for _, r := range rows {
			w.Write([]string{
				csvSafe(r.AgentName),
				strconv.FormatInt(r.Total, 10), strconv.FormatInt(r.Open, 10),
				strconv.FormatInt(r.Pending, 10), strconv.FormatInt(r.Closed, 10),
				// Formato "85.3%" con el símbolo para que Excel no interprete como número.
				fmt.Sprintf("%.1f%%", r.ResolutionPct),
			})
		}

	case "campaigns":
		w.Write([]string{"Nombre", "Canal", "Creada por", "Estado", "Destinatarios", "Enviados", "Fallidos", "% Entrega", "Completada"})
		rows := []struct {
			Name            string     `gorm:"column:name"`
			Channel         string     `gorm:"column:channel"`
			SentBy          string     `gorm:"column:sent_by"`
			Status          string     `gorm:"column:status"`
			TotalRecipients int64      `gorm:"column:total_recipients"`
			SentCount       int64      `gorm:"column:sent_count"`
			FailedCount     int64      `gorm:"column:failed_count"`
			CompletedAt     *time.Time `gorm:"column:completed_at"`
		}{}
		db.Raw(`SELECT camp.name, COALESCE(ch.name,'') AS channel,
			COALESCE(u.name,'') AS sent_by, camp.status,
			camp.total_recipients, camp.sent_count, camp.failed_count, camp.completed_at
			FROM campaigns camp
			LEFT JOIN users u ON u.id=camp.created_by
			LEFT JOIN channels ch ON ch.id=camp.channel_id
			WHERE camp.created_at::date >= ? AND camp.created_at::date <= ?
			ORDER BY camp.created_at DESC`, from, to).Scan(&rows)
		for _, r := range rows {
			// Porcentaje de entrega calculado en Go para evitar división por cero en el loop.
			pct := 0.0
			if r.TotalRecipients > 0 {
				pct = float64(r.SentCount) * 100.0 / float64(r.TotalRecipients)
			}
			comp := ""
			if r.CompletedAt != nil {
				comp = r.CompletedAt.Format("02/01/2006 15:04")
			}
			w.Write([]string{
				csvSafe(r.Name), csvSafe(r.Channel), csvSafe(r.SentBy), csvSafe(r.Status),
				strconv.FormatInt(r.TotalRecipients, 10), strconv.FormatInt(r.SentCount, 10),
				strconv.FormatInt(r.FailedCount, 10), fmt.Sprintf("%.1f%%", pct), comp,
			})
		}

	default:
		c.JSON(http.StatusBadRequest, gin.H{"message": "type inválido: conversations | agents | campaigns"})
		return
	}

	// Flush escribe el buffer interno del csv.Writer al bytes.Buffer.
	w.Flush()
	// El nombre del archivo incluye el tipo y el rango de fechas para facilitar
	// la identificación al guardar múltiples exportaciones.
	filename := fmt.Sprintf("reporte_%s_%s_%s.csv", reportType, from, to)
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}
