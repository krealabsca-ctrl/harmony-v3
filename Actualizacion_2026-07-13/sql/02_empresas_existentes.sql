-- ============================================================
-- Actualización Harmony v3 — 2026-07-13
-- Script 2: bases de datos de empresa (harmony_c1, harmony_c2, ...)
--
-- Ejecutar en CADA base de empresa con:
--   psql -U harmony -d harmony_cN -f 02_empresas_existentes.sql
--
-- Corrige tablas que hayan quedado con el esquema viejo de la
-- migración 001 (bug corregido en esta versión: el CREATE IF NOT
-- EXISTS de las migraciones 003/006/007 no aplicaba porque la 001
-- ya había creado las tablas con un esquema anterior incompatible).
--
-- Con el esquema viejo estas funcionalidades daban error en la API,
-- por lo que las tablas no contienen datos reales de producción y
-- es seguro recrearlas. Es idempotente: si la base ya tiene el
-- esquema correcto, no toca nada.
-- ============================================================

-- ─── Bot IA v3: ajustes por empresa y base de conocimiento local ────────────
-- (idéntico a la migración 015 que corre en empresas nuevas)
CREATE TABLE IF NOT EXISTS system_settings (
    id BIGSERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE bot_documents ADD COLUMN IF NOT EXISTS department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE bot_documents ADD COLUMN IF NOT EXISTS file_type VARCHAR(10) DEFAULT 'TXT';
ALTER TABLE bot_documents ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE bot_documents ADD COLUMN IF NOT EXISTS content TEXT DEFAULT '';
ALTER TABLE bot_documents ALTER COLUMN original_name SET DEFAULT '';
ALTER TABLE bot_documents ALTER COLUMN azure_path SET DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_bot_documents_department_id ON bot_documents(department_id);

-- ─── messages: permitir el estado 'received' de los mensajes entrantes ─────
-- El código inserta status='received' en cada mensaje entrante de
-- WhatsApp/Telegram, pero el CHECK original no lo permitía y el webhook
-- fallaba con error 500. Se amplía la restricción.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_status_check
    CHECK (status IN ('pending','sent','delivered','read','failed','received'));

-- ─── whatsapp_pricing: esquema viejo tenía columna price_usd ───────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'whatsapp_pricing' AND column_name = 'price_usd'
    ) THEN
        DROP TABLE whatsapp_pricing;

        CREATE TABLE whatsapp_pricing (
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

        RAISE NOTICE 'whatsapp_pricing: esquema viejo detectado, tabla recreada con tarifas iniciales';
    END IF;
END $$;

-- ─── pub_agents: esquema viejo tenía columna platform ──────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pub_agents' AND column_name = 'platform'
    ) THEN
        DROP TABLE pub_agents;

        -- Esquema final (migraciones 006 + 009)
        CREATE TABLE pub_agents (
            id BIGSERIAL PRIMARY KEY,
            company_id BIGINT NOT NULL,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(50) DEFAULT 'content' CHECK (type IN ('content', 'lead', 'reply')),
            instructions TEXT DEFAULT '',
            model VARCHAR(100) DEFAULT 'claude-sonnet-4-6',
            enabled BOOLEAN DEFAULT true,
            platforms JSONB DEFAULT '[]',
            config    JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_pub_agents_company_id ON pub_agents(company_id);

        RAISE NOTICE 'pub_agents: esquema viejo detectado, tabla recreada';
    END IF;
END $$;

-- ─── pub_comments: esquema viejo tenía columna resource_type ───────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pub_comments' AND column_name = 'resource_type'
    ) THEN
        DROP TABLE pub_comments;

        -- Esquema final (migración 007)
        CREATE TABLE pub_comments (
            id BIGSERIAL PRIMARY KEY,
            company_id BIGINT NOT NULL,
            post_id BIGINT,
            platform VARCHAR(50) DEFAULT 'instagram',
            author_name VARCHAR(255) NOT NULL DEFAULT '',
            author_avatar VARCHAR(500) DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            sentiment VARCHAR(20) DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
            status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'replied', 'hidden', 'spam')),
            replied_at TIMESTAMPTZ,
            reply_body TEXT DEFAULT '',
            external_id VARCHAR(255) DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_pub_comments_company_id ON pub_comments(company_id);
        CREATE INDEX IF NOT EXISTS idx_pub_comments_status ON pub_comments(company_id, status);

        RAISE NOTICE 'pub_comments: esquema viejo detectado, tabla recreada';
    END IF;
END $$;
