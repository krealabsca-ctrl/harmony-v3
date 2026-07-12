-- Migración 010: Alinear pub_campaigns con el esquema del frontend v2
-- budget_amount → budget, spent_amount → spent
-- objective → type
-- platform (string) → platforms (JSONB array)
-- Agregar impressions, clicks, conversions

DO $$
BEGIN
    -- Renombrar budget_amount → budget
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='pub_campaigns' AND column_name='budget_amount') THEN
        ALTER TABLE pub_campaigns RENAME COLUMN budget_amount TO budget;
    END IF;

    -- Renombrar spent_amount → spent
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='pub_campaigns' AND column_name='spent_amount') THEN
        ALTER TABLE pub_campaigns RENAME COLUMN spent_amount TO spent;
    END IF;

    -- Renombrar objective → type
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='pub_campaigns' AND column_name='objective') THEN
        ALTER TABLE pub_campaigns RENAME COLUMN objective TO type;
    END IF;

    -- Agregar columna platforms JSONB
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_campaigns' AND column_name='platforms') THEN
        ALTER TABLE pub_campaigns ADD COLUMN platforms JSONB DEFAULT '[]';
    END IF;

    -- Agregar columnas de métricas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_campaigns' AND column_name='impressions') THEN
        ALTER TABLE pub_campaigns ADD COLUMN impressions INT DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_campaigns' AND column_name='clicks') THEN
        ALTER TABLE pub_campaigns ADD COLUMN clicks INT DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_campaigns' AND column_name='conversions') THEN
        ALTER TABLE pub_campaigns ADD COLUMN conversions INT DEFAULT 0;
    END IF;
END $$;

-- Migrar el valor de platform (string) al nuevo array platforms
UPDATE pub_campaigns
SET platforms = to_jsonb(ARRAY[platform]::text[])
WHERE platform IS NOT NULL AND platform <> ''
  AND (platforms IS NULL OR platforms = '[]'::jsonb);
