-- ============================================================
-- Actualización Harmony v3 — 2026-07-13
-- Script 1: base de datos del sistema (harmony_system)
--
-- Ejecutar UNA sola vez con:
--   psql -U harmony -d harmony_system -f 01_harmony_system.sql
--
-- Es idempotente: se puede volver a ejecutar sin causar daño.
-- ============================================================

-- Datos del encargado de cada empresa (formulario Nueva Empresa)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_name  VARCHAR(255) DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255) DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50)  DEFAULT '';

-- Retención de historial por empresa (0 = sin límite) y control del aviso
ALTER TABLE companies ADD COLUMN IF NOT EXISTS retention_days INT DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS retention_warned_at TIMESTAMPTZ;

-- Las claves nuevas de system_settings (logo_path, smtp, retention_email)
-- se crean automáticamente desde la interfaz; no requieren migración.
