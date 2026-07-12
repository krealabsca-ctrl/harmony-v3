// Package models define las estructuras de datos principales de Harmony v3.
// Cada struct se mapea directamente a una tabla en la base de datos mediante GORM
// y representa un concepto central del dominio omnicanal de atención al cliente.
package models

import (
	"time"

	"gorm.io/gorm"
)

// UserRole representa el rol de un usuario dentro del sistema.
// El rol determina los permisos y las funcionalidades disponibles en la interfaz.
type UserRole string

const (
	// RoleSuperAdmin es el rol de administrador global de la plataforma Harmony.
	// Tiene acceso a todas las empresas y configuraciones del sistema.
	RoleSuperAdmin UserRole = "superadmin"

	// RoleAdmin es el administrador de una empresa específica.
	// Puede gestionar usuarios, canales, departamentos y configuraciones de su empresa.
	RoleAdmin UserRole = "admin"

	// RoleSupervisor supervisa agentes y conversaciones dentro de uno o más departamentos.
	// Puede ver todas las conversaciones de su departamento y reasignarlas.
	RoleSupervisor UserRole = "supervisor"

	// RoleAgent es el agente de atención al cliente.
	// Solo puede ver y gestionar las conversaciones asignadas a él.
	RoleAgent UserRole = "agent"

	// RoleMercadeo es el rol para el equipo de marketing.
	// Tiene acceso al módulo de campañas y publicidad, pero no a conversaciones individuales.
	RoleMercadeo UserRole = "mercadeo"
)

// User vive en la DB de empresa (harmony_c{id})
// User representa a un usuario interno de la plataforma Harmony: agente, supervisor,
// administrador o personal de mercadeo. Los usuarios pertenecen a una empresa y
// opcionalmente a un departamento. No confundir con Contact, que representa
// a los clientes externos que escriben por los canales.
type User struct {
	// ID es la clave primaria autoincremental generada por la base de datos.
	ID uint `gorm:"primarykey" json:"id"`

	// CompanyID identifica a qué empresa pertenece el usuario.
	// nil solo en el caso del SuperAdmin global, que no pertenece a ninguna empresa.
	CompanyID *uint `json:"company_id"`

	// DepartmentID es el departamento al que está asignado el usuario.
	// nil = usuario sin departamento (acceso a todos los departamentos de la empresa).
	DepartmentID *uint `json:"department_id"`

	// Name es el nombre completo del usuario visible en la interfaz y en las conversaciones.
	Name string `gorm:"not null" json:"name"`

	// Email es la dirección de correo electrónico del usuario, usada como identificador
	// de inicio de sesión. Tiene índice único: no puede haber dos usuarios con el mismo email.
	Email string `gorm:"uniqueIndex;not null" json:"email"`

	// Password es el hash de la contraseña del usuario (bcrypt).
	// Se omite del JSON de respuesta por seguridad (json:"-").
	Password string `json:"-"`

	// Role es el rol del usuario dentro del sistema: superadmin, admin, supervisor,
	// agent o mercadeo. El valor por defecto al crear es "agent".
	Role UserRole `gorm:"default:agent" json:"role"`

	// IsOnline indica si el usuario tiene una sesión activa en este momento.
	// true = conectado; false = desconectado. Se actualiza en tiempo real via WebSocket.
	IsOnline bool `gorm:"default:false" json:"is_online"`

	// LastSeenAt registra la última vez que el usuario estuvo activo en la plataforma.
	// nil = el usuario nunca ha iniciado sesión.
	LastSeenAt *time.Time `json:"last_seen_at"`

	// CanSendCampaigns indica si este usuario tiene permiso para crear y enviar
	// campañas masivas de mensajería. Requiere habilitación explícita por el administrador.
	CanSendCampaigns bool `gorm:"default:false" json:"can_send_campaigns"`

	// CanAccessAdvertising indica si este usuario puede acceder al módulo de publicidad.
	// Para supervisores, este campo determina el acceso (ver CanAccessAdvertisingModule).
	// Para admins y mercadeo, el acceso está implícito en el rol.
	CanAccessAdvertising bool `gorm:"default:false" json:"can_access_advertising"`

	// IsBot indica si este "usuario" es en realidad un bot o agente automatizado.
	// Los bots pueden tomar conversaciones y enviar respuestas automáticas.
	IsBot bool `gorm:"default:false" json:"is_bot"`

	// EmailVerifiedAt registra cuándo el usuario verificó su correo electrónico.
	// nil = el usuario aún no ha verificado su email.
	EmailVerifiedAt *time.Time `json:"email_verified_at"`

	// CreatedAt es la fecha/hora de creación del registro; la setea GORM automáticamente.
	CreatedAt time.Time `json:"created_at"`

	// UpdatedAt es la fecha/hora de la última modificación; la actualiza GORM automáticamente.
	UpdatedAt time.Time `json:"updated_at"`

	// DeletedAt es el timestamp de borrado suave (soft delete).
	// Cuando no es nulo, GORM excluye el registro de las consultas normales.
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// IsSuperAdmin retorna true si el usuario tiene el rol de superadministrador global.
func (u *User) IsSuperAdmin() bool { return u.Role == RoleSuperAdmin }

// IsAdmin retorna true si el usuario tiene el rol de administrador de empresa.
func (u *User) IsAdmin() bool { return u.Role == RoleAdmin }

// IsSupervisor retorna true si el usuario tiene el rol de supervisor de departamento.
func (u *User) IsSupervisor() bool { return u.Role == RoleSupervisor }

// IsAgent retorna true si el usuario tiene el rol de agente de atención al cliente.
func (u *User) IsAgent() bool { return u.Role == RoleAgent }

// IsMercadeo retorna true si el usuario tiene el rol de mercadeo/marketing.
func (u *User) IsMercadeo() bool { return u.Role == RoleMercadeo }

// CanAccessAdvertisingModule determina si el usuario puede acceder al módulo de publicidad,
// aplicando las siguientes reglas de negocio:
//   - SuperAdmin: NO tiene acceso (gestiona la plataforma, no las campañas).
//   - Admin y Mercadeo: SÍ tienen acceso siempre.
//   - Supervisor: tiene acceso solo si el campo CanAccessAdvertising fue habilitado
//     explícitamente por el administrador.
//   - Agent: NO tiene acceso.
func (u *User) CanAccessAdvertisingModule() bool {
	if u.IsSuperAdmin() {
		return false
	}
	if u.IsAdmin() || u.IsMercadeo() {
		return true
	}
	return u.IsSupervisor() && u.CanAccessAdvertising
}
