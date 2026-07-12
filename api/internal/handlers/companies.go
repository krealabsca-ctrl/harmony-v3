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
	c.JSON(http.StatusOK, companies)
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
	}

	if err := database.SystemDB.Create(&company).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al crear empresa"})
		return
	}

	// Provisionar la base de datos de la empresa
	dbName, err := database.ProvisionCompanyDB(company.ID)
	if err != nil {
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
	allowed := []string{"name", "primary_color", "secondary_color", "is_active", "omnichannel_enabled", "advertising_enabled", "logo_path"}
	updates := make(map[string]any)
	for _, k := range allowed {
		if v, ok := input[k]; ok {
			updates[k] = v
		}
	}
	database.SystemDB.Model(&company).Updates(updates)
	c.JSON(http.StatusOK, company)
}
