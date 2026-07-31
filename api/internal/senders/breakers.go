package senders

import (
	"time"

	"harmony-api/internal/circuitbreaker"
)

var (
	whatsappBreaker  = circuitbreaker.New(5, 60*time.Second)
	messengerBreaker = circuitbreaker.New(5, 60*time.Second)
	instagramBreaker = circuitbreaker.New(5, 60*time.Second)
	telegramBreaker  = circuitbreaker.New(5, 60*time.Second)
	// metaCDNBreaker protege las descargas de adjuntos entrantes de Messenger/Instagram
	// (CDN pública de Meta), separado de messengerBreaker/instagramBreaker para que una
	// racha de fallos al descargar imágenes no abra el breaker de envío de mensajes.
	metaCDNBreaker = circuitbreaker.New(5, 60*time.Second)
)
