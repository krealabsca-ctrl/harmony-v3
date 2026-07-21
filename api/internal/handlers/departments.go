package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Department struct {
	ID                       uint   `gorm:"primarykey" json:"id"`
	CompanyID                uint   `json:"company_id"`
	Name                     string `gorm:"not null" json:"name"`
	Description              string `json:"description"`
	Color                    string `json:"color"`
	IsActive                 bool   `gorm:"column:is_active" json:"is_active"`
	AutoAssign               bool   `gorm:"column:auto_assign" json:"auto_assign"`
	MaxConversationsPerAgent int    `gorm:"column:max_conversations_per_agent" json:"max_conversations_per_agent"`
}

func (Department) TableName() string { return "departments" }

func ListDepartments(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var depts []Department
	if err := db.Where("deleted_at IS NULL").Find(&depts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": depts})
}

func CreateDepartment(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		Name                     string `json:"name" binding:"required"`
		Description              string `json:"description"`
		Color                    string `json:"color"`
		AutoAssign               bool   `json:"auto_assign"`
		MaxConversationsPerAgent int    `json:"max_conversations_per_agent"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	if req.Color == "" {
		req.Color = "#6366f1"
	}
	dept := Department{
		CompanyID:                c.GetUint("company_id"),
		Name:                     req.Name,
		Description:              req.Description,
		Color:                    req.Color,
		IsActive:                 true,
		AutoAssign:               req.AutoAssign,
		MaxConversationsPerAgent: req.MaxConversationsPerAgent,
	}
	if err := db.Create(&dept).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": dept})
}

func UpdateDepartment(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	var dept Department
	if err := db.First(&dept, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Departamento no encontrado"})
		return
	}
	// Punteros para distinguir "no enviado" de valor vacío/false (así se guardan
	// descripción vacía y auto_assign=false correctamente).
	var req struct {
		Name                     *string `json:"name"`
		Description              *string `json:"description"`
		Color                    *string `json:"color"`
		IsActive                 *bool   `json:"is_active"`
		AutoAssign               *bool   `json:"auto_assign"`
		MaxConversationsPerAgent *int    `json:"max_conversations_per_agent"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	updates := map[string]any{}
	if req.Name != nil && *req.Name != "" {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Color != nil && *req.Color != "" {
		updates["color"] = *req.Color
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}
	if req.AutoAssign != nil {
		updates["auto_assign"] = *req.AutoAssign
	}
	if req.MaxConversationsPerAgent != nil {
		updates["max_conversations_per_agent"] = *req.MaxConversationsPerAgent
	}
	if len(updates) > 0 {
		db.Model(&dept).Updates(updates)
		db.First(&dept, id) // recargar para devolver los valores actualizados
	}
	c.JSON(http.StatusOK, gin.H{"data": dept})
}

func DeleteDepartment(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	db.Delete(&Department{}, id)
	c.JSON(http.StatusNoContent, nil)
}
