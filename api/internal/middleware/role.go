package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireRole bloquea el acceso si el rol del usuario no está en la lista permitida.
func RequireRole(roles ...string) gin.HandlerFunc {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(c *gin.Context) {
		roleVal, exists := c.Get("role")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "No autenticado"})
			return
		}
		roleStr, ok := roleVal.(string)
		if !ok || !allowed[roleStr] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"message": "Acceso denegado"})
			return
		}
		c.Next()
	}
}

// NotSuperAdmin bloquea el acceso a superadmins (para rutas de empresa).
func NotSuperAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if role, _ := c.Get("role"); role == "superadmin" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"message": "No disponible para superadmin"})
			return
		}
		c.Next()
	}
}
