package handlers

import (
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"

	"harmony-api/internal/database"
	"harmony-api/internal/models"
	"harmony-api/internal/services"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// sendAdminCredentialsEmail notifica al encargado sus credenciales de administrador.
// Best-effort: si el SMTP no está configurado o falla, se registra y se continúa (las
// credenciales igual se muestran en la UI una sola vez).
func sendAdminCredentialsEmail(company *models.Company, password string) {
	subject := "Acceso de administrador — " + company.Name
	html := fmt.Sprintf(`
		<p>Hola %s,</p>
		<p>Se ha creado tu acceso de administrador para <strong>%s</strong>.</p>
		<p><strong>Correo:</strong> %s<br>
		<strong>Contraseña temporal:</strong> %s</p>
		<p>Inicia sesión y cambia tu contraseña desde tu perfil lo antes posible.</p>`,
		company.ContactName, company.Name, company.ContactEmail, password)
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
