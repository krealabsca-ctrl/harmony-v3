package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"time"

	"harmony-api/internal/config"
	"harmony-api/internal/database"
	"harmony-api/internal/middleware"
	"harmony-api/internal/models"
	"harmony-api/internal/services"
	"harmony-api/internal/ws"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// setAuthCookie establece el JWT en una cookie httpOnly (no accesible por JavaScript).
// CRIT-06: protege el token contra robo por XSS.
func setAuthCookie(c *gin.Context, tokenStr string) {
	secure := config.App.AppEnv == "production"
	maxAge := config.App.JWTExpiryHours * 3600
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie("harmony_token", tokenStr, maxAge, "/", "", secure, true)
}

func clearAuthCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie("harmony_token", "", -1, "/", "", config.App.AppEnv == "production", true)
}

// Login autentica al usuario y devuelve un JWT con los datos del user y su empresa.
func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Datos inválidos", "errors": err.Error()})
		return
	}

	// Buscar primero si es superadmin (en la system DB)
	var superadmin models.User
	err := database.SystemDB.Where("email = ? AND role = 'superadmin'", req.Email).First(&superadmin).Error
	if err == nil {
		if bcrypt.CompareHashAndPassword([]byte(superadmin.Password), []byte(req.Password)) != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Credenciales incorrectas"})
			return
		}
		token, err := generateToken(superadmin.ID, 0, superadmin.Role, "")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Error interno"})
			return
		}
		setAuthCookie(c, token)
		c.JSON(http.StatusOK, gin.H{
			"token": token,
			"user":  buildUserResponse(&superadmin, nil),
		})
		return
	}

	// M-01: resolver la empresa vía users_lookup (O(1)) con fallback a escaneo self-healing.
	company, findErr := findUserCompany(req.Email)
	if findErr != nil {
		// Ejecutar bcrypt con hash ficticio para igualar el tiempo de respuesta
		// y evitar que un atacante distinga "email no existe" de "contraseña incorrecta".
		_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$dummyhashfortimingequalizer00000000000000000"), []byte(req.Password))
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Credenciales incorrectas"})
		return
	}

	companyDB, err := database.GetCompanyDB(company.ID, company.DBName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error de conexión"})
		return
	}

	var user models.User
	if err := companyDB.Where("email = ? AND is_bot = false", req.Email).First(&user).Error; err != nil {
		_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$dummyhashfortimingequalizer00000000000000000"), []byte(req.Password))
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Credenciales incorrectas"})
		return
	}

	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Credenciales incorrectas"})
		return
	}

	// Marcar online
	companyDB.Model(&user).Updates(map[string]any{"is_online": true, "last_seen_at": time.Now()})

	// M-01: registrar el email en el lookup para acelerar futuros logins/recuperaciones.
	rememberUserLookup(req.Email, company.ID)

	token, err := generateToken(user.ID, company.ID, user.Role, company.DBName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error interno"})
		return
	}
	setAuthCookie(c, token)
	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  buildUserResponse(&user, &company),
	})
}

// Logout marca al usuario como offline
func Logout(c *gin.Context) {
	if db, exists := c.Get("db"); exists {
		userID, _ := c.Get("user_id")
		db.(*gorm.DB).Model(&models.User{}).Where("id = ?", userID).
			Updates(map[string]any{"is_online": false, "last_seen_at": time.Now()})
	}
	clearAuthCookie(c)
	c.JSON(http.StatusOK, gin.H{"message": "Sesión cerrada"})
}

