package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"harmony-api/internal/config"
	"harmony-api/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// ServeUpload sirve archivos adjuntos validando que el JWT sea válido y que
// el archivo pertenezca a la empresa del usuario autenticado.
// Reemplaza r.Static("/uploads", "./uploads") que era accesible sin autenticación.
//
// Acepta el token via header Authorization: Bearer <token> o query param ?token=
// para permitir que <img src="/uploads/...?token=..."> funcione en el frontend.
func ServeUpload(c *gin.Context) {
	// M-03/M-09: preferir la cookie httpOnly (enviada automáticamente por el navegador
	// en <img src>), luego el header Bearer, y solo como último recurso el ?token= en la
	// URL. Esto permite que el frontend cargue adjuntos sin exponer el JWT en el DOM.
	tokenStr := ""
	if ck, err := c.Cookie("harmony_token"); err == nil && ck != "" {
		tokenStr = ck
	} else if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
		tokenStr = strings.TrimPrefix(h, "Bearer ")
	} else {
		tokenStr = c.Query("token")
	}
	if tokenStr == "" {
		c.Status(http.StatusUnauthorized)
		return
	}

	claims := &middleware.Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		// A-02: validar explícitamente el algoritmo HMAC (consistente con middleware/auth.go
		// y ws/hub.go) para cerrar la confusión de algoritmo.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("algoritmo de firma inesperado: %v", t.Header["alg"])
		}
		return []byte(config.App.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		c.Status(http.StatusUnauthorized)
		return
	}

	// A-02: el wildcard :filepath de Gin incluye la barra inicial (ej. "/company_5/..").
	// Se elimina antes de Clean para que la verificación de prefijo por empresa funcione.
	rawPath := strings.TrimPrefix(c.Param("filepath"), "/")
	cleanPath := filepath.Clean(rawPath)

	// Prevenir path traversal y rutas absolutas.
	if cleanPath == "." || strings.HasPrefix(cleanPath, "..") ||
		strings.Contains(cleanPath, ".."+string(filepath.Separator)) || filepath.IsAbs(cleanPath) {
		c.Status(http.StatusBadRequest)
		return
	}

	// Verificar que el archivo pertenece a la empresa del token.
	// Superadmin (company_id == 0) puede acceder a cualquier archivo.
	if claims.CompanyID != 0 {
		expectedPrefix := fmt.Sprintf("company_%d%c", claims.CompanyID, filepath.Separator)
		if !strings.HasPrefix(cleanPath, expectedPrefix) {
			c.Status(http.StatusForbidden)
			return
		}
	}

	fullPath := filepath.Join("uploads", cleanPath)
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		c.Status(http.StatusNotFound)
		return
	}

	c.File(fullPath)
}
