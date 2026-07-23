package handlers

import (
	"crypto/rand"
	"log"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"harmony-api/internal/config"
	"harmony-api/internal/database"
	"harmony-api/internal/models"
	"harmony-api/internal/services"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// Guarda anti-duplicado del aviso de credenciales: evita enviar el mismo correo dos veces
// ante un reintento de red o doble submit (el usuario reportó recibirlo 2 veces).
var (
	credEmailMu   sync.Mutex
	credEmailSent = map[string]time.Time{}
)

// adminCredentialsEmailTmpl es la plantilla HTML (email-safe, con estilos inline y tablas)
// del correo de credenciales. Se rellena con strings.NewReplacer para no lidiar con los
// signos % de los anchos CSS en fmt.Sprintf.
const adminCredentialsEmailTmpl = `<!doctype html>
<html>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <!-- Header -->
        <tr>
          <td align="center" style="background:linear-gradient(135deg,{{PRIMARY}} 0%,{{SECONDARY}} 100%);background-color:{{PRIMARY}};padding:32px 24px;">
            {{LOGO}}
            <div style="color:#ffffff;font-size:20px;font-weight:700;">{{APP}}</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 8px 32px;color:#111827;">
            <p style="margin:0 0 16px;font-size:16px;">Hola <strong>{{NAME}}</strong>,</p>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
              Se creó tu acceso de <strong>administrador</strong> para <strong>{{COMPANY}}</strong>.
              Usa estas credenciales para iniciar sesión:
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-left:4px solid {{PRIMARY}};border-radius:10px;margin:0 0 24px;">
              <tr><td style="padding:16px 18px;">
                <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Correo</div>
                <div style="font-size:15px;font-family:Menlo,Consolas,monospace;color:#111827;margin-bottom:14px;">{{EMAIL}}</div>
                <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Contraseña temporal</div>
                <div style="font-size:18px;font-weight:700;font-family:Menlo,Consolas,monospace;color:{{PRIMARY}};letter-spacing:.02em;">{{PASSWORD}}</div>
              </td></tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr><td align="center" style="border-radius:10px;background-color:{{PRIMARY}};">
                <a href="{{LOGIN}}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">Iniciar sesión</a>
              </td></tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">
              Por seguridad, cambia tu contraseña desde tu perfil después de iniciar sesión.
              Si no esperabas este correo, ignóralo.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px 28px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">{{APP}} · Este es un mensaje automático, no respondas a este correo.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

// sendAdminCredentialsEmail notifica al encargado sus credenciales de administrador con un
// correo HTML con la marca (logo del sistema + colores de la empresa). Best-effort: si el
// SMTP no está configurado o falla, se registra y se continúa (las credenciales igual se
// muestran en la UI una sola vez).
func sendAdminCredentialsEmail(company *models.Company, password string) {
	// Dedupe: no reenviar el mismo aviso al mismo correo dentro de una ventana corta.
	credEmailMu.Lock()
	if last, ok := credEmailSent[company.ContactEmail]; ok && time.Since(last) < 2*time.Minute {
		credEmailMu.Unlock()
		return
	}
	credEmailSent[company.ContactEmail] = time.Now()
	credEmailMu.Unlock()

	appName := getSystemSettingValue("app_name")
	if appName == "" {
		appName = "Harmony"
	}
	primary := company.PrimaryColor
	if primary == "" {
		primary = "#4F46E5"
	}
	secondary := company.SecondaryColor
	if secondary == "" {
		secondary = "#7C3AED"
	}
	base := strings.TrimRight(config.App.FrontendURL, "/")

	// Logo del sistema (URL absoluta para que el cliente de correo pueda cargarlo).
	logoHTML := ""
	if logoPath := getSystemSettingValue("logo_path"); logoPath != "" {
		logoURL := base + "/" + strings.TrimLeft(logoPath, "/")
		logoHTML = `<img src="` + logoURL + `" alt="` + appName + `" width="52" height="52" style="display:block;margin:0 auto 12px;border-radius:12px;background:#ffffff;">`
	}

	html := strings.NewReplacer(
		"{{PRIMARY}}", primary,
		"{{SECONDARY}}", secondary,
		"{{LOGO}}", logoHTML,
		"{{APP}}", appName,
		"{{NAME}}", company.ContactName,
		"{{COMPANY}}", company.Name,
		"{{EMAIL}}", company.ContactEmail,
		"{{PASSWORD}}", password,
		"{{LOGIN}}", base+"/login",
	).Replace(adminCredentialsEmailTmpl)

	subject := "Tu acceso de administrador en " + appName
	if err := services.Send(company.ContactEmail, subject, html); err != nil {
		log.Printf("aviso: no se pudo enviar credenciales admin a %s: %v", company.ContactEmail, err)
	}
}

// generateTempPassword genera una contraseña temporal legible (sin caracteres ambiguos)
// usando crypto/rand. Se muestra una sola vez al superadmin al crear/restablecer el admin.
func generateTempPassword(n int) string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
	b := make([]byte, n)
	for i := range b {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			// Fallback determinista extremadamente improbable; mantiene longitud.
			b[i] = alphabet[i%len(alphabet)]
			continue
		}
		b[i] = alphabet[idx.Int64()]
	}
	return string(b)
}

// provisionCompanyAdmin crea (o restablece) el usuario admin de una empresa dentro de su
// propia base de datos, usando el correo del encargado como login. Devuelve la contraseña
// temporal en texto plano para mostrarla una única vez.
func provisionCompanyAdmin(company *models.Company) (string, error) {
	db, err := database.GetCompanyDB(company.ID, company.DBName)
	if err != nil {
		return "", err
	}

	tempPassword := generateTempPassword(12)
	hash, err := bcrypt.GenerateFromPassword([]byte(tempPassword), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}

	// ¿Ya existe un usuario con ese email? Si sí, solo restablecemos su contraseña y rol.
	var existing models.User
	if err := db.Where("email = ?", company.ContactEmail).First(&existing).Error; err == nil {
		db.Model(&existing).Updates(map[string]any{
			"password":               string(hash),
			"role":                   "admin",
			"name":                   company.ContactName,
			"can_send_campaigns":     true,
			"can_access_advertising": true,
		})
		co := *company
		go sendAdminCredentialsEmail(&co, tempPassword)
		return tempPassword, nil
	}

	companyID := company.ID
	admin := models.User{
		CompanyID:            &companyID,
		Name:                 company.ContactName,
		Email:                company.ContactEmail,
		Password:             string(hash),
		Role:                 "admin",
		CanSendCampaigns:     true,
		CanAccessAdvertising: true,
	}
	if err := db.Create(&admin).Error; err != nil {
		return "", err
	}
	co := *company
	go sendAdminCredentialsEmail(&co, tempPassword)
	return tempPassword, nil
}

// ListCompanies retorna todas las empresas (solo superadmin)
func ListCompanies(c *gin.Context) {
	var companies []models.Company
	database.SystemDB.Order("name").Find(&companies)

	// Llenar conteos de usuarios/departamentos consultando la DB de cada empresa.
	for i := range companies {
		if companies[i].DBName == "" {
			continue
		}
		cdb, err := database.GetCompanyDB(companies[i].ID, companies[i].DBName)
		if err != nil {
			continue
		}
		var users, depts int64
		cdb.Table("users").Where("deleted_at IS NULL AND is_bot = false").Count(&users)
		cdb.Table("departments").Where("deleted_at IS NULL").Count(&depts)
		companies[i].UsersCount = int(users)
		companies[i].DepartmentsCount = int(depts)
	}

	c.JSON(http.StatusOK, gin.H{
		"data": companies,
		"links": gin.H{
			"first": nil,
			"last":  nil,
			"prev":  nil,
			"next":  nil,
		},
		"meta": gin.H{
			"current_page": 1,
			"from":         1,
			"last_page":    1,
			"per_page":     len(companies),
			"to":           len(companies),
			"total":        len(companies),
		},
	})
}

// CreateCompany crea una empresa y provisiona su base de datos automáticamente.
func CreateCompany(c *gin.Context) {
	var input struct {
		Name               string `json:"name" binding:"required"`
		Slug               string `json:"slug"`
		PrimaryColor       string `json:"primary_color"`
		SecondaryColor     string `json:"secondary_color"`
		OmnichannelEnabled bool   `json:"omnichannel_enabled"`
		AdvertisingEnabled bool   `json:"advertising_enabled"`
		ContactName        string `json:"contact_name" binding:"required"`
		ContactEmail       string `json:"contact_email" binding:"required,email"`
		ContactPhone       string `json:"contact_phone" binding:"required"`
		RetentionDays      int    `json:"retention_days"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"errors": err.Error()})
		return
	}

	// Generar slug desde el nombre si no se proveyó
	if input.Slug == "" {
		input.Slug = strings.ToLower(strings.ReplaceAll(input.Name, " ", "-"))
	}
	if input.PrimaryColor == "" {
		input.PrimaryColor = "#6366f1"
	}
	if input.SecondaryColor == "" {
		input.SecondaryColor = "#8b5cf6"
	}

	company := models.Company{
		Name:               input.Name,
		Slug:               input.Slug,
		PrimaryColor:       input.PrimaryColor,
		SecondaryColor:     input.SecondaryColor,
		OmnichannelEnabled: input.OmnichannelEnabled,
		AdvertisingEnabled: input.AdvertisingEnabled,
		ContactName:        input.ContactName,
		ContactEmail:       input.ContactEmail,
		ContactPhone:       input.ContactPhone,
		RetentionDays:      input.RetentionDays,
	}

	if err := database.SystemDB.Create(&company).Error; err != nil {
		// Detectar si es un error de slug duplicado (constraint antigua o índice parcial nuevo)
		emsg := err.Error()
		if strings.Contains(emsg, "companies_slug_key") || strings.Contains(emsg, "uq_companies_slug_active") {
			c.JSON(http.StatusConflict, gin.H{"message": "El slug '" + input.Slug + "' ya existe. Por favor usa otro."})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al crear empresa: " + err.Error()})
		return
	}

	// Provisionar la base de datos de la empresa
	dbName, err := database.ProvisionCompanyDB(company.ID)
	if err != nil {
		// Si falla la provisión, borrar la fila de empresa (hard delete, ya que slug tiene constraint UNIQUE)
		database.SystemDB.Unscoped().Delete(&company)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al provisionar DB: " + err.Error()})
		return
	}

	database.SystemDB.Model(&company).Update("db_name", dbName)
	company.DBName = dbName

	// Crear automáticamente el usuario admin de la empresa (login = correo del encargado).
	// Si falla, la empresa igual queda creada; el superadmin puede reintentar con "Acceso admin".
	tempPassword, adminErr := provisionCompanyAdmin(&company)

	resp := gin.H{
		"id":                  company.ID,
		"name":                company.Name,
		"slug":                company.Slug,
		"logo_path":           company.LogoPath,
		"primary_color":       company.PrimaryColor,
		"secondary_color":     company.SecondaryColor,
		"is_active":           company.IsActive,
		"omnichannel_enabled": company.OmnichannelEnabled,
		"advertising_enabled": company.AdvertisingEnabled,
		"contact_name":        company.ContactName,
		"contact_email":       company.ContactEmail,
		"contact_phone":       company.ContactPhone,
		"retention_days":      company.RetentionDays,
	}
	if adminErr == nil {
		resp["admin_email"] = company.ContactEmail
		resp["admin_password"] = tempPassword
	} else {
		resp["admin_error"] = adminErr.Error()
	}

	c.JSON(http.StatusCreated, resp)
}

