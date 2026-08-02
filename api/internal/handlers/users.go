package handlers

import (
	"net/http"
	"strconv"
	"strings"
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
	IsActive             bool       `json:"is_active"`
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
		IsActive:             u.IsActive,
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

// validListRoles son los roles aceptados en el filtro de la lista de usuarios.
// No incluye "superadmin": los superadministradores no pertenecen a la base de una
// empresa (viven en la base del sistema), así que filtrar por ese rol acá siempre
// daría vacío -- por eso tampoco se ofrece en el desplegable de la pantalla.
var validListRoles = map[string]bool{
	"agent":      true,
	"supervisor": true,
	"admin":      true,
	"mercadeo":   true,
}

// ListUsers devuelve los usuarios de la empresa, con filtro por rol, búsqueda por
// nombre/correo y paginación.
//
// Antes esta función IGNORABA por completo los parámetros de la petición: el
// desplegable de rol y el buscador de la pantalla de Usuarios enviaban `role` y
// `search`, pero acá nunca se leían, así que la lista devolvía siempre lo mismo y
// los filtros parecían no hacer nada. `page` además estaba fijo en 1, de modo que
// paginar tampoco tenía efecto y la respuesta no incluía last_page, que es lo que
// la pantalla necesita para dibujar los controles.
func ListUsers(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	const perPage = 50

	q := db.Model(&models.User{})

	// Filtro por rol. Se valida contra la lista de roles conocidos para no permitir
	// que un valor arbitrario en la URL se cuele a la consulta.
	if role := strings.TrimSpace(c.Query("role")); role != "" {
		if !validListRoles[role] {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": "Rol no válido"})
			return
		}
		q = q.Where("role = ?", role)
	}

	// Búsqueda por nombre o correo, insensible a mayúsculas.
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + search + "%"
		q = q.Where("name ILIKE ? OR email ILIKE ?", like, like)
	}

	var total int64
	q.Count(&total)

	var users []models.User
	if err := q.Order("created_at DESC").Limit(perPage).Offset((page - 1) * perPage).
		Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al obtener usuarios"})
		return
	}
	dtos := make([]userDTO, len(users))
	for i, u := range users {
		dtos[i] = toUserDTO(u)
	}

	lastPage := int((total + perPage - 1) / perPage)
	if lastPage < 1 {
		lastPage = 1
	}
	c.JSON(http.StatusOK, gin.H{
		"data":         dtos,
		"total":        total,
		"per_page":     perPage,
		"current_page": page,
		"last_page":    lastPage,
	})
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
	// El rol solo se procesa si viene Y realmente cambia respecto al actual. El
	// frontend envía siempre el rol vigente al editar, así que comparar contra el
	// rol actual evita bloquear una edición normal (nombre, contraseña, etc.) de la
	// propia cuenta. La protección solo debe impedir CAMBIAR el rol propio.
	if req.Role != "" && req.Role != string(user.Role) {
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

// ToggleActive activa o desactiva un usuario. A diferencia de eliminarlo, esto NO
// destruye nada: conserva su historial y sus conversaciones, solo le impide entrar
// al sistema y deja de considerarlo para la autoasignación.
//
// Al desactivar se liberan sus conversaciones activas a la cola común (igual que al
// eliminar), para que no queden atrapadas en la bandeja de alguien que ya no entra.
// Las conversaciones cerradas NO se tocan: son su historial.
//
// Responde a: POST /admin/users/:id/toggle-active
func ToggleActive(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)
	id := c.Param("id")

	var user models.User
	if err := db.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Usuario no encontrado"})
		return
	}

	// Un admin no puede desactivarse a sí mismo: se quedaría fuera del sistema sin
	// nadie que pueda revertirlo desde su propia sesión.
	if actorID, ok := c.Get("user_id"); ok {
		if uid, isUint := actorID.(uint); isUint && uid == user.ID && user.IsActive {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"message": "No podés desactivar tu propia cuenta.",
			})
			return
		}
	}

	nuevoEstado := !user.IsActive
	var liberadas int64
	if !nuevoEstado {
		res := db.Model(&models.Conversation{}).
			Where("agent_id = ? AND status IN ('open','pending')", user.ID).
			Updates(map[string]any{"agent_id": nil, "status": "pending"})
		liberadas = res.RowsAffected
	}

	// Al desactivar también se marca desconectado: si tenía sesión abierta, deja de
	// figurar como disponible para el resto del equipo.
	updates := map[string]any{"is_active": nuevoEstado}
	if !nuevoEstado {
		updates["is_online"] = false
	}
	db.Model(&user).Updates(updates)
	user.IsActive = nuevoEstado
	if !nuevoEstado {
		user.IsOnline = false
	}

	c.JSON(http.StatusOK, gin.H{
		"data":                   toUserDTO(user),
		"released_conversations": liberadas,
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
