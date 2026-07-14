-- Comentarios de redes sociales (módulo pub)
CREATE TABLE IF NOT EXISTS pub_comments (
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

-- Agregar columna status si no existe (para migraciones desde versiones anteriores)
ALTER TABLE IF EXISTS pub_comments
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';

-- Crear índices
CREATE INDEX IF NOT EXISTS idx_pub_comments_company_id ON pub_comments(company_id);
CREATE INDEX IF NOT EXISTS idx_pub_comments_status ON pub_comments(company_id, status);

-- Brand Kit del módulo pub
CREATE TABLE IF NOT EXISTS pub_brand_kit (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL UNIQUE,
    primary_color VARCHAR(20) DEFAULT '#6366f1',
    secondary_color VARCHAR(20) DEFAULT '#a855f7',
    accent_color VARCHAR(20) DEFAULT '#ec4899',
    brand_colors JSONB DEFAULT '[]',
    primary_font VARCHAR(100) DEFAULT 'Inter',
    secondary_font VARCHAR(100) DEFAULT 'Georgia',
    logo_url VARCHAR(500) DEFAULT '',
    logo_dark_url VARCHAR(500) DEFAULT '',
    brand_voice VARCHAR(50) DEFAULT 'professional',
    tone_notes TEXT DEFAULT '',
    hashtags JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