// ResetCompanyAdmin crea o restablece el usuario admin de una empresa existente y devuelve
// una contraseña temporal (solo superadmin). Sirve para empresas creadas antes de que el
// bootstrap de admin existiera, o cuando el encargado olvidó su clave.
//
// Responde a: POST /admin/companies/:id/reset-admin
func ResetCompanyAdmin(c *gin.Context) {
	var company models.Company
	if err := database.SystemDB.First(&company, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Empresa no encontrada"})
		return
	}
	if strings.TrimSpace(company.ContactEmail) == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "La empresa no tiene correo de encargado. Edítala y agrégalo primero."})
		return
	}

	// Auto-reparar: si la empresa no tiene DB provisionada (registro viejo roto),
	// provisionarla ahora. ProvisionCompanyDB es idempotente (CREATE DATABASE y
	// migraciones con IF NOT EXISTS), así que es seguro llamarlo aunque exista.
	if company.DBName == "" {
		dbName, err := database.ProvisionCompanyDB(company.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al provisionar la base de datos: " + err.Error()})
			return
		}
		database.SystemDB.Model(&company).Update("db_name", dbName)
		company.DBName = dbName
	}

	tempPassword, err := provisionCompanyAdmin(&company)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al crear el acceso admin: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"admin_email":    company.ContactEmail,
		"admin_password": tempPassword,
	})
}

