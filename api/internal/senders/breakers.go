package senders

import "harmony-api/internal/circuitbreaker"

var (
	whatsappBreaker   = circuitbreaker.NewBreaker(5, 60)
	messengerBreaker  = circuitbreaker.NewBreaker(5, 60)
	instagramBreaker  = circuitbreaker.NewBreaker(5, 60)
	telegramBreaker   = circuitbreaker.NewBreaker(5, 60)
)
