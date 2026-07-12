package handlers

import (
	"net/http"
	"time"

	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// userDTO expone solo los campos seguros de un usuario (sin hash de contraseña)
type userDTO struct {
	ID                   uint       `json:"id"`
	Name                 string     `json:"name"`
	Email                string     `json:"email"`
	Role                 string     `json:"role"`
	IsOnline             bool       `json:"is_online"`
	DepartmentID         *uint      `json:"department_id"`
	CanSendCampaigns     bool       `json:"can_send_campaigns"`
	CanAccessAdvertising bool       `json:"can_access_advertising"`
	LastSeenAt           *time.Time `json:"last_seen_at"`
	CreatedAt            time.Time  `json:"created_at"`
}

func toUserDTO(u models.User) userDTO {
	online := u.LastSeenAt != nil && time.Since(*u.LastSeenAt) < 2*time.Minute
	return userDTO{
		ID:                   u.ID,
		Name:                 u.Name,
		Email:                u.Email,
		Role:                 string(u.Role),
		IsOnline:             online,
		DepartmentID:         u.DepartmentID,
		CanSendCampaigns:     u.CanSendCampaigns,
		CanAccessAdvertising: u.CanAccessAdvertisingModule(),
		LastSeenAt:           u.LastSeenAt,
		CreatedAt:            u.CreatedAt,
	}
}

// allowedRoles son los únicos roles válidos que un admin puede asignar
var allowedRoles = map[string]bool{
	"agent":      true,
	"supervisor": true,
	"admin":      true,
	"mercadeo":   true,
}

func ListUsers(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	// FIX: paginación + límite para evitar dumps completos de la tabla
	page := 1
	perPage := 50
	var users []models.User
	if err := db.Order("created_at DESC").Limit(perPage).Offset((page-1)*perPage).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al obtener usuarios"})
		return
	}
	dtos := make([]userDTO, len(users))
	for i, u := range users {
		dtos[i] = toUserDTO(u)
	}
	c.JSON(http.StatusOK, gin.H{"data": dtos})
}

// ListAgents — accessible to all operational roles (for transfer modal / inbox)
func ListAgents(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	deptID := c.Query("department_id")
	q := db.Model(&models.User{}).Where("role IN (?)", []string{"agent", "supervisor", "admin"})
	if deptID != "" {
		q = q.Where("department_id = ?", deptID)
	}
	type AgentDTO struct {
		ID           uint   `json:"id"`
		Name         string `json:"name"`
		IsOnline     bool   `json:"is_online"`
		DepartmentID *uint  `json:"department_id"`
	}
	var agents []models.User
	q.Find(&agents)
	result := make([]AgentDTO, len(agents))
	for i, a := range agents {
		online := a.LastSeenAt != nil && time.Since(*a.LastSeenAt) < 2*time.Minute
		result[i] = AgentDTO{ID: a.ID, Name: a.Name, IsOnline: online, DepartmentID: a.DepartmentID}
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func CreateUser(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	var req struct {
		Name         string `json:"name" binding:"required"`
		Email        string `json:"email" binding:"required,email"`
		Password     string `json:"password" binding:"required,min=8"`
		Role         string `json:"role" binding:"required"`
		DepartmentID *uint  `json:"department_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}

	// FIX: whitelist de roles permitidos
	if !allowedRoles[req.Role] {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Rol no válido"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al procesar la solicitud"})
		return
	}
	user := models.User{
		Name:         req.Name,
		Email:        req.Email,
		Password:     string(hash),
		Role:         models.UserRole(req.Role),
		DepartmentID: req.DepartmentID,
	}
	if err := db.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al crear el usuario"})
		return
	}
	// FIX: devolver DTO sin hash de contraseña
	c.JSON(http.StatusCreated, gin.H{"data": toUserDTO(user)})
}

func UpdateUser(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")

	// FIX: self-role-change protection
	callerID := c.GetUint("user_id")

	var user models.User
	if err := db.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Usuario no encontrado"})
		return
	}
	var req struct {
		Name         string `json:"name"`
		Email        string `json:"email"`
		Password     string `json:"password"`
		Role         string `json:"role"`
		DepartmentID *uint  `json:"department_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": err.Error()})
		return
	}
	updates := map[string]any{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Email != "" {
		updates["email"] = req.Email
	}
	if req.Role != "" {
		// FIX: whitelist + no se puede cambiar el propio rol
		if !allowedRoles[req.Role] {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Rol no válido"})
			return
		}
		if user.ID == callerID {
			c.JSON(http.StatusForbidden, gin.H{"message": "No puedes cambiar tu propio rol"})
			return
		}
		updates["role"] = req.Role
	}
	if req.DepartmentID != nil {
		updates["department_id"] = req.DepartmentID
	}
	if req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al procesar la solicitud"})
			return
		}
		updates["password"] = string(hash)
	}
	if err := db.Model(&user).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al actualizar el usuario"})
		return
	}
	// FIX: devolver DTO sin hash
	c.JSON(http.StatusOK, gin.H{"data": toUserDTO(user)})
}

func DeleteUser(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")

	// Advertir si tiene conversaciones abiertas y liberarlas (status → pending, agent_id → NULL)
	var openCount int64
	db.Model(&models.Conversation{}).
		Where("agent_id = ? AND status IN ('open','pending')", id).
		Count(&openCount)

	if openCount > 0 {
		db.Model(&models.Conversation{}).
			Where("agent_id = ? AND status IN ('open','pending')", id).
			Updates(map[string]any{"agent_id": nil, "status": "pending"})
	}

	if err := db.Delete(&models.User{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al eliminar el usuario"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":                "Usuario eliminado",
		"released_conversations": openCount,
	})
}

func ToggleCampaigns(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	var user models.User
	if err := db.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Usuario no encontrado"})
		return
	}
	user.CanSendCampaigns = !user.CanSendCampaigns
	db.Save(&user)
	c.JSON(http.StatusOK, gin.H{"data": toUserDTO(user)})
}

func ToggleAdvertising(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")
	var user models.User
	if err := db.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Usuario no encontrado"})
		return
	}
	user.CanAccessAdvertising = !user.CanAccessAdvertising
	db.Save(&user)
	c.JSON(http.StatusOK, gin.H{"data": toUserDTO(user)})
}
