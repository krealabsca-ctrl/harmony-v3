package config

import (
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port           string
	AppEnv         string
	AppKey         string
	DBHost         string
	DBPort         string
	DBUser         string
	DBPass         string
	DBName         string
	DBSSLMode      string
	RedisAddr      string
	RedisPassword  string
	JWTSecret      string
	JWTExpiryHours int
	FrontendURL    string
	TrustedProxies []string // A-08: IPs/redes del reverse proxy en las que confiar para X-Forwarded-For
	AzureAccount   string
	AzureKey       string
	AzureConnStr   string
	AnthropicKey   string
}

var App *Config

func Load() {
	_ = godotenv.Load()
	hours, _ := strconv.Atoi(getEnv("JWT_EXPIRY_HOURS", "24"))

	sslMode := getEnv("DB_SSLMODE", "require")
	appEnv := getEnv("APP_ENV", "development")
	// FIX CRIT-07: bloquear arranque si TLS está deshabilitado en producción
	if appEnv == "production" && sslMode == "disable" {
		log.Fatalf("FATAL: DB_SSLMODE=disable no está permitido en producción. Usa 'require' o 'verify-full'.")
	}

	frontendURL := getEnv("FRONTEND_URL", "http://localhost:3000")
	// M-09: en producción FRONTEND_URL debe estar definido y ser https. Con
	// AllowCredentials=true en CORS, un origen http mal configurado es riesgo de robo de cookie.
	if appEnv == "production" && !strings.HasPrefix(frontendURL, "https://") {
		log.Fatalf("FATAL: en producción FRONTEND_URL debe ser https:// (actual: %q).", frontendURL)
	}

	App = &Config{
		Port:           getEnv("PORT", "8080"),
		AppEnv:         appEnv,
		AppKey:         requireEnv("APP_KEY"),
		DBHost:         getEnv("DB_HOST", "localhost"),
		DBPort:         getEnv("DB_PORT", "5432"),
		DBUser:         getEnv("DB_USER", "harmony"),
		DBPass:         requireEnv("DB_PASS"),
		DBName:         getEnv("DB_NAME", "harmony_system"),
		DBSSLMode:      sslMode,
		RedisAddr:      getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:  getEnv("REDIS_PASSWORD", ""),
		JWTSecret:      requireEnvMin("JWT_SECRET", 32),
		JWTExpiryHours: hours,
		FrontendURL:    frontendURL,
		TrustedProxies: parseCSV(getEnv("TRUSTED_PROXIES", "")),
		AzureAccount:   getEnv("AZURE_STORAGE_ACCOUNT", ""),
		AzureKey:       getEnv("AZURE_STORAGE_KEY", ""),
		AzureConnStr:   getEnv("AZURE_STORAGE_CONNECTION_STRING", ""),
		AnthropicKey:   getEnv("ANTHROPIC_API_KEY", ""),
	}
}

// parseCSV divide una lista separada por comas en un slice, ignorando espacios y vacíos.
func parseCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("FATAL: variable de entorno %s no definida. El servidor no puede arrancar sin ella.", key)
	}
	return v
}

func requireEnvMin(key string, minLen int) string {
	v := requireEnv(key)
	if len(v) < minLen {
		log.Fatalf("FATAL: %s debe tener al menos %d caracteres (actual: %d).", key, minLen, len(v))
	}
	return v
}
