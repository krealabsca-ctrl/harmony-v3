package database

import (
	"fmt"
	"harmony-api/internal/config"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var SystemDB *gorm.DB

// ConnectSystem abre la conexión a harmony_system (la DB global con companies y system_settings)
func ConnectSystem() error {
	cfg := config.App
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s TimeZone=America/Costa_Rica",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPass, cfg.DBName, cfg.DBSSLMode,
	)
	// MED-10: en producción usar Silent para no loguear queries que pueden exponer credenciales
	logMode := logger.Warn
	if config.App.AppEnv == "production" {
		logMode = logger.Silent
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logMode),
	})
	if err != nil {
		return fmt.Errorf("system db: %w", err)
	}
	SystemDB = db

	// C-07: tabla de lookup público → empresa. Permite resolver el public_id de un
	// canal a (company_id, db_name) en O(1) sin escanear todas las empresas en cada
	// webhook (lo que agotaba el pool de conexiones). Se rellena de forma perezosa.
	db.Exec(`CREATE TABLE IF NOT EXISTS channel_lookup (
		public_id  TEXT PRIMARY KEY,
		company_id BIGINT NOT NULL,
		db_name    TEXT NOT NULL
	)`)

	// M-01: lookup email → empresa. Evita escanear todas las DBs de empresa en los
	// endpoints públicos (login, forgot/reset password, detect-company), lo que agotaba
	// el pool y servía de oráculo de enumeración. Se rellena de forma perezosa.
	db.Exec(`CREATE TABLE IF NOT EXISTS users_lookup (
		email      TEXT PRIMARY KEY,
		company_id BIGINT NOT NULL
	)`)

	// Ejecutar migraciones del sistema (idempotentes). Antes NO se corrían nunca, por lo
	// que columnas nuevas como companies.contact_email no existían en producción.
	if err := RunSystemMigrations(db); err != nil {
		return fmt.Errorf("system migrations: %w", err)
	}

	return nil
}
