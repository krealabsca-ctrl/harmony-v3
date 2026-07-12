// Package models define las estructuras de datos principales de Harmony v3.
// Cada struct se mapea directamente a una tabla en la base de datos mediante GORM
// y representa un concepto central del dominio omnicanal de atención al cliente.
package models

import (
	"time"

	"gorm.io/gorm"
)

// ChannelType representa el tipo de plataforma de mensajería de un canal.
// Determina qué proveedor de API se usa para enviar y recibir mensajes.
type ChannelType string

// ChannelStatus representa el estado operativo de un canal dentro del sistema.
type ChannelStatus string

const (
	// ChannelWhatsApp indica que el canal usa la API de WhatsApp Business (Cloud API o BSP).
	ChannelWhatsApp ChannelType = "whatsapp"

	// ChannelMessenger indica que el canal usa la API de Facebook Messenger.
	ChannelMessenger ChannelType = "messenger"

	// ChannelInstagram indica que el canal usa la API de mensajes directos de Instagram.
	ChannelInstagram ChannelType = "instagram"

	// ChannelTelegram indica que el canal usa la API de bots de Telegram.
	ChannelTelegram ChannelType = "telegram"
)

const (
	// StatusActive indica que el canal está habilitado y recibiendo/enviando mensajes.
	StatusActive ChannelStatus = "active"

	// StatusInactive indica que el canal fue deshabilitado manualmente por el administrador.
	StatusInactive ChannelStatus = "inactive"

	// StatusSuspended indica que el canal fue suspendido por el sistema, por ejemplo
	// por un error de credenciales, límite de API alcanzado o incumplimiento de políticas.
	StatusSuspended ChannelStatus = "suspended"
)

// Channel representa una conexión configurada a una plataforma de mensajería externa
// (WhatsApp, Messenger, Instagram, Telegram) para una empresa o departamento.
// Cada canal tiene sus propias credenciales de API, webhook y estado operativo.
// Las conversaciones entrantes se asocian siempre a un canal específico.
type Channel struct {
	// ID es la clave primaria autoincremental generada por la base de datos.
	ID uint `gorm:"primarykey" json:"id"`

	// PublicID es un UUID generado por la DB que se usa en las URLs de webhook.
	// Evita la enumeración de canales por ID entero secuencial desde endpoints públicos.
	PublicID string `gorm:"column:public_id;default:gen_random_uuid()" json:"public_id"`

	// CompanyID identifica a qué empresa pertenece este canal.
	// Es obligatorio e indexado para filtrar canales por tenant.
	CompanyID uint `gorm:"not null;index" json:"company_id"`

	// DepartmentID es opcional; indica a qué departamento está asignado el canal.
	// nil = canal disponible para toda la empresa (sin departamento específico).
	DepartmentID *uint `json:"department_id"`

	// Type indica la plataforma de mensajería del canal: whatsapp, messenger,
	// instagram o telegram. Determina qué lógica de integración se activa.
	Type ChannelType `gorm:"not null" json:"type"`

	// Name es el nombre amigable del canal visible en la interfaz,
	// por ejemplo "WhatsApp Ventas" o "Messenger Soporte".
	Name string `gorm:"not null" json:"name"`

	// Description es una descripción opcional del canal para uso interno
	// del equipo administrador.
	Description string `json:"description"`

	// Identifier es el identificador público del canal en la plataforma externa,
	// por ejemplo el número de teléfono E.164 para WhatsApp, el Page ID de Facebook,
	// o el username del bot de Telegram.
	Identifier string `json:"identifier"`

	// Credentials almacena las claves de API y tokens necesarios para autenticarse
	// con la plataforma de mensajería. C-06: cifrado en reposo con AES-256-GCM mediante
	// el serializer "encrypted"; se omite del JSON de respuesta (json:"-").
	Credentials map[string]any `gorm:"serializer:encrypted" json:"-"`

	// WebhookSecret es el token secreto usado para validar que los webhooks entrantes
	// provienen realmente de la plataforma y no de una fuente maliciosa.
	// C-06: cifrado en reposo; se omite del JSON de respuesta por seguridad.
	WebhookSecret string `gorm:"serializer:encrypted" json:"-"`

	// Status indica el estado operativo del canal: active, inactive o suspended.
	// El valor por defecto al crear es "active".
	Status ChannelStatus `gorm:"default:active" json:"status"`

	// IsActive es un booleano de conveniencia que refleja si el canal está habilitado.
	// true = canal activo y procesando mensajes; false = canal pausado.
	// El valor por defecto es true.
	IsActive bool `gorm:"default:true" json:"is_active"`

	// CreatedAt es la fecha/hora de creación del registro; la setea GORM automáticamente.
	CreatedAt time.Time `json:"created_at"`

	// UpdatedAt es la fecha/hora de la última modificación; la actualiza GORM automáticamente.
	UpdatedAt time.Time `json:"updated_at"`

	// DeletedAt es el timestamp de borrado suave (soft delete).
	// Cuando no es nulo, GORM excluye el registro de las consultas normales.
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
