-- Migración 003: Tabla de tarifas WhatsApp y flags de plantillas para agentes
--
-- 1. Crea la tabla whatsapp_pricing con las tarifas por país/categoría.
--    Los precios se cargan con datos iniciales de Meta (2025) para los países
--    más comunes en Latinoamérica. El campo updated_at registra cuándo se
--    actualizaron los precios por última vez (manual o desde Meta).
--
-- 2. Agrega la columna visible_to_agents en message_templates.
--    Cuando true, los agentes pueden ver y usar la plantilla en el inbox
--    (para enviar cuando la ventana de 24h expiró o al abrir nueva conversación).
--    Solo los admin/supervisores pueden activar este flag desde la UI.

-- ─── Tabla de tarifas WhatsApp por país ──────────────────────────────────────
-- NOTA: La tabla whatsapp_pricing ya existe en production con un schema específico:
-- - company_id, channel_id (relaciones a empresa y canal)
-- - category (enum: utility, marketing, authentication, service)
-- - price_usd (precio en USD)
-- Esta migración simplemente asegura la existencia de la tabla y sus índices.
-- No se reinsertan datos para evitar duplicados.

CREATE TABLE IF NOT EXISTS whatsapp_pricing (
    id             BIGSERIAL PRIMARY KEY,
    company_id     BIGINT NOT NULL,
    channel_id     BIGINT,
    country_code   VARCHAR(5)     NOT NULL,
    country_name   VARCHAR(100)   DEFAULT '',
    category       VARCHAR(100)   NOT NULL,
    price_usd      NUMERIC(10,6)  DEFAULT 0,
    effective_from TIMESTAMPTZ    DEFAULT NOW(),
    created_at     TIMESTAMPTZ    DEFAULT NOW(),
    updated_at     TIMESTAMPTZ    DEFAULT NOW()
);

-- Crear índices si no existen
CREATE INDEX IF NOT EXISTS idx_whatsapp_pricing_company_id ON whatsapp_pricing(company_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_pricing_country ON whatsapp_pricing(country_code);

-- ─── Flag visible_to_agents en plantillas ─────────────────────────────────────

ALTER TABLE message_templates
    ADD COLUMN IF NOT EXISTS visible_to_agents BOOLEAN NOT NULL DEFAULT FALSE;
