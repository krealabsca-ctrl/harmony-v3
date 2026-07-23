package services

// recaptcha.go — Verificación de tokens de Google reCAPTCHA v3.
//
// reCAPTCHA v3 no muestra checkbox: el frontend ejecuta grecaptcha.execute() y obtiene un
// token; el backend lo valida contra Google, que devuelve un "score" (0.0 = bot, 1.0 =
// humano). Si la secret no está configurada, la verificación se desactiva (retorna true)
// para no bloquear entornos sin reCAPTCHA.

import (
	"net/http"
	"net/url"
	"time"

	"encoding/json"

	"harmony-api/internal/config"
)

// recaptchaMinScore es el umbral por debajo del cual se considera bot.
const recaptchaMinScore = 0.5

var recaptchaClient = &http.Client{Timeout: 5 * time.Second}

type recaptchaVerifyResponse struct {
	Success     bool     `json:"success"`
	Score       float64  `json:"score"`
	Action      string   `json:"action"`
	Hostname    string   `json:"hostname"`
	ErrorCodes  []string `json:"error-codes"`
	ChallengeTS string   `json:"challenge_ts"`
}

// VerifyRecaptcha valida un token de reCAPTCHA v3. Devuelve true si la verificación pasa
// (o si reCAPTCHA está desactivado por no tener secret configurada).
func VerifyRecaptcha(token, remoteIP string) bool {
	secret := config.App.RecaptchaSecret
	if secret == "" {
		return true // reCAPTCHA desactivado
	}
	if token == "" {
		return false
	}

	form := url.Values{}
	form.Set("secret", secret)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}

	resp, err := recaptchaClient.PostForm("https://www.google.com/recaptcha/api/siteverify", form)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	var out recaptchaVerifyResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return false
	}
	return out.Success && out.Score >= recaptchaMinScore
}
