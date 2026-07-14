package handlers

import (
	"net/http"
	"strings"

	"harmony-api/internal/database"
	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
)

// ListCompanies retorna todas las empresas (solo superadmin)
func ListCompanies(c *gin.Context) {
	var companies []models.Company
	database.SystemDB.Order("name").Find(&companies)
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
		// Detectar si es un error de slug duplicado
		if strings.Contains(err.Error(), "companies_slug_key") {
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

	c.JSON(http.StatusCreated, company)
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

	database.SystemDB.Model(&company).Updates(updates)
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
