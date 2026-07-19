package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"harmony-api/internal/config"
	"harmony-api/internal/crypto"
	"harmony-api/internal/database"
	"harmony-api/internal/jobs"
	"harmony-api/internal/router"
	"harmony-api/internal/ws"
)

func main() {
	// Cargar configuración desde .env
	config.Load()

	// C-06: registrar el serializer de cifrado en reposo antes de cualquier operación GORM.
	crypto.Register()

	// Conectar a la base de datos del sistema
	if err := database.ConnectSystem(); err != nil {
		log.Fatalf("No se pudo conectar a harmony_system: %v", err)
	}
	log.Println("✓ Conectado a harmony_system")

	// Poner al día el esquema de las empresas ya provisionadas (no-fatal por empresa).
	// En segundo plano para no retrasar el arranque del servidor.
	go database.MigrateExistingCompanies()

	// Iniciar el hub de WebSockets en goroutine
	go ws.GlobalHub.Run()
	log.Println("✓ WebSocket Hub iniciado")

	// Iniciar el job de retención de historial
	go jobs.Run()
	log.Println("✓ Job de retención de historial iniciado")

	// Configurar rutas Gin
	r := router.Setup()

	addr := ":" + config.App.Port
	srv := &http.Server{
		Addr:    addr,
		Handler: r,
	}

	// FIX: Graceful shutdown — esperar requests en vuelo antes de salir (HIGH-09)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("✓ Servidor corriendo en http://localhost%s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Error al iniciar servidor: %v", err)
		}
	}()

	<-quit
	log.Println("→ Señal recibida, iniciando graceful shutdown...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("WARN: Shutdown forzado: %v", err)
	}

	// M-29: tras drenar las requests HTTP, cerrar las conexiones WebSocket y todas las
	// conexiones a PostgreSQL (pool de empresas + system DB) de forma limpia.
	ws.GlobalHub.Shutdown()
	database.CloseAll()

	log.Println("✓ Servidor detenido correctamente")
}
