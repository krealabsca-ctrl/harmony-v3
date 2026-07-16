// Package router configura el enrutador HTTP principal de la API de Harmony v3.
//
// Este archivo define toda la estructura de rutas de la aplicación usando Gin.
// Las rutas están organizadas en grupos jerárquicos según el nivel de acceso
// requerido. La jerarquía es:
//
//  1. Rutas públicas (sin autenticación): /auth, /webhooks
//  2. Rutas autenticadas: requieren JWT válido via middleware.AuthRequired()
//     2a. Superadmin: gestión global de empresas (solo rol "superadmin")
//     2b. Empresa: todas las demás rutas, que usan la BD de la empresa activa
//         - ops (admin + supervisor + agent): operativa diaria de conversaciones
//         - sup (admin + supervisor): monitor, reportes, plantillas, campañas
//         - adm (admin): configuración, usuarios, canales, bot, ajustes
//         - pub (admin + mercadeo + supervisor): módulo de publicaciones y leads
package router

import (
	"net/http"
	"strings"
	"time"

	"harmony-api/internal/config"
	"harmony-api/internal/handlers"
	"harmony-api/internal/middleware"
	"harmony-api/internal/ws"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// Setup inicializa y devuelve el motor Gin con todos los middlewares globales,
// la política CORS y los grupos de rutas registrados.
func Setup() *gin.Engine {
	r := gin.New()

	// A-08: no confiar en cabeceras X-Forwarded-For arbitrarias. En producción se debe
	// listar la IP del reverse proxy real vía TRUSTED_PROXIES; por defecto (nil) Gin usa
	// la IP de conexión directa, evitando que un atacante falsee su IP para saltarse el
	// rate limit por IP.
	if len(config.App.TrustedProxies) > 0 {
		_ = r.SetTrustedProxies(config.App.TrustedProxies)
	} else {
		_ = r.SetTrustedProxies(nil)
	}

	r.Use(gin.Logger(), gin.Recovery())
	r.Use(middleware.SecurityHeaders())

	// C-05: límite global de tamaño de body para toda la API — previene OOM por POST de
	// varios GB. Se fija en 16 MB para no romper las subidas legítimas (CSV de campañas
	// hasta 5 MB, logos/favicon); los webhooks aplican además su propio límite de 1 MB y
	// el CSV valida su tamaño exacto en el handler.
	r.Use(func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
		c.Next()
	})

	// CORS — en desarrollo permite cualquier localhost; en producción solo FrontendURL
	corsOrigins := []string{config.App.FrontendURL}
	corsConfig := cors.Config{
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Requested-With"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}
	if config.App.AppEnv == "development" {
		// En desarrollo se acepta cualquier origen de localhost o 127.0.0.1
		// para facilitar el trabajo con distintos puertos del frontend local.
		corsConfig.AllowOriginFunc = func(origin string) bool {
			return strings.HasPrefix(origin, "http://localhost") ||
				strings.HasPrefix(origin, "http://127.0.0.1")
		}
	} else {
		// En producción solo se permite el dominio del frontend configurado.
		corsConfig.AllowOrigins = corsOrigins
	}
	r.Use(cors.New(corsConfig))

	// Archivos adjuntos — requieren JWT válido; el handler valida ownership por empresa.
	r.GET("/uploads/*filepath", handlers.ServeUpload)

	// WebSocket
	// Punto de conexión para el cliente en tiempo real (notificaciones, chat en vivo).
	r.GET("/ws", ws.ServeWS)

	api := r.Group("/api")

	// Configuración pública del sistema (favicon, nombre de app)
	api.GET("/system-config", handlers.GetSystemConfig)

	// ─── Grupo: Auth (sin autenticación) ──────────────────────────────────────
	// Estas rutas son accesibles por cualquier visitante sin token.
	// Incluyen inicio de sesión y flujo de recuperación de contraseña.
	// No aplican ningún middleware de autenticación ni de empresa.
	auth := api.Group("/auth")
	{
		auth.POST("/login", middleware.LoginRateLimit(), handlers.Login)
		auth.GET("/detect-company", middleware.DetectCompanyRateLimit(), handlers.DetectCompany)
		auth.POST("/forgot-password", middleware.ForgotPasswordRateLimit(), handlers.ForgotPassword)
		auth.POST("/reset-password", handlers.ResetPassword)
	}

	// ─── Grupo: Webhooks (sin autenticación, throttled) ───────────────────────
	// Estos endpoints son invocados directamente por plataformas externas
	// (Meta/WhatsApp, Telegram) para entregar mensajes entrantes y verificar tokens.
	// No requieren autenticación JWT porque el verificador usa tokens propios de
	// cada plataforma. Se recomienda aplicar rate limiting a nivel de infraestructura.
	webhooks := api.Group("/webhooks")
	{
		// Las URLs usan el public_id UUID del canal (no el ID entero) para evitar
		// que un atacante enumere canales de otros tenants por IDs secuenciales.
		webhooks.GET("/whatsapp/:publicId", handlers.WhatsAppVerify)
		webhooks.POST("/whatsapp/:publicId", handlers.WhatsAppHandle)
		webhooks.GET("/messenger/:publicId", handlers.MessengerVerify)
		webhooks.POST("/messenger/:publicId", handlers.MessengerHandle)
		webhooks.GET("/instagram/:publicId", handlers.InstagramVerify)
		webhooks.POST("/instagram/:publicId", handlers.InstagramHandle)
		webhooks.POST("/telegram/:publicId", handlers.TelegramHandle)
	}

	// ─── Grupo: Rutas autenticadas ────────────────────────────────────────────
	// Todas las rutas dentro de este grupo requieren un JWT válido en el header
	// Authorization: Bearer <token>. El middleware AuthRequired() valida el token,
	// extrae el user_id, el role y la company_id, y los inyecta en el contexto Gin.
	authed := api.Group("/")
	authed.Use(middleware.AuthRequired())
	{
		// Rutas de sesión disponibles para cualquier usuario autenticado,
		// independientemente del rol o empresa.
		authed.GET("/auth/me", handlers.Me)
		authed.POST("/auth/refresh", handlers.RefreshSession)    // CRIT-06: restaura sesión desde cookie
		authed.POST("/auth/ws-ticket", handlers.CreateWSTicket)  // CRIT-05: ticket de un solo uso para WS
		authed.POST("/heartbeat", handlers.Heartbeat)
		authed.POST("/auth/logout", handlers.Logout)

		// ─── Grupo: Superadmin ─────────────────────────────────────────────────
		// Solo accesible para el rol "superadmin" (administrador global de la plataforma).
		// Permite gestionar las empresas (tenants) registradas en el sistema.
		// El superadmin NO accede a rutas de empresa individuales; opera a nivel global.
		sa := authed.Group("/")
		sa.Use(middleware.RequireRole("superadmin"))
		{
			sa.GET("/admin/companies", handlers.ListCompanies)
			sa.POST("/admin/companies", handlers.CreateCompany)
			sa.PUT("/admin/companies/:id", handlers.UpdateCompany)
			sa.DELETE("/admin/companies/:id", handlers.DeleteCompany)
			sa.GET("/admin/system-settings", handlers.GetSystemSettings)
			sa.PUT("/admin/system-settings", handlers.UpdateSystemSettings)
			sa.POST("/admin/system-settings/favicon", handlers.UploadSystemFavicon)
			sa.POST("/admin/system-settings/logo", handlers.UploadSystemLogo)
			sa.GET("/admin/system-settings/smtp", handlers.GetSystemSmtp)
			sa.PUT("/admin/system-settings/smtp", handlers.UpdateSystemSmtp)
			sa.POST("/admin/system-settings/smtp/test", handlers.TestSystemSmtp)
			sa.GET("/admin/system-settings/retention-template", handlers.GetRetentionTemplate)
			sa.PUT("/admin/system-settings/retention-template", handlers.UpdateRetentionTemplate)
		}

		// ─── Grupo: Rutas de empresa (superadmin excluido) ────────────────────
		// El middleware NotSuperAdmin() bloquea el acceso al superadmin en estas rutas,
		// ya que no pertenece a ninguna empresa concreta.
		// El middleware CompanyDB() resuelve la base de datos de la empresa del usuario
		// autenticado e inyecta la conexión GORM en el contexto bajo la clave "db".
		company := authed.Group("/")
		company.Use(middleware.NotSuperAdmin(), middleware.CompanyDB())
		{
			// ─── Grupo: Operativa (admin + supervisor + agent) ─────────────────
			// Este grupo cubre la funcionalidad diaria que necesita cualquier miembro
			// del equipo de atención: ver y gestionar conversaciones, enviar mensajes,
			// reasignar casos, subir archivos y consultar el dashboard personal.
			// Los agentes solo ven sus propias conversaciones; admins y supervisores
			// pueden ver todo el equipo (la lógica de filtrado está en los handlers).
			ops := company.Group("/")
			ops.Use(middleware.RequireRole("admin", "supervisor", "agent"))
			{
				ops.GET("/conversations", handlers.ListConversations)
				ops.POST("/conversations", handlers.CreateConversation)
				ops.GET("/conversations/:id", handlers.GetConversation)
				ops.GET("/conversations/:id/messages", handlers.ListMessages)
				ops.POST("/conversations/:id/messages", handlers.SendMessage)
				ops.PUT("/conversations/:id/assign", handlers.AssignConversation)
				ops.PUT("/conversations/:id/close", handlers.CloseConversation)
				ops.PUT("/conversations/:id/reopen", handlers.ReopenConversation)
				ops.PUT("/conversations/:id/tags", handlers.UpdateConversationTags)
				ops.PUT("/conversations/:id/mark-read", handlers.MarkConversationRead)
				ops.POST("/conversations/bulk-reassign", handlers.BulkReassign)
				ops.POST("/conversations/:id/attachments", handlers.UploadAttachment)
				ops.PUT("/contacts/:id", handlers.UpdateContact)
				ops.GET("/contacts/:id/conversations", handlers.GetContactConversations)
				ops.GET("/chat-history", handlers.ChatHistory)
				ops.GET("/dashboard", handlers.Dashboard)
				ops.GET("/departments", handlers.ListDepartments)
				ops.GET("/agents", handlers.ListAgents)
				ops.GET("/tags", handlers.ListTagsPub)
				// Plantillas disponibles para agentes: solo las aprobadas y habilitadas para agentes
				// (visible_to_agents=true). Se usa en el inbox cuando la ventana de 24h ha expirado.
				ops.GET("/templates/available", handlers.ListAvailableTemplates)
			}

			// ─── Grupo: Supervisión (admin + supervisor) ───────────────────────
			// Rutas de visibilidad y control de equipo: monitor en tiempo real,
			// reportes históricos, plantillas de mensajes y campañas masivas.
			// Los agentes no tienen acceso porque no deben ver métricas globales
			// ni enviar campañas sin aprobación de un supervisor o admin.
			sup := company.Group("/")
			sup.Use(middleware.RequireRole("admin", "supervisor"))
			{
				sup.GET("/monitor", handlers.Monitor)
				sup.GET("/reports", handlers.Reports)
				sup.GET("/reports/resumen", handlers.Reports)
				sup.GET("/reports/conversaciones", handlers.Reports)
				sup.GET("/reports/agentes", handlers.Reports)
				sup.GET("/reports/campanas", handlers.Reports)
				sup.GET("/reports/costos", handlers.Reports)
				sup.GET("/reports/por-agente", handlers.Reports)
				sup.GET("/reports/por-tags", handlers.Reports)
				sup.GET("/reports/export", handlers.ExportReportCSV)
				sup.GET("/templates", handlers.ListTemplates)
				sup.POST("/templates", handlers.CreateTemplate)
				sup.PUT("/templates/:id", handlers.UpdateTemplate)
				sup.DELETE("/templates/:id", handlers.DeleteTemplate)
				sup.GET("/campaigns", handlers.ListCampaigns)
				sup.POST("/campaigns", handlers.CreateCampaign)
				sup.GET("/campaigns/:id", handlers.GetCampaign)
				sup.PUT("/campaigns/:id/launch", handlers.LaunchCampaign)
				sup.PUT("/campaigns/:id/cancel", handlers.CancelCampaign)
				// Tarifas de WhatsApp por país/categoría (USD por conversación).
				// El admin puede editar precios e importar CSV; el supervisor solo consulta.
				sup.GET("/admin/whatsapp-pricing", handlers.ListPricing)
				sup.PUT("/admin/whatsapp-pricing/:id", handlers.UpdatePricing)
				sup.POST("/admin/whatsapp-pricing/import", handlers.ImportPricingCSV)
			}

			// ─── Grupo: Administración (solo admin) ────────────────────────────
			// Configuración completa de la empresa: usuarios, departamentos, etiquetas,
			// canales de comunicación, configuración del bot de IA y ajustes de sistema.
			// Restringido a "admin" porque estas operaciones afectan la estructura y
			// seguridad de toda la empresa; supervisores y agentes no deben tener acceso.
			adm := company.Group("/")
			adm.Use(middleware.RequireRole("admin"))
			{
				// Gestión de usuarios de la empresa
				adm.GET("/admin/users", handlers.ListUsers)
				adm.POST("/admin/users", handlers.CreateUser)
				adm.PUT("/admin/users/:id", handlers.UpdateUser)
				adm.DELETE("/admin/users/:id", handlers.DeleteUser)
				// Permisos especiales por usuario
				adm.POST("/admin/users/:id/toggle-campaigns", handlers.ToggleCampaigns)
				adm.POST("/admin/users/:id/toggle-advertising", handlers.ToggleAdvertising)
				// Gestión de departamentos
				adm.GET("/admin/departments", handlers.ListDepartments)
				adm.POST("/admin/departments", handlers.CreateDepartment)
				adm.PUT("/admin/departments/:id", handlers.UpdateDepartment)
				adm.DELETE("/admin/departments/:id", handlers.DeleteDepartment)
				// Gestión de etiquetas (tags) de conversaciones
				adm.GET("/admin/tags", handlers.ListTags)
				adm.POST("/admin/tags", handlers.CreateTag)
				adm.PUT("/admin/tags/:id", handlers.UpdateTag)
				adm.DELETE("/admin/tags/:id", handlers.DeleteTag)
				// Gestión de canales de comunicación (WhatsApp, Messenger, etc.)
				adm.GET("/channels", handlers.ListChannels)
				adm.POST("/channels", handlers.CreateChannel)
				adm.PUT("/channels/:id", handlers.UpdateChannel)
				adm.DELETE("/channels/:id", handlers.DeleteChannel)
				// Simula un mensaje entrante para pruebas de integración
				adm.POST("/channels/:id/simulate-inbound", handlers.SimulateInbound)
				// Configuración del bot de IA (respuestas automáticas y documentos de contexto)
				adm.GET("/bot/settings", handlers.GetBotSettings)
				adm.PUT("/bot/settings", handlers.UpdateBotSettings)
				adm.PUT("/bot/api-key", handlers.SaveBotAPIKey)
				adm.PUT("/bot/department/:deptId", handlers.SaveBotDepartment)
				adm.POST("/bot/department/:deptId/toggle", handlers.ToggleBotDepartment)
				adm.GET("/bot/documents", handlers.ListBotDocuments)
				adm.POST("/bot/documents", handlers.UploadBotDocument)
				adm.DELETE("/bot/documents/:id", handlers.DeleteBotDocument)

				// Configuraciones de empresa (admin)
				adm.GET("/settings/smtp", handlers.GetSmtpSettings)
				adm.PUT("/settings/smtp", handlers.UpdateSmtpSettings)
				adm.GET("/settings/branding", handlers.GetBrandingSettings)
				adm.PUT("/settings/branding", handlers.UpdateBrandingSettings)
				// Configuración de retención de historial (cuánto tiempo se guardan conversaciones)
				adm.GET("/settings/history", handlers.GetHistorySettings)
				adm.PUT("/settings/history", handlers.UpdateHistorySettings)
				// Previsualiza cuántas conversaciones se eliminarían antes de ejecutar el borrado
				adm.GET("/settings/history/preview", handlers.PreviewHistoryDelete)
				adm.DELETE("/settings/history/conversations", handlers.DeleteHistoryConversations)
				// Datos de demostración para onboarding de nuevas empresas
				adm.POST("/admin/seed", handlers.SeedDemoData)
			}

			// ─── Grupo: Módulo Pub / Publicidad (admin + mercadeo + supervisor) ──
			// Módulo independiente para gestión de publicaciones en redes sociales,
			// seguimiento de leads y analítica de marketing.
			// El rol "mercadeo" solo existe dentro de este módulo; no tiene acceso
			// a conversaciones ni configuraciones del resto de la plataforma.
			pub := company.Group("/pub")
			pub.Use(middleware.RequireRole("admin", "mercadeo", "supervisor"))
			{
				pub.GET("/dashboard", handlers.PubDashboard)
				pub.GET("/posts", handlers.ListPubPosts)
				pub.POST("/posts", handlers.CreatePubPost)
				pub.PUT("/posts/:id", handlers.UpdatePubPost)
				pub.DELETE("/posts/:id", handlers.DeletePubPost)
				pub.GET("/leads", handlers.ListPubLeads)
				pub.GET("/analytics", handlers.PubAnalytics)
				pub.GET("/agents", handlers.ListPubAgents)
				pub.POST("/agents", handlers.CreatePubAgent)
				pub.PUT("/agents/:id", handlers.UpdatePubAgent)
				pub.DELETE("/agents/:id", handlers.DeletePubAgent)
				pub.GET("/campaigns", handlers.ListPubCampaigns)
				pub.POST("/campaigns", handlers.CreatePubCampaign)
				pub.GET("/campaigns/:id", handlers.GetPubCampaign)
				pub.PUT("/campaigns/:id", handlers.UpdatePubCampaign)
				pub.GET("/settings", handlers.GetPubSettingsFull)
				pub.PUT("/settings", handlers.UpdatePubSettingsFull)
				pub.POST("/generate", middleware.PubGenerateRateLimit(), handlers.TriggerPubGeneration)
				pub.GET("/comments", handlers.ListPubComments)
				pub.POST("/comments/:id/reply", handlers.ReplyPubComment)
				pub.PUT("/comments/:id/status", handlers.UpdatePubCommentStatus)
				pub.GET("/brand-kit", handlers.GetPubBrandKit)
				pub.POST("/brand-kit", handlers.SavePubBrandKit)
				pub.GET("/documents", handlers.ListPubDocuments)
				pub.POST("/documents", handlers.UploadPubDocument)
				pub.PUT("/documents/:id/toggle", handlers.TogglePubDocument)
				pub.DELETE("/documents/:id", handlers.DeletePubDocument)
			}
		}
	}

	return r
}
