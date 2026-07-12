package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"harmony-api/internal/config"
	"harmony-api/internal/database"
	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID    uint            `json:"user_id"`
	CompanyID uint            `json:"company_id"`
	Role      models.UserRole `json:"role"`
	DBName    string          `json:"db_name"`
	jwt.RegisteredClaims
}

// AuthRequired valida el JWT y carga el user en el contexto Gin.
// CRIT-06: acepta token desde header Authorization o desde cookie httpOnly harmony_token.
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr := ""
		if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			tokenStr = strings.TrimPrefix(auth, "Bearer ")
		} else if cookie, err := c.Cookie("harmony_token"); err == nil && cookie != "" {
			tokenStr = cookie
		}
		if tokenStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "Token requerido"})
			return
		}
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
			// FIX: Verificar explícitamente el algoritmo para evitar ataques de confusión alg:none
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("algoritmo de firma inesperado: %v", t.Header["alg"])
			}
			return []byte(config.App.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "Token inválido"})
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("company_id", claims.CompanyID)
		c.Set("role", string(claims.Role))
		c.Set("db_name", claims.DBName)
		c.Next()
	}
}

// CompanyDB inyecta la conexión a la DB de la empresa del usuario autenticado.
func CompanyDB() gin.HandlerFunc {
	return func(c *gin.Context) {
		companyID, _ := c.Get("company_id")
		dbName, _ := c.Get("db_name")
		if companyID == nil || dbName == nil {
			c.Next()
			return
		}
		db, err := database.GetCompanyDB(companyID.(uint), dbName.(string))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"message": "Error de base de datos"})
			return
		}
		c.Set("db", db)
		c.Next()
	}
}
