package handlers

import (
	"net/http"

	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func ListTags(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var tags []models.Tag
	if err := db.Find(&tags).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tags})
}

// ListTagsPub — accessible to all operational roles
func ListTagsPub(c *gin.Context) { ListTags(c) }

func CreateTag(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		Name         string `json:"name" binding:"required"`
		Color        string `json:"color"`
		DepartmentID uint   `json:"department_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	tag := models.Tag{Name: req.Name, Color: req.Color, DepartmentID: req.DepartmentID}
	if err := db.Create(&tag).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": tag})
}

func UpdateTag(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	var tag models.Tag
	if err := db.First(&tag, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Tag no encontrado"})
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
	db.Model(&tag).Updates(updates)
	c.JSON(http.StatusOK, gin.H{"data": tag})
}

func DeleteTag(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	db.Delete(&models.Tag{}, id)
	c.JSON(http.StatusNoContent, nil)
}
