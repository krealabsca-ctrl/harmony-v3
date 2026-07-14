-- Migración 002: Datos de encargado y retención de historial por empresa
-- Agrega campos para contacto (nombre, email, teléfono) y control de retención

ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255) DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255) DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50) DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS retention_days INT DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS retention_warned_at TIMESTAMPTZ;

-- Índice para el job de retención: buscar empresas activas con retención configurada
CREATE INDEX IF NOT EXISTS idx_companies_retention ON companies(is_active, retention_days)
WHERE is_active = true AND retention_days > 0;
