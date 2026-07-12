package database

import (
	"fmt"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"harmony-api/internal/config"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// poolEntry envuelve una conexión de empresa junto con su marca de último uso,
// necesaria para la política de eviction LRU (C-08).
type poolEntry struct {
	db       *gorm.DB
	lastUsed atomic.Int64 // unix nano del último acceso
}

// pool guarda conexiones abiertas por company_id para reutilizarlas
var pool sync.Map // map[uint]*poolEntry

// poolSize lleva cuenta del número de empresas con conexión activa en el pool.
var poolSize atomic.Int32

// maxPoolConnections limita cuántas empresas pueden tener conexión activa simultánea.
// HIGH-10: previene que el pool crezca ilimitado bajo carga de muchos tenants.
const maxPoolConnections = 100

// GetCompanyDB retorna (o abre) la conexión a la DB de una empresa específica.
// La conexión se cachea en memoria para no abrir una nueva en cada request.
//
// C-08: el cupo del pool se reserva atómicamente con CAS antes de abrir la conexión,
// y si el pool está lleno se evicta la empresa menos usada recientemente (LRU) en
// vez de rechazar para siempre a las empresas nuevas (lo que impedía todo login).
func GetCompanyDB(companyID uint, dbName string) (*gorm.DB, error) {
	if v, ok := pool.Load(companyID); ok {
		e := v.(*poolEntry)
		e.lastUsed.Store(time.Now().UnixNano())
		return e.db, nil
	}

	// Reservar cupo antes de abrir; evictar el LRU si estamos al límite.
	for {
		cur := poolSize.Load()
		if cur >= maxPoolConnections {
			if !evictLRU() {
				return nil, fmt.Errorf("pool de conexiones al límite: %d empresas activas", maxPoolConnections)
			}
			continue
		}
		if poolSize.CompareAndSwap(cur, cur+1) {
			break
		}
	}

	db, err := openCompanyConn(dbName)
	if err != nil {
		poolSize.Add(-1) // devolver el cupo reservado si falla la apertura
		return nil, err
	}
	// Ejecutar migraciones al conectar por primera vez: todas usan IF NOT EXISTS,
	// por lo que es seguro correrlas en DBs ya existentes (idempotente).
	if err := runCompanyMigrations(db); err != nil {
		// HIGH-13: no incluir dbName ni err en el log — podrían contener datos del usuario
		log.Printf("WARN: migraciones fallidas para company %d", companyID)
	}
	entry := &poolEntry{db: db}
	entry.lastUsed.Store(time.Now().UnixNano())
	actual, loaded := pool.LoadOrStore(companyID, entry)
	if loaded {
		// Otro goroutine ganó la carrera — devolver el cupo y cerrar nuestra conexión.
		poolSize.Add(-1)
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
		ae := actual.(*poolEntry)
		ae.lastUsed.Store(time.Now().UnixNano())
		return ae.db, nil
	}
	return db, nil
}

// evictLRU cierra y elimina del pool la conexión menos usada recientemente.
// Devuelve true si logró evictar una entrada (liberando su cupo). El cierre real
// del socket se difiere 30s para no cortar requests en vuelo (A-04).
func evictLRU() bool {
	var lruKey any
	var lruEntry *poolEntry
	oldest := int64(math.MaxInt64)
	pool.Range(func(k, v any) bool {
		e := v.(*poolEntry)
		if t := e.lastUsed.Load(); t < oldest {
			oldest, lruKey, lruEntry = t, k, e
		}
		return true
	})
	if lruKey == nil {
		return false
	}
	if _, loaded := pool.LoadAndDelete(lruKey); loaded {
		poolSize.Add(-1)
		if sqlDB, err := lruEntry.db.DB(); err == nil {
			go func() {
				time.Sleep(30 * time.Second)
				sqlDB.Close()
			}()
		}
		return true
	}
	return false
}

// openCompanyConn abre una nueva conexión a una DB de empresa con pool configurado.
func openCompanyConn(dbName string) (*gorm.DB, error) {
	cfg := config.App
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s TimeZone=America/Costa_Rica",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPass, dbName, cfg.DBSSLMode,
	)
	// MED-10: en producción usar Silent para no loguear queries con posibles credenciales
	logMode := logger.Warn
	if config.App.AppEnv == "production" {
		logMode = logger.Silent
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logMode),
	})
	if err != nil {
		return nil, err
	}

	// FIX: Configurar límites del pool para evitar agotamiento de conexiones
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(3)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	// FIX: reducir lifetime para acelerar invalidación de credenciales en caso de incidente (MED-11)
	sqlDB.SetConnMaxLifetime(10 * time.Minute)

	return db, nil
}

// InvalidatePool elimina la conexión cacheada (útil al actualizar credenciales).
// A-04: cierra la conexión eliminada (con gracia de 30s) para no dejar conexiones
// huérfanas consumiendo slots de max_connections en PostgreSQL.
func InvalidatePool(companyID uint) {
	if v, loaded := pool.LoadAndDelete(companyID); loaded {
		poolSize.Add(-1)
		if sqlDB, err := v.(*poolEntry).db.DB(); err == nil {
			go func() {
				time.Sleep(30 * time.Second)
				sqlDB.Close()
			}()
		}
	}
}

// CloseAll cierra todas las conexiones (pool de empresas + system DB). Se llama en
// el graceful shutdown (M-29) tras drenar las requests HTTP.
func CloseAll() {
	pool.Range(func(k, v any) bool {
		if sqlDB, err := v.(*poolEntry).db.DB(); err == nil {
			sqlDB.Close()
		}
		pool.Delete(k)
		return true
	})
	poolSize.Store(0)
	if SystemDB != nil {
		if sqlDB, err := SystemDB.DB(); err == nil {
			sqlDB.Close()
		}
	}
}