// Me retorna los datos del usuario autenticado
func Me(c *gin.Context) {
	userID, _ := c.Get("user_id")
	companyID, _ := c.Get("company_id")
	dbName, _ := c.Get("db_name")

	if dbName == "" {
		// Superadmin: buscar en system DB
		var user models.User
		if err := database.SystemDB.First(&user, userID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"message": "Usuario no encontrado"})
			return
		}
		c.JSON(http.StatusOK, buildUserResponse(&user, nil))
		return
	}

	db, err := database.GetCompanyDB(companyID.(uint), dbName.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error de DB"})
		return
	}

	var user models.User
	db.First(&user, userID)

	var company models.Company
	database.SystemDB.First(&company, companyID)

	c.JSON(http.StatusOK, buildUserResponse(&user, &company))
}

// Heartbeat actualiza el estado online del usuario
func Heartbeat(c *gin.Context) {
	if db, exists := c.Get("db"); exists {
		userID, _ := c.Get("user_id")
		db.(*gorm.DB).Model(&models.User{}).Where("id = ?", userID).
			Updates(map[string]any{"is_online": true, "last_seen_at": time.Now()})
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// generateToken firma un JWT HS256 con los claims de sesión.
// A-09: devuelve error en vez de log.Fatalf — un fallo de firma NUNCA debe tumbar
// el servidor entero (os.Exit) matando todas las conexiones en vuelo.
func generateToken(userID, companyID uint, role models.UserRole, dbName string) (string, error) {
	claims := &middleware.Claims{
		UserID:    userID,
		CompanyID: companyID,
		Role:      role,
		DBName:    dbName,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(config.App.JWTExpiryHours) * time.Hour)),
		},
	}
	tokenStr, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.App.JWTSecret))
	if err != nil {
		log.Printf("ERROR: JWT signing falló (verifica JWT_SECRET): %v", err)
		return "", err
	}
	return tokenStr, nil
}

func buildUserResponse(user *models.User, company *models.Company) gin.H {
	resp := gin.H{
		"id":                     user.ID,
		"name":                   user.Name,
		"email":                  user.Email,
		"role":                   user.Role,
		"company_id":             user.CompanyID,
		"department_id":          user.DepartmentID,
		"can_send_campaigns":     user.CanSendCampaigns,
		"can_access_advertising": user.CanAccessAdvertisingModule(),
	}
	if company != nil {
		resp["company"] = gin.H{
			"id":                  company.ID,
			"name":                company.Name,
			"primary_color":       company.PrimaryColor,
			"secondary_color":     company.SecondaryColor,
			"logo_path":           company.LogoPath,
			"omnichannel_enabled": company.OmnichannelEnabled,
			"advertising_enabled": company.AdvertisingEnabled,
		}
	}
	return resp
}

// rememberUserLookup guarda (o actualiza) la resolución email → empresa (M-01).
func rememberUserLookup(email string, companyID uint) {
	database.SystemDB.Exec(`
		INSERT INTO users_lookup (email, company_id) VALUES (?, ?)
		ON CONFLICT (email) DO UPDATE SET company_id = EXCLUDED.company_id`,
		email, companyID)
}

// findUserCompany resuelve la empresa de un usuario por email.
//
// M-01: consulta primero users_lookup en O(1). Solo si no hay entrada (o quedó
// obsoleta) cae al escaneo de todas las empresas, rellenando el lookup para las
// siguientes llamadas. Esto evita abrir la conexión de TODAS las empresas en cada
// login / forgot-password / detect-company (agotamiento de pool y enumeración).
func findUserCompany(email string) (models.Company, error) {
	// 1. Camino rápido: lookup directo, verificando que el usuario aún exista.
	var lk struct {
		CompanyID uint `gorm:"column:company_id"`
	}
	if err := database.SystemDB.Table("users_lookup").
		Select("company_id").Where("email = ?", email).Take(&lk).Error; err == nil && lk.CompanyID != 0 {
		var company models.Company
		if database.SystemDB.Where("id = ? AND is_active = true AND db_name != ''", lk.CompanyID).
			First(&company).Error == nil {
			if db, e := database.GetCompanyDB(company.ID, company.DBName); e == nil {
				var user models.User
				if db.Where("email = ? AND is_bot = false", email).First(&user).Error == nil {
					return company, nil
				}
			}
		}
		// Entrada obsoleta: eliminarla y reintentar por escaneo.
		database.SystemDB.Exec("DELETE FROM users_lookup WHERE email = ?", email)
	}

	// 2. Camino lento: escaneo + backfill.
	var companies []models.Company
	database.SystemDB.Where("is_active = true AND db_name != ''").Find(&companies)
	for _, company := range companies {
		db, err := database.GetCompanyDB(company.ID, company.DBName)
		if err != nil {
			continue
		}
		var user models.User
		if db.Where("email = ? AND is_bot = false", email).First(&user).Error == nil {
			rememberUserLookup(email, company.ID)
			return company, nil
		}
	}
	return models.Company{}, gorm.ErrRecordNotFound
}

