package senders

import (
	"time"

	"harmony-api/internal/circuitbreaker"
)

var (
	whatsappBreaker   = circuitbreaker.New(5, 60*time.Second)
	messengerBreaker  = circuitbreaker.New(5, 60*time.Second)
	instagramBreaker  = circuitbreaker.New(5, 60*time.Second)
	telegramBreaker   = circuitbreaker.New(5, 60*time.Second)
)
