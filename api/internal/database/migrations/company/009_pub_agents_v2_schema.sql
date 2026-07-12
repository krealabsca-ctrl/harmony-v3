-- Migración 009: Alinear pub_agents con el esquema de Harmony v2
-- Tipos: content, lead, reply (antes: generator, reviewer, strategist)
-- Campos: model (antes: ai_model), enabled (antes: is_active), + platforms JSONB, + config JSONB

-- Renombrar columnas
ALTER TABLE pub_agents RENAME COLUMN ai_model TO model;
ALTER TABLE pub_agents RENAME COLUMN is_active TO enabled;

-- Cambiar constraint del tipo
ALTER TABLE pub_agents DROP CONSTRAINT IF EXISTS pub_agents_type_check;
ALTER TABLE pub_agents
    ADD CONSTRAINT pub_agents_type_check CHECK (type IN ('content', 'lead', 'reply'));

-- Cambiar defaults
ALTER TABLE pub_agents ALTER COLUMN type SET DEFAULT 'content';
ALTER TABLE pub_agents ALTER COLUMN model SET DEFAULT 'claude-sonnet-4-6';

-- Agregar nuevas columnas
ALTER TABLE pub_agents
    ADD COLUMN IF NOT EXISTS platforms JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS config    JSONB DEFAULT '{}';

-- Migrar datos: convertir tipos viejos a los nuevos
UPDATE pub_agents SET type = 'content' WHERE type IN ('generator', 'reviewer', 'strategist');
UPDATE pub_agents SET model = 'claude-sonnet-4-6' WHERE model NOT IN ('claude-sonnet-4-6','claude-haiku-4-5','claude-opus-4-8');
