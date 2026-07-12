// Package models define las estructuras de datos principales de Harmony v3.
// Cada struct se mapea directamente a una tabla en la base de datos mediante GORM
// y representa un concepto central del dominio omnicanal de atención al cliente.
package models

import (
	"time"

	"gorm.io/gorm"
)

// ConversationStatus representa el estado del ciclo de vida de una conversación.
// Los valores válidos son los definidos en las constantes Conv*.
type ConversationStatus string

const (
	// ConvOpen indica que un agente está atendiendo activamente la conversación.
	ConvOpen ConversationStatus = "open"

	// ConvPending indica que la conversación llegó pero aún no tiene agente asignado;
	// aparece en la cola de espera del supervisor.
	ConvPending ConversationStatus = "pending"

	// ConvClosed indica que la conversación fue resuelta y cerrada.
	// Se puede reabrir si el contacto vuelve a escribir.
	ConvClosed ConversationStatus = "closed"
)

// Conversation representa un hilo de comunicación entre un contacto y la empresa
// a través de un canal específico (WhatsApp, Messenger, Instagram, Telegram, etc.).
// Es la entidad central del sistema: agrupa mensajes, tiene un agente asignado
// y rastrea el estado del servicio al cliente.
type Conversation struct {
	// ID es la clave primaria autoincremental generada por la base de datos.
	ID uint `gorm:"primarykey" json:"id"`

	// CompanyID identifica a qué empresa pertenece esta conversación.
	// Es obligatorio e indexado para filtrar eficientemente por tenant.
	CompanyID uint `gorm:"not null;index" json:"company_id"`

	// DepartmentID es opcional; indica a qué departamento (ej. Ventas, Soporte)
	// fue asignada la conversación. nil = sin departamento asignado.
	DepartmentID *uint `gorm:"index" json:"department_id"`

	// ChannelID referencia el canal (Channel) por el que llegó la conversación,
	// por ejemplo un número de WhatsApp Business o una página de Messenger.
	ChannelID uint `gorm:"index" json:"channel_id"`

	// ContactID referencia al contacto (Contact) que inició la conversación.
	ContactID uint `gorm:"index" json:"contact_id"`

	// AgentID es el usuario interno asignado para atender la conversación.
	// nil = sin agente asignado (estado pendiente en la cola).
	AgentID *uint `gorm:"index" json:"agent_id"`

	// CaseNumber es el número de caso único y visible para el usuario final,
	// por ejemplo "CASE-00042". Tiene índice único en la base de datos.
	CaseNumber string `gorm:"uniqueIndex" json:"case_number"`

	// Status indica el estado actual de la conversación: open, pending o closed.
	// El valor por defecto al crear es "pending".
	Status ConversationStatus `gorm:"default:pending" json:"status"`

	// LastMessageAt registra la fecha/hora del último mensaje enviado o recibido.
	// nil = la conversación fue creada pero no tiene mensajes aún.
	LastMessageAt *time.Time `json:"last_message_at"`

	// UnreadCount acumula los mensajes entrantes que el agente todavía no ha leído.
	// Se resetea a 0 cuando el agente abre la conversación.
	UnreadCount int `gorm:"default:0" json:"unread_count"`

	// WindowExpiresAt es el límite de la ventana de 24 horas de WhatsApp Business:
	// después de este momento solo se pueden enviar mensajes de plantilla (HSM).
	// nil = el contacto nunca ha escrito (ventana no iniciada).
	WindowExpiresAt *time.Time `json:"window_expires_at"`

	// CreatedAt es la fecha/hora en que se creó el registro; la setea GORM automáticamente.
	CreatedAt time.Time `json:"created_at"`

	// UpdatedAt es la fecha/hora de la última modificación; la actualiza GORM automáticamente.
	UpdatedAt time.Time `json:"updated_at"`

	// DeletedAt es el timestamp de borrado suave (soft delete).
	// Cuando no es nulo, GORM excluye el registro de las consultas normales.
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// Relaciones (precargadas)

	// Contact es el contacto que inició la conversación; se precarga con Preload("Contact").
	Contact *Contact `gorm:"foreignKey:ContactID" json:"contact,omitempty"`

	// Agent es el usuario interno asignado; se precarga con Preload("Agent").
	Agent *User `gorm:"foreignKey:AgentID" json:"agent,omitempty"`

	// Channel es el canal por el que llega la conversación; se precarga con Preload("Channel").
	Channel *Channel `gorm:"foreignKey:ChannelID" json:"channel,omitempty"`

	// Messages es la lista de mensajes de esta conversación; se precarga con Preload("Messages").
	Messages []Message `gorm:"foreignKey:ConversationID" json:"messages,omitempty"`

	// Tags son las etiquetas clasificatorias asignadas a la conversación;
	// se relacionan mediante la tabla pivote conversation_tags (many-to-many).
	Tags []Tag `gorm:"many2many:conversation_tags" json:"tags"`
}

