-- Migración 010: Reemplazar pub_brand_kit por esquema v2 e incluir pub_documents

-- Eliminar tabla anterior (no tiene datos productivos relevantes)
DROP TABLE IF EXISTS pub_brand_kit;

CREATE TABLE pub_brand_kit (
    id                 BIGSERIAL PRIMARY KEY,
    company_id         BIGINT NOT NULL UNIQUE,
    logo_path          VARCHAR(500) DEFAULT '',
    colors             JSONB DEFAULT '[]',
    contact_info       JSONB DEFAULT '{}',
    tone               VARCHAR(100) DEFAULT 'profesional',
    target_audience    TEXT DEFAULT '',
    avoid_words        JSONB DEFAULT '[]',
    extra_instructions TEXT DEFAULT '',
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pub_documents (
    id                 BIGSERIAL PRIMARY KEY,
    company_id         BIGINT NOT NULL,
    name               VARCHAR(255) NOT NULL DEFAULT '',
    file_path          VARCHAR(500) NOT NULL DEFAULT '',
    mime_type          VARCHAR(100) DEFAULT '',
    extracted_text     TEXT DEFAULT '',
    is_active          BOOLEAN DEFAULT true,
    processing_status  VARCHAR(20) DEFAULT 'pending'
                       CHECK (processing_status IN ('pending','processing','done','failed')),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pub_documents_company_id ON pub_documents(company_id);