// GetCompanyAdmin devuelve el usuario admin (solo el correo/login) de una empresa, SIN
// regenerar la contraseña ni enviar correo. La contraseña se guarda hasheada (no se puede
// mostrar); para obtener una nueva hay que restablecerla explícitamente (ResetCompanyAdmin).
//
// Responde a: GET /admin/companies/:id/admin
func GetCompanyAdmin(c *gin.Context) {
	var company models.Company
	if err := database.SystemDB.First(&company, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Empresa no encontrada"})
		return
	}

	hasUser := false
	if company.DBName != "" && strings.TrimSpace(company.ContactEmail) != "" {
		if db, err := database.GetCompanyDB(company.ID, company.DBName); err == nil {
			var count int64
			db.Table("users").Where("email = ? AND deleted_at IS NULL", company.ContactEmail).Count(&count)
			hasUser = count > 0
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"admin_email": company.ContactEmail,
		"has_user":    hasUser,
	})
}

// UpdateCompany actualiza los datos de una empresa
func UpdateCompany(c *gin.Context) {
	var company models.Company
	if err := database.SystemDB.First(&company, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Empresa no encontrada"})
		return
	}
	var input map[string]any
	c.ShouldBindJSON(&input)

	// Campos permitidos
	allowed := []string{
		"name", "primary_color", "secondary_color", "is_active",
		"omnichannel_enabled", "advertising_enabled", "logo_path",
		"contact_name", "contact_email", "contact_phone", "retention_days",
	}
	updates := make(map[string]any)
	for _, k := range allowed {
		if v, ok := input[k]; ok {
			updates[k] = v
		}
	}

	// Si retention_days cambia, resetear retention_warned_at (reinicia el ciclo de aviso)
	if newRetention, ok := input["retention_days"].(float64); ok {
		if int(newRetention) != company.RetentionDays {
			updates["retention_warned_at"] = nil
		}
	}

	if err := database.SystemDB.Model(&company).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al actualizar la empresa: " + err.Error()})
		return
	}
	database.SystemDB.First(&company, c.Param("id"))
	c.JSON(http.StatusOK, company)
}

// DeleteCompany elimina una empresa y sus datos asociados (soft-delete)
func DeleteCompany(c *gin.Context) {
	var company models.Company
	id := c.Param("id")
	if err := database.SystemDB.First(&company, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Empresa no encontrada"})
		return
	}
	database.SystemDB.Delete(&company)
	c.JSON(http.StatusNoContent, nil)
}
