package handlers

// system_settings.go — Configuración global del sistema (solo superadmin).
//
// Endpoints:
//   GET  /system-config            (público) — devuelve favicon_url y app_name
//   GET  /admin/system-settings    (superadmin) — todos los ajustes del sistema
//   PUT  /admin/system-settings    (superadmin) — actualiza app_name
//   POST /admin/system-settings/favicon (superadmin) — sube favicon

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"harmony-api/internal/database"

	"github.com/gin-gonic/gin"
)

type SystemSetting struct {
	ID        uint      `gorm:"primarykey"`
	Key       string    `gorm:"uniqueIndex"`
	Value     string    `gorm:"type:jsonb"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (SystemSetting) TableName() string { return "system_settings" }

func getSystemSettingValue(key string) string {
	db := database.SystemDB
	var s SystemSetting
	if err := db.Where("key = ?", key).First(&s).Error; err != nil {
		return ""
	}
	// value stored as JSON string: "\"path/here\""
	return strings.Trim(s.Value, `"`)
}

func setSystemSetting(key, value string) {
	db := database.SystemDB
	jsonVal := fmt.Sprintf("%q", value)
	db.Exec(`INSERT INTO system_settings (key, value, created_at, updated_at)
		VALUES (?, ?::jsonb, NOW(), NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		key, jsonVal)
}

// GetSystemConfig — GET /system-config (sin auth, llamado al arrancar el frontend)
func GetSystemConfig(c *gin.Context) {
	faviconPath := getSystemSettingValue("favicon_path")
	appName := getSystemSettingValue("app_name")
	if appName == "" {
		appName = "Harmony"
	}

	faviconURL := ""
	if faviconPath != "" {
		// MED-04: sanitizar path para prevenir path traversal; solo permitir uploads/system/
		cleaned := filepath.ToSlash(filepath.Clean(faviconPath))
		if strings.HasPrefix(cleaned, "uploads/") && !strings.Contains(cleaned, "..") {
			faviconURL = "/" + cleaned
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"app_name":    appName,
		"favicon_url": faviconURL,
	})
}

// GetSystemSettings — GET /admin/system-settings (superadmin)
func GetSystemSettings(c *gin.Context) {
	faviconPath := getSystemSettingValue("favicon_path")
	appName := getSystemSettingValue("app_name")
	if appName == "" {
		appName = "Harmony"
	}

	faviconURL := ""
	if faviconPath != "" {
		cleaned := filepath.ToSlash(filepath.Clean(faviconPath))
		if strings.HasPrefix(cleaned, "uploads/") && !strings.Contains(cleaned, "..") {
			faviconURL = "/" + cleaned
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"app_name":    appName,
		"favicon_url": faviconURL,
	})
}

// UpdateSystemSettings — PUT /admin/system-settings (superadmin)
func UpdateSystemSettings(c *gin.Context) {
	var req struct {
		AppName string `json:"app_name"`
	}
	c.ShouldBindJSON(&req)

	if req.AppName != "" {
		setSystemSetting("app_name", req.AppName)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Configuración guardada"})
}

// UploadSystemFavicon — POST /admin/system-settings/favicon (superadmin)
func UploadSystemFavicon(c *gin.Context) {
	file, err := c.FormFile("favicon")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "No se recibió el archivo"})
		return
	}

	// Validar extensión
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".png" && ext != ".ico" && ext != ".svg" && ext != ".jpg" && ext != ".jpeg" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Formato no permitido. Usa PNG, ICO, SVG o JPG"})
		return
	}

	dir := "uploads/system"
	if err := os.MkdirAll(dir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al crear directorio"})
		return
	}

	filename := fmt.Sprintf("favicon%s", ext)
	savePath := filepath.Join(dir, filename)

	// FIX: Para SVG, leer el contenido y verificar que no contenga scripts XSS
	// antes de guardarlo, ya que SVG puede incrustar JavaScript ejecutable.
	if ext == ".svg" {
		f, err := file.Open()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al procesar el archivo"})
			return
		}
		svgBytes, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al leer el archivo"})
			return
		}
		svgLower := strings.ToLower(string(svgBytes))
		// MED-01: lista extendida de patrones peligrosos; ToLower ya cubre variantes de capitalización.
		dangerousPatterns := []string{
			"<script", "javascript:", "vbscript:", "data:text/html",
			"onload=", "onerror=", "onclick=", "onmouseover=", "onfocus=", "onblur=",
			"oninput=", "onchange=", "onkeydown=", "onkeyup=", "onkeypress=", "onsubmit=",
			"onmouseenter=", "onmouseleave=", "onanimationstart=", "ontransitionend=",
			"eval(", "expression(",
			"xlink:href", // <use xlink:href> puede cargar SVG externos con scripts
			// B-01: vectores adicionales
			"<foreignobject", // permite incrustar HTML arbitrario dentro del SVG
			"href=",          // SVG2 <use href>/<a href> sin xlink:
			"<use", "<a ",    // elementos que referencian recursos externos
			"<set", "<animate", "attributename", // SMIL puede fijar atributos peligrosos
			"<handler", "<listener",
			"&#",         // HTML entities — posible evasión de filtros
			"%3c", "%3e", // URL-encoded < y >
		}
		for _, pattern := range dangerousPatterns {
			if strings.Contains(svgLower, pattern) {
				c.JSON(http.StatusBadRequest, gin.H{"message": "El archivo SVG contiene contenido no permitido"})
				return
			}
		}
	}

	if err := c.SaveUploadedFile(file, savePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Error al guardar el archivo"})
		return
	}

	storedPath := strings.ReplaceAll(savePath, "\\", "/")
	setSystemSetting("favicon_path", storedPath)

	c.JSON(http.StatusOK, gin.H{
		"message":     "Favicon actualizado",
		"favicon_url": "/" + storedPath,
	})
}
