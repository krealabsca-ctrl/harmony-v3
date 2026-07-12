package middleware

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type rateBucket struct {
	count    int
	windowAt time.Time
}

// A-07: se usa sync.Mutex (no RWMutex): toda llamada a allow() termina escribiendo
// (incrementa el contador o crea el bucket), así que la separación lectura/escritura
// del RWMutex no aportaba y abría una carrera check-then-act que permitía superar el
// límite con requests paralelos. La decisión y el incremento van bajo el mismo lock.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*rateBucket
	max     int
	window  time.Duration
	stop    chan struct{}
}

func newRateLimiter(max int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{
		buckets: make(map[string]*rateBucket),
		max:     max,
		window:  window,
		stop:    make(chan struct{}),
	}
	// FIX: usar time.NewTicker en lugar de time.Tick para evitar goroutine leak
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				rl.mu.Lock()
				cutoff := time.Now().Add(-window)
				for k, b := range rl.buckets {
					if b.windowAt.Before(cutoff) {
						delete(rl.buckets, k)
					}
				}
				rl.mu.Unlock()
			case <-rl.stop:
				return
			}
		}
	}()
	return rl
}

func (rl *rateLimiter) allow(key string) bool {
	now := time.Now()

	// A-07: verificación e incremento atómicos bajo un único lock.
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[key]
	if !ok || now.Sub(b.windowAt) >= rl.window {
		// Bucket nuevo o ventana expirada: reiniciar.
		rl.buckets[key] = &rateBucket{count: 1, windowAt: now}
		return true
	}
	if b.count >= rl.max {
		return false
	}
	b.count++
	return true
}

// ── Limiters ──────────────────────────────────────────────────────────────────

// loginLimiter permite 5 intentos por IP cada 15 minutos
var loginLimiter = newRateLimiter(5, 15*time.Minute)

// forgotPasswordLimiter permite 5 solicitudes por IP cada hora
var forgotPasswordLimiter = newRateLimiter(5, 1*time.Hour)

// detectCompanyLimiter permite 30 consultas por IP por minuto
var detectCompanyLimiter = newRateLimiter(30, 1*time.Minute)

// pubGenerateLimiter permite 10 generaciones por IP por minuto (fallback)
var pubGenerateLimiter = newRateLimiter(10, 1*time.Minute)

// pubGenerateLimiterUser permite 10 generaciones por usuario autenticado por minuto
// MED-06: endpoints autenticados deben limitarse por user_id, no solo por IP
var pubGenerateLimiterUser = newRateLimiter(10, 1*time.Minute)

// ── Middleware helpers ─────────────────────────────────────────────────────────

func rateLimitMiddleware(rl *rateLimiter, msg string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !rl.allow(c.ClientIP()) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"message": msg})
			return
		}
		c.Next()
	}
}

// LoginRateLimit bloquea IPs que excedan 5 intentos de login en 15 minutos.
func LoginRateLimit() gin.HandlerFunc {
	return rateLimitMiddleware(loginLimiter, "Demasiados intentos de inicio de sesión. Por favor espera 15 minutos.")
}

// ForgotPasswordRateLimit limita solicitudes de recuperación de contraseña a 5/hora por IP.
func ForgotPasswordRateLimit() gin.HandlerFunc {
	return rateLimitMiddleware(forgotPasswordLimiter, "Demasiadas solicitudes. Intenta de nuevo más tarde.")
}

// DetectCompanyRateLimit limita el autocompletado de empresa a 30 consultas/minuto por IP.
func DetectCompanyRateLimit() gin.HandlerFunc {
	return rateLimitMiddleware(detectCompanyLimiter, "Demasiadas consultas. Intenta de nuevo en un momento.")
}

// rateLimitByUserID limita por user_id para endpoints autenticados (más preciso que por IP).
func rateLimitByUserID(rl *rateLimiter, msg string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("user_id")
		var key string
		if userID == 0 {
			key = c.ClientIP() // fallback a IP si no hay user_id
		} else {
			key = fmt.Sprintf("uid:%d", userID)
		}
		if !rl.allow(key) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"message": msg})
			return
		}
		c.Next()
	}
}

// PubGenerateRateLimit limita la generación de contenido IA a 10 solicitudes/minuto por usuario.
func PubGenerateRateLimit() gin.HandlerFunc {
	return rateLimitByUserID(pubGenerateLimiterUser, "Demasiadas solicitudes de generación. Intenta de nuevo en un momento.")
}
