-- Migración 009: Alinear pub_agents con el esquema de Harmony v2
-- Idempotent approach: verifica existencia antes de rename, agrega todas las columnas con IF NOT EXISTS
-- Tipos: content, lead, reply (antes: generator, reviewer, strategist)
-- Campos: model (antes: ai_model), enabled (antes: is_active), + platforms JSONB, + config JSONB

-- 1. Renombrar ai_model → model (si existe la columna fuente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='pub_agents' AND column_name='ai_model') THEN
    EXECUTE 'ALTER TABLE pub_agents RENAME COLUMN ai_model TO model';
  END IF;
END $$;

-- 2. Renombrar is_active → enabled (si existe la columna fuente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='pub_agents' AND column_name='is_active') THEN
    EXECUTE 'ALTER TABLE pub_agents RENAME COLUMN is_active TO enabled';
  END IF;
END $$;

-- 3. Agregar todas las columnas finales que puedan faltar
-- (cubre el caso donde 001 creó pub_agents con un esquema incompleto)
ALTER TABLE pub_agents
    ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'content',
    ADD COLUMN IF NOT EXISTS instructions TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS model VARCHAR(100) DEFAULT 'claude-sonnet-4-6',
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS platforms JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 4. Cambiar constraint del tipo (si existe el default antiguo)
ALTER TABLE pub_agents DROP CONSTRAINT IF EXISTS pub_agents_type_check;
ALTER TABLE pub_agents
    ADD CONSTRAINT pub_agents_type_check CHECK (type IN ('content', 'lead', 'reply'));

-- 5. Cambiar defaults
ALTER TABLE pub_agents ALTER COLUMN type SET DEFAULT 'content';
ALTER TABLE pub_agents ALTER COLUMN model SET DEFAULT 'claude-sonnet-4-6';

-- 6. Migrar datos: convertir tipos viejos a los nuevos
UPDATE pub_agents SET type = 'content' WHERE type IN ('generator', 'reviewer', 'strategist');
UPDATE pub_agents SET model = 'claude-sonnet-4-6' WHERE model NOT IN ('claude-sonnet-4-6','claude-haiku-4-5','claude-opus-4-8');