// passwordResetToken es el modelo para la tabla password_reset_tokens.
type passwordResetToken struct {
	ID        uint       `gorm:"primarykey"`
	UserID    uint       `gorm:"not null"`
	Token     string     `gorm:"unique;not null"`
	ExpiresAt time.Time  `gorm:"not null"`
	UsedAt    *time.Time
	CreatedAt time.Time
}

func (passwordResetToken) TableName() string { return "password_reset_tokens" }

// ForgotPassword genera un token de recuperación y lo envía por email.
// Siempre responde con 200 OK independientemente de si el email existe,
// para no filtrar si un usuario está registrado.
func ForgotPassword(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Si el correo existe recibirás un enlace de recuperación."})
		return
	}

	company, err := findUserCompany(req.Email)
	if err != nil {
		// Respuesta idéntica aunque el email no exista — evita user enumeration
		c.JSON(http.StatusOK, gin.H{"message": "Si el correo existe recibirás un enlace de recuperación."})
		return
	}

	db, err := database.GetCompanyDB(company.ID, company.DBName)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Si el correo existe recibirás un enlace de recuperación."})
		return
	}

	var user models.User
	if db.Where("email = ? AND is_bot = false", req.Email).First(&user).Error != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Si el correo existe recibirás un enlace de recuperación."})
		return
	}

	// Invalidar tokens anteriores del mismo usuario
	db.Where("user_id = ? AND used_at IS NULL", user.ID).Delete(&passwordResetToken{})

	// Generar token criptográficamente seguro
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error interno"})
		return
	}
	tokenStr := hex.EncodeToString(rawToken)

	prt := passwordResetToken{
		UserID:    user.ID,
		Token:     tokenStr,
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}
	if err := db.Create(&prt).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error interno"})
		return
	}

	resetURL := config.App.FrontendURL + "/reset-password?token=" + tokenStr
	// M-04: NUNCA loguear la URL/token de reset (cualquiera con acceso a logs tomaría la
	// cuenta). Se envía por SMTP; si el envío falla se registra solo el user_id, sin el token.
	if err := sendPasswordResetEmail(user.Email, resetURL); err != nil {
		log.Printf("WARN [password-reset] no se pudo enviar el email al user_id=%d: %v", user.ID, err)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Si el correo existe recibirás un enlace de recuperación."})
}

// sendPasswordResetEmail entrega el enlace de recuperación por correo.
// M-04: NUNCA loguear la URL/token (cualquiera con acceso a logs tomaría la cuenta).
// Se envía por SMTP; si falla, se registra solo el user_id, sin el token.
func sendPasswordResetEmail(email, resetURL string) error {
	subject := "Recupera tu contraseña — Harmony"
	htmlBody := fmt.Sprintf(`
	<html>
	<body style="font-family: Arial, sans-serif; background-color: #f5f5f5;">
		<div style="max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px;">
			<h2 style="color: #333;">Recupera tu contraseña</h2>
			<p style="color: #666;">Recibiste esta solicitud para restablecer tu contraseña en Harmony.</p>
			<p style="margin: 20px 0;">
				<a href="%s" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px;">
					Restablecer contraseña
				</a>
			</p>
			<p style="color: #999; font-size: 12px;">
				Este enlace expira en 1 hora. Si no solicitaste recuperar tu contraseña, ignora este correo.
			</p>
			<p style="color: #999; font-size: 12px; margin-top: 20px;">
				Harmony — Sistema de Gestión Omnicanal
			</p>
		</div>
	</body>
	</html>
	`, resetURL)

	return services.Send(email, subject, htmlBody)
}

