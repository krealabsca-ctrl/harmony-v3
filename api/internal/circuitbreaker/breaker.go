// Package circuitbreaker implementa un circuit breaker simple de tres estados
// (CLOSED → OPEN → HALF-OPEN) para proteger llamadas a APIs externas.
//
// Cuando el número de fallos consecutivos alcanza maxFailures el breaker se ABRE
// y rechaza todas las llamadas durante timeout. Pasado ese tiempo entra en
// HALF-OPEN y permite una llamada de prueba; si tiene éxito vuelve a CLOSED,
// si falla vuelve a OPEN.
package circuitbreaker

import (
	"errors"
	"sync"
	"time"
)

// ErrOpen se devuelve cuando el circuit breaker está abierto y rechaza la llamada.
var ErrOpen = errors.New("circuit breaker: servicio temporalmente no disponible")

type state int

const (
	stateClosed   state = iota
	stateOpen
	stateHalfOpen
)

// Breaker es un circuit breaker thread-safe.
type Breaker struct {
	mu           sync.Mutex
	failures     int
	maxFailures  int
	timeout      time.Duration
	lastFailedAt time.Time
	st           state
	probing      bool // C-04: true mientras una sonda HALF-OPEN está en vuelo
}

// New crea un Breaker que se abre tras maxFailures fallos consecutivos y permanece
// abierto durante timeout antes de pasar a HALF-OPEN.
func New(maxFailures int, timeout time.Duration) *Breaker {
	return &Breaker{
		maxFailures: maxFailures,
		timeout:     timeout,
	}
}

// Call ejecuta fn respetando el estado del breaker.
// Devuelve ErrOpen si el breaker está abierto y el timeout no ha expirado.
//
// C-04: en HALF-OPEN solo se permite UNA sonda concurrente. Los demás goroutines
// reciben ErrOpen hasta que la sonda decida si el servicio se recuperó, evitando
// el thundering herd contra un servicio caído.
func (b *Breaker) Call(fn func() error) error {
	b.mu.Lock()
	switch b.st {
	case stateOpen:
		if time.Since(b.lastFailedAt) > b.timeout {
			b.st = stateHalfOpen
			b.probing = true // este goroutine es la sonda
		} else {
			b.mu.Unlock()
			return ErrOpen
		}
	case stateHalfOpen:
		if b.probing {
			b.mu.Unlock()
			return ErrOpen // ya hay una sonda en vuelo
		}
		b.probing = true
	}
	// En stateClosed no marcamos probing (llamadas normales ilimitadas).
	half := b.st == stateHalfOpen
	b.mu.Unlock()

	err := fn()

	b.mu.Lock()
	defer b.mu.Unlock()
	if half {
		b.probing = false
	}
	if err != nil {
		b.failures++
		b.lastFailedAt = time.Now()
		// Una sonda HALF-OPEN fallida reabre de inmediato; en CLOSED se abre al
		// alcanzar maxFailures.
		if half || b.failures >= b.maxFailures {
			b.st = stateOpen
		}
		return err
	}
	b.failures = 0
	b.st = stateClosed
	return nil
}

// IsOpen reporta si el breaker está actualmente abierto (rechazando llamadas).
func (b *Breaker) IsOpen() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.st == stateOpen && time.Since(b.lastFailedAt) <= b.timeout
}
