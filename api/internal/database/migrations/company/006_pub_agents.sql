-- Agentes IA del módulo de publicaciones
CREATE TABLE IF NOT EXISTS pub_agents (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'generator' CHECK (type IN ('generator', 'reviewer', 'strategist')),
    instructions TEXT DEFAULT '',
    ai_model VARCHAR(100) DEFAULT 'GPT-4o',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pub_agents_company_id ON pub_agents(company_id);