// ResetPassword valida el token y actualiza la contraseña del usuario.
func ResetPassword(c *gin.Context) {
	var req struct {
		Token    string `json:"token" binding:"required"`
		Password string `json:"password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Datos inválidos", "errors": err.Error()})
		return
	}

	// Buscar el token en todas las empresas activas
	var companies []models.Company
	database.SystemDB.Where("is_active = true AND db_name != ''").Find(&companies)

	for _, company := range companies {
		db, err := database.GetCompanyDB(company.ID, company.DBName)
		if err != nil {
			continue
		}

		var prt passwordResetToken
		if db.Where("token = ? AND used_at IS NULL AND expires_at > ?", req.Token, time.Now()).
			First(&prt).Error != nil {
			continue
		}

		// Token encontrado — actualizar contraseña
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Error interno"})
			return
		}

		now := time.Now()
		db.Model(&models.User{}).Where("id = ?", prt.UserID).Update("password", string(hash))
		db.Model(&prt).Update("used_at", &now)

		c.JSON(http.StatusOK, gin.H{"message": "Contraseña actualizada correctamente."})
		return
	}

	c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Token inválido o expirado."})
}

// DetectCompany devuelve el nombre de la empresa asociada a un email.
// Endpoint público (sin auth) usado en el login para mostrar la empresa
// en tiempo real mientras el usuario escribe su correo.
func DetectCompany(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusOK, gin.H{"company_name": ""})
		return
	}
	company, err := findUserCompany(email)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"company_name": ""})
		return
	}
	c.JSON(http.StatusOK, gin.H{"company_name": company.Name})
}

// RefreshSession valida la cookie httpOnly y devuelve un token JWT fresco en el cuerpo.
// CRIT-06: permite que el frontend restaure la sesión desde la cookie tras un recarga.
func RefreshSession(c *gin.Context) {
	// AuthRequired middleware ya validó el token (desde cookie o header).
	userID := c.GetUint("user_id")
	companyID := c.GetUint("company_id")
	role := c.GetString("role")
	dbName := c.GetString("db_name")

	newToken, err := generateToken(userID, companyID, models.UserRole(role), dbName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error interno"})
		return
	}
	setAuthCookie(c, newToken)

	if dbName == "" {
		var user models.User
		if err := database.SystemDB.First(&user, userID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"message": "Usuario no encontrado"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"token": newToken, "user": buildUserResponse(&user, nil)})
		return
	}

	db, err := database.GetCompanyDB(companyID, dbName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error de DB"})
		return
	}
	var user models.User
	db.First(&user, userID)
	var company models.Company
	database.SystemDB.First(&company, companyID)
	c.JSON(http.StatusOK, gin.H{"token": newToken, "user": buildUserResponse(&user, &company)})
}

// CreateWSTicket genera un ticket de un solo uso (30s TTL) para conectar WebSocket.
// CRIT-05: evita exponer el JWT completo en la URL del WebSocket.
func CreateWSTicket(c *gin.Context) {
	userID := c.GetUint("user_id")
	companyID := c.GetUint("company_id")
	role := c.GetString("role")
	dbName := c.GetString("db_name")

	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error interno"})
		return
	}
	ticket := hex.EncodeToString(raw)
	ws.StoreWSTicket(ticket, userID, companyID, role, dbName)
	c.JSON(http.StatusOK, gin.H{"ticket": ticket})
}
