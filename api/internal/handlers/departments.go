package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Department struct {
	ID        uint   `gorm:"primarykey" json:"id"`
	CompanyID uint   `json:"company_id"`
	Name      string `gorm:"not null" json:"name"`
	Color     string `json:"color"`
}

func (Department) TableName() string { return "departments" }

func ListDepartments(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var depts []Department
	if err := db.Find(&depts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": depts})
}

func CreateDepartment(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		Name  string `json:"name" binding:"required"`
		Color string `json:"color"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	dept := Department{Name: req.Name, Color: req.Color}
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
	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	c.ShouldBindJSON(&req)
	updates := map[string]any{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Color != "" {
		updates["color"] = req.Color
	}
	db.Model(&dept).Updates(updates)
	c.JSON(http.StatusOK, gin.H{"data": dept})
}

func DeleteDepartment(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	db.Delete(&Department{}, id)
	c.JSON(http.StatusNoContent, nil)
}
