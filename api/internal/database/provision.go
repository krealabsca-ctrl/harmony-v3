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

// RunSystemMigrations ejecuta los archivos SQL en migrations/system/ en orden numérico
// sobre la base de datos del sistema (harmony_system). Se llama al arrancar. Todas las
// migraciones del sistema deben ser idempotentes (IF NOT EXISTS) porque corren en cada
// arranque sin tabla de control de versiones.
func RunSystemMigrations(db *gorm.DB) error {
	entries, err := fs.ReadDir(systemMigrations, "migrations/system")
	if err != nil {
		return nil
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".sql" {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		data, err := systemMigrations.ReadFile("migrations/system/" + name)
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		if err := db.Exec(string(data)).Error; err != nil {
			return fmt.Errorf("exec %s: %w", name, err)
		}
	}
	return nil
}

// MigrateExistingCompanies aplica las migraciones de empresa PENDIENTES sobre todas las
// empresas ya provisionadas (control de versiones vía schema_migrations, ver
// runCompanyMigrations). Antes las migraciones solo corrían al crear la empresa, así que las
// columnas nuevas nunca llegaban a las empresas existentes. Se llama al arrancar y es
// NO-fatal por empresa: si una falla, se registra y se continúa con las demás.
func MigrateExistingCompanies() {
	var companies []struct {
		ID     uint
		DBName string
	}
	SystemDB.Table("companies").
		Select("id, db_name").
		Where("db_name <> '' AND deleted_at IS NULL").
		Scan(&companies)

	for _, co := range companies {
		db, err := GetCompanyDB(co.ID, co.DBName)
		if err != nil {
			fmt.Printf("⚠ migraciones empresa %d: no se pudo conectar: %v\n", co.ID, err)
			continue
		}
		if err := runCompanyMigrations(db); err != nil {
			fmt.Printf("⚠ migraciones empresa %d (%s): %v\n", co.ID, co.DBName, err)
		}
	}
	fmt.Printf("✓ Migraciones de empresa revisadas en %d empresa(s)\n", len(companies))
}

// companyMigrationBaseline marca la última migración que existía ANTES de introducir el
// control de versiones (schema_migrations). En bases ya provisionadas, todas las migraciones
// hasta este baseline se dan por aplicadas SIN re-ejecutarlas — esto evita re-correr
// migraciones destructivas (p.ej. 010 hace DROP TABLE pub_brand_kit, que borraría datos).
const companyMigrationBaseline = "013_security_indexes.sql"

// runCompanyMigrations ejecuta las migraciones de migrations/company/ que aún no se han
// aplicado, registrándolas en schema_migrations para no repetirlas. Idempotente y seguro de
// llamar en cada arranque (ver MigrateExistingCompanies).
func runCompanyMigrations(db *gorm.DB) error {
	entries, err := fs.ReadDir(companyMigrations, "migrations/company")
	if err != nil {
		return nil // Si el directorio no existe todavía, no es error
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".sql" {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	// Tabla de control de versiones (una por DB de empresa).
	db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ DEFAULT NOW()
	)`)

	applied := map[string]bool{}
	var rows []string
	db.Raw(`SELECT version FROM schema_migrations`).Scan(&rows)
	for _, v := range rows {
		applied[v] = true
	}

	// Backfill único: si no hay nada registrado pero la DB ya estaba provisionada (existe
	// la tabla users), marcamos como aplicadas las migraciones hasta el baseline sin correrlas.
	firstTime := len(rows) == 0
	preexisting := false
	if firstTime {
		db.Raw(`SELECT EXISTS(SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'users')`).Scan(&preexisting)
	}

	for _, name := range names {
		if applied[name] {
			continue
		}
		if firstTime && preexisting && name <= companyMigrationBaseline {
			db.Exec(`INSERT INTO schema_migrations (version) VALUES (?) ON CONFLICT DO NOTHING`, name)
			continue
		}
		data, err := companyMigrations.ReadFile("migrations/company/" + name)
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		if err := db.Exec(string(data)).Error; err != nil {
			return fmt.Errorf("exec %s: %w", name, err)
		}
		db.Exec(`INSERT INTO schema_migrations (version) VALUES (?) ON CONFLICT DO NOTHING`, name)
	}
	return nil
}