// Contact representa a una persona o entidad externa que se comunica con la empresa
// a través de un canal. Puede tener múltiples conversaciones a lo largo del tiempo.
// El identificador externo (ExternalID) es el ID que provee la plataforma de mensajería
// (ej. el PSID de Facebook, el número de teléfono normalizado de WhatsApp).
type Contact struct {
	// ID es la clave primaria autoincremental.
	ID uint `gorm:"primarykey" json:"id"`

	// ChannelID indica a qué canal pertenece este contacto.
	// Un mismo número de teléfono puede tener un Contact distinto por canal.
	ChannelID uint `gorm:"not null;index" json:"channel_id"`

	// ExternalID es el identificador único del contacto dentro de la plataforma externa
	// (ej. WAID de WhatsApp, PSID de Messenger, user_id de Telegram).
	ExternalID string `json:"external_id"`

	// Name es el nombre visible del contacto, obtenido del perfil de la plataforma
	// o ingresado manualmente por un agente.
	Name string `json:"name"`

	// Phone es el número de teléfono del contacto, almacenado en formato E.164 cuando
	// aplica (principalmente para WhatsApp).
	Phone string `json:"phone"`

	// Email es el correo electrónico del contacto, si fue proporcionado o importado.
	Email string `json:"email"`

	// AvatarURL es la URL de la imagen de perfil del contacto obtenida de la plataforma.
	AvatarURL string `json:"avatar_url"`

	// Metadata almacena datos adicionales arbitrarios del contacto en formato JSON,
	// por ejemplo campos personalizados o datos importados de un CRM externo.
	Metadata map[string]any `gorm:"serializer:json" json:"metadata,omitempty"`

	// CreatedAt es la fecha/hora de creación del registro.
	CreatedAt time.Time `json:"created_at"`

	// UpdatedAt es la fecha/hora de la última actualización del registro.
	UpdatedAt time.Time `json:"updated_at"`
}

// Message representa un mensaje individual dentro de una conversación.
// Puede ser entrante (del contacto hacia la empresa) o saliente (de la empresa hacia el contacto).
// Soporta múltiples tipos: texto, imagen, audio, video, documento, sticker, etc.
type Message struct {
	// ID es la clave primaria autoincremental.
	ID uint `gorm:"primarykey" json:"id"`

	// ConversationID referencia la conversación a la que pertenece este mensaje.
	// Es obligatorio e indexado para recuperar mensajes por conversación eficientemente.
	ConversationID uint `gorm:"not null;index" json:"conversation_id"`

	// Body es el contenido textual del mensaje. Para mensajes de tipo multimedia
	// puede contener el caption o estar vacío.
	Body string `json:"body"`

	// Type indica el tipo de mensaje: "text", "image", "audio", "video",
	// "document", "sticker", "location", "template", etc.
	// El valor por defecto es "text".
	Type string `gorm:"default:text" json:"type"`

	// Direction indica si el mensaje es entrante o saliente.
	// Valores: "inbound" (del contacto a la empresa) | "outbound" (de la empresa al contacto).
	Direction string `json:"direction"` // inbound | outbound

	// Status indica el estado de entrega del mensaje.
	// Valores típicos: "sent", "delivered", "read", "failed".
	// El valor por defecto es "sent".
	Status string `gorm:"default:sent" json:"status"`

	// ExternalID es el ID del mensaje en la plataforma de mensajería (ej. el wamid de WhatsApp).
	// Se usa para reconciliar actualizaciones de estado (webhooks de entrega/lectura).
	ExternalID string `gorm:"index" json:"external_id"`

	// Meta almacena metadatos adicionales del mensaje en formato JSON, por ejemplo
	// coordenadas de ubicación, datos de plantilla HSM, contexto de respuesta, etc.
	Meta map[string]any `gorm:"serializer:json" json:"meta,omitempty"`

	// CreatedAt es la fecha/hora de creación del registro.
	CreatedAt time.Time `json:"created_at"`

	// UpdatedAt es la fecha/hora de la última actualización del registro.
	UpdatedAt time.Time `json:"updated_at"`

	// Attachments contiene los archivos adjuntos del mensaje (imágenes, documentos, etc.).
	// Se precargan con Preload("Attachments").
	Attachments []MessageAttachment `gorm:"foreignKey:MessageID" json:"attachments,omitempty"`
}

// MessageAttachment representa un archivo adjunto vinculado a un mensaje.
// Los archivos se almacenan en Azure Blob Storage y se referencia su ruta en la nube.
type MessageAttachment struct {
	// ID es la clave primaria autoincremental.
	ID uint `gorm:"primarykey" json:"id"`

	// MessageID referencia el mensaje al que pertenece este adjunto.
	// Es obligatorio e indexado.
	MessageID uint `gorm:"not null;index" json:"message_id"`

	// AzurePath es la ruta del archivo dentro del contenedor de Azure Blob Storage,
	// por ejemplo "attachments/2024/01/uuid-filename.jpg".
	AzurePath string `json:"azure_path"`

	// OriginalName es el nombre original del archivo tal como lo envió el contacto
	// o lo subió el agente, por ejemplo "factura_enero.pdf".
	OriginalName string `json:"original_name"`

	// MimeType es el tipo MIME del archivo, por ejemplo "image/jpeg", "application/pdf".
	// Se usa para renderizar correctamente el adjunto en la interfaz.
	MimeType string `json:"mime_type"`

	// Size es el tamaño del archivo en bytes.
	Size int64 `json:"size"`

	// CreatedAt es la fecha/hora en que se guardó el adjunto.
	CreatedAt time.Time `json:"created_at"`
}

// Tag representa una etiqueta de clasificación que puede asignarse a conversaciones.
// Las etiquetas pertenecen a un departamento y tienen un color para identificarlas
// visualmente en la interfaz (ej. "Urgente" en rojo, "VIP" en dorado).
type Tag struct {
	// ID es la clave primaria autoincremental.
	ID uint `gorm:"primarykey" json:"id"`

	// DepartmentID indica a qué departamento pertenece esta etiqueta.
	// Cada departamento gestiona su propio conjunto de etiquetas.
	DepartmentID uint `json:"department_id"`

	// Name es el nombre visible de la etiqueta, por ejemplo "Urgente", "VIP", "Seguimiento".
	Name string `json:"name"`

	// Color es el código de color hexadecimal de la etiqueta para la interfaz,
	// por ejemplo "#FF5733" para rojo o "#28A745" para verde.
	Color string `json:"color"`

	// CreatedAt es la fecha/hora de creación de la etiqueta.
	CreatedAt time.Time `json:"created_at"`
}
