package database

import (
	"embed"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"time"

	"harmony-api/internal/config"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

//go:embed migrations/company/*.sql
var companyMigrations embed.FS

//go:embed migrations/system/*.sql
var systemMigrations embed.FS

// ProvisionCompanyDB crea la base de datos para una empresa nueva y ejecuta todas las migraciones.
// Se llama automáticamente al crear una empresa en CompaniesHandler.
func ProvisionCompanyDB(companyID uint) (string, error) {
	dbName := fmt.Sprintf("harmony_c%d", companyID)

	// Crear la base de datos usando la conexión del sistema (sin especificar dbname)
	cfg := config.App
	rootDSN := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=postgres sslmode=%s",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPass, cfg.DBSSLMode,
	)
	rootDB, err := gorm.Open(postgres.Open(rootDSN), &gorm.Config{})
	if err != nil {
		return "", fmt.Errorf("connect root: %w", err)
	}
	sqlDB, _ := rootDB.DB()
	defer sqlDB.Close()

	// CREATE DATABASE (seguro: si ya existe lo ignoramos)
	rootDB.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, dbName))

	// Conectar a la nueva DB y correr migraciones
	companyDB, err := openCompanyConn(dbName)
	if err != nil {
		return "", fmt.Errorf("connect company db: %w", err)
	}

	if err := runCompanyMigrations(companyDB); err != nil {
		return "", fmt.Errorf("run migrations: %w", err)
	}

	// Cachear la conexión (C-08: el pool almacena *poolEntry y lleva la cuenta poolSize).
	entry := &poolEntry{db: companyDB}
	entry.lastUsed.Store(time.Now().UnixNano())
	if _, loaded := pool.LoadOrStore(companyID, entry); !loaded {
		poolSize.Add(1)
	}

	return dbName, nil
}

// runCompanyMigrations ejecuta los archivos SQL en migrations/company/ en orden numérico
func runCompanyMigrations(db *gorm.DB) error {
	entries, err := fs.ReadDir(companyMigrations, "migrations/company")
	if err != nil {
		// Si el directorio no existe todavía, no es error
		return nil
	}

	// Ordenar por nombre para garantizar el orden correcto (001_, 002_, etc.)
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".sql" {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		data, err := companyMigrations.ReadFile("migrations/company/" + name)
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		if err := db.Exec(string(data)).Error; err != nil {
			return fmt.Errorf("exec %s: %w", name, err)
		}
	}
	return nil
}
