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

CREATE TABLE IF NOT EXISTS whatsapp_pricing (
    id             BIGSERIAL PRIMARY KEY,
    country_code   VARCHAR(10)    NOT NULL UNIQUE,
    country_name   VARCHAR(100)   NOT NULL,
    marketing      NUMERIC(10,6)  NOT NULL DEFAULT 0,
    utility        NUMERIC(10,6)  NOT NULL DEFAULT 0,
    authentication NUMERIC(10,6)  NOT NULL DEFAULT 0,
    service        NUMERIC(10,6)  NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Datos iniciales: tarifas Meta WhatsApp Business API (USD por conversación, 2025)
INSERT INTO whatsapp_pricing (country_code, country_name, marketing, utility, authentication, service)
VALUES
    ('CR', 'Costa Rica',       0.027400, 0.011000, 0.010800, 0.000000),
    ('MX', 'México',           0.035600, 0.013500, 0.013200, 0.000000),
    ('CO', 'Colombia',         0.031700, 0.012000, 0.011800, 0.000000),
    ('US', 'Estados Unidos',   0.025000, 0.009500, 0.009400, 0.000000),
    ('BR', 'Brasil',           0.062500, 0.008000, 0.007900, 0.000000),
    ('AR', 'Argentina',        0.049100, 0.018000, 0.017700, 0.000000),
    ('CL', 'Chile',            0.037800, 0.014300, 0.014100, 0.000000),
    ('PE', 'Perú',             0.033900, 0.012900, 0.012600, 0.000000),
    ('EC', 'Ecuador',          0.031700, 0.012000, 0.011800, 0.000000),
    ('GT', 'Guatemala',        0.027400, 0.011000, 0.010800, 0.000000),
    ('HN', 'Honduras',         0.027400, 0.011000, 0.010800, 0.000000),
    ('SV', 'El Salvador',      0.027400, 0.011000, 0.010800, 0.000000),
    ('NI', 'Nicaragua',        0.027400, 0.011000, 0.010800, 0.000000),
    ('PA', 'Panamá',           0.027400, 0.011000, 0.010800, 0.000000),
    ('DO', 'Rep. Dominicana',  0.027400, 0.011000, 0.010800, 0.000000),
    ('VE', 'Venezuela',        0.031700, 0.012000, 0.011800, 0.000000),
    ('BO', 'Bolivia',          0.031700, 0.012000, 0.011800, 0.000000),
    ('PY', 'Paraguay',         0.031700, 0.012000, 0.011800, 0.000000),
    ('UY', 'Uruguay',          0.049100, 0.018000, 0.017700, 0.000000),
    ('ES', 'España',           0.052300, 0.020800, 0.020500, 0.000000),
    ('IN', 'India',            0.011000, 0.004000, 0.003900, 0.000000),
    ('GB', 'Reino Unido',      0.043100, 0.018200, 0.017900, 0.000000),
    ('DE', 'Alemania',         0.113600, 0.055200, 0.054300, 0.000000),
    ('FR', 'Francia',          0.095400, 0.045200, 0.044500, 0.000000),
    ('IT', 'Italia',           0.072300, 0.034100, 0.033600, 0.000000),
    ('CA', 'Canadá',           0.025000, 0.009500, 0.009400, 0.000000),
    ('AU', 'Australia',        0.060200, 0.025400, 0.025000, 0.000000),
    ('ZA', 'Sudáfrica',        0.045800, 0.018800, 0.018500, 0.000000),
    ('NG', 'Nigeria',          0.028900, 0.011500, 0.011300, 0.000000),
    ('MA', 'Marruecos',        0.019300, 0.007400, 0.007300, 0.000000)
ON CONFLICT (country_code) DO NOTHING;

-- ─── Flag visible_to_agents en plantillas ─────────────────────────────────────

ALTER TABLE message_templates
    ADD COLUMN IF NOT EXISTS visible_to_agents BOOLEAN NOT NULL DEFAULT FALSE;
