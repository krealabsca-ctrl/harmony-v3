package models

import (
	"time"

	"gorm.io/gorm"
)

// Company vive en harmony_system y es el tenant raíz del sistema.
type Company struct {
	ID                 uint           `gorm:"primarykey" json:"id"`
	Name               string         `gorm:"not null" json:"name"`
	Slug               string         `gorm:"uniqueIndex;not null" json:"slug"`
	LogoPath           *string        `json:"logo_path"`
	PrimaryColor       string         `gorm:"default:#6366f1" json:"primary_color"`
	SecondaryColor     string         `gorm:"default:#8b5cf6" json:"secondary_color"`
	IsActive           bool           `gorm:"default:true" json:"is_active"`
	OmnichannelEnabled bool           `gorm:"default:true" json:"omnichannel_enabled"`
	AdvertisingEnabled bool           `gorm:"default:false" json:"advertising_enabled"`
	DBName             string         `json:"db_name,omitempty"` // harmony_c{id}
	Settings           map[string]any `gorm:"serializer:json" json:"settings,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	DeletedAt          gorm.DeletedAt `gorm:"index" json:"-"`
}

// SystemSetting vive en harmony_system para configuración global (SMTP, branding, Azure, etc.)
type SystemSetting struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	Key       string         `gorm:"uniqueIndex;not null" json:"key"`
	Value     map[string]any `gorm:"serializer:json" json:"value"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}
