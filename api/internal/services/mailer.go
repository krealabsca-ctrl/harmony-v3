package services

import (
	"crypto/tls"
	"fmt"
	"net/smtp"
	"strings"

	"harmony-api/internal/database"
	"harmony-api/internal/models"
)

type SMTPConfig struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	Pass       string `json:"pass"`
	FromName   string `json:"from_name"`
	FromEmail  string `json:"from_email"`
	Encryption string `json:"encryption"` // "none", "tls" (465), "starttls" (587)
}

// Send envía un correo usando la configuración SMTP del sistema.
func Send(to, subject, htmlBody string) error {
	var setting models.SystemSetting
	if err := database.SystemDB.Where("key = ?", "smtp").First(&setting).Error; err != nil {
		return fmt.Errorf("SMTP no configurado: %w", err)
	}

	cfg := SMTPConfig{
		Host:       "localhost",
		Port:       587,
		Encryption: "starttls",
	}
	if setting.Value != nil {
		if h, ok := setting.Value["host"].(string); ok {
			cfg.Host = h
		}
		if p, ok := setting.Value["port"].(float64); ok {
			cfg.Port = int(p)
		}
		if u, ok := setting.Value["user"].(string); ok {
			cfg.User = u
		}
		if pass, ok := setting.Value["pass"].(string); ok {
			cfg.Pass = pass
		}
		if fn, ok := setting.Value["from_name"].(string); ok {
			cfg.FromName = fn
		}
		if fe, ok := setting.Value["from_email"].(string); ok {
			cfg.FromEmail = fe
		}
		if enc, ok := setting.Value["encryption"].(string); ok {
			cfg.Encryption = enc
		}
	}

	if cfg.FromEmail == "" {
		cfg.FromEmail = cfg.User
	}

	from := cfg.FromEmail
	if cfg.FromName != "" {
		from = fmt.Sprintf("%s <%s>", cfg.FromName, cfg.FromEmail)
	}

	msg := fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s",
		from, to, subject, htmlBody,
	)

	switch strings.ToLower(cfg.Encryption) {
	case "tls":
		return sendTLS(cfg, to, []byte(msg))
	case "starttls", "":
		return sendSTARTTLS(cfg, to, []byte(msg))
	case "none":
		return sendPlain(cfg, to, []byte(msg))
	default:
		return sendSTARTTLS(cfg, to, []byte(msg))
	}
}

func sendPlain(cfg SMTPConfig, to string, msg []byte) error {
	auth := smtp.PlainAuth("", cfg.User, cfg.Pass, cfg.Host)
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	return smtp.SendMail(addr, auth, cfg.FromEmail, []string{to}, msg)
}

func sendSTARTTLS(cfg SMTPConfig, to string, msg []byte) error {
	auth := smtp.PlainAuth("", cfg.User, cfg.Pass, cfg.Host)
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	client, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("dial SMTP: %w", err)
	}
	defer client.Close()

	if err = client.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
		return fmt.Errorf("STARTTLS: %w", err)
	}

	if err = client.Auth(auth); err != nil {
		return fmt.Errorf("auth: %w", err)
	}

	if err = client.Mail(cfg.FromEmail); err != nil {
		return fmt.Errorf("mail from: %w", err)
	}

	if err = client.Rcpt(to); err != nil {
		return fmt.Errorf("rcpt to: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}

	if _, err = w.Write(msg); err != nil {
		return fmt.Errorf("write msg: %w", err)
	}

	if err = w.Close(); err != nil {
		return fmt.Errorf("close writer: %w", err)
	}

	return client.Quit()
}

func sendTLS(cfg SMTPConfig, to string, msg []byte) error {
	tlsConfig := &tls.Config{ServerName: cfg.Host}
	conn, err := tls.Dial("tcp", fmt.Sprintf("%s:%d", cfg.Host, cfg.Port), tlsConfig)
	if err != nil {
		return fmt.Errorf("TLS dial: %w", err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		return fmt.Errorf("new client: %w", err)
	}
	defer client.Close()

	auth := smtp.PlainAuth("", cfg.User, cfg.Pass, cfg.Host)
	if err = client.Auth(auth); err != nil {
		return fmt.Errorf("auth: %w", err)
	}

	if err = client.Mail(cfg.FromEmail); err != nil {
		return fmt.Errorf("mail from: %w", err)
	}

	if err = client.Rcpt(to); err != nil {
		return fmt.Errorf("rcpt to: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}

	if _, err = w.Write(msg); err != nil {
		return fmt.Errorf("write msg: %w", err)
	}

	if err = w.Close(); err != nil {
		return fmt.Errorf("close writer: %w", err)
	}

	return client.Quit()
}
