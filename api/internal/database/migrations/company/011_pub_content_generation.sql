-- Migración 011: Campos para generación IA + aprobación iterativa por WhatsApp

DO $$
BEGIN
    -- ── pub_posts: campos de imagen y ciclo de aprobación ─────────────────────
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_posts' AND column_name='image_url') THEN
        ALTER TABLE pub_posts ADD COLUMN image_url TEXT DEFAULT '';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_posts' AND column_name='thumbnail_url') THEN
        ALTER TABLE pub_posts ADD COLUMN thumbnail_url TEXT DEFAULT '';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_posts' AND column_name='image_path') THEN
        ALTER TABLE pub_posts ADD COLUMN image_path TEXT DEFAULT '';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_posts' AND column_name='approval_status') THEN
        ALTER TABLE pub_posts ADD COLUMN approval_status VARCHAR(20) DEFAULT 'draft';
    END IF;

    -- ID del mensaje WhatsApp enviado al aprobador (para correlacionar el reply)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_posts' AND column_name='approval_wa_message_id') THEN
        ALTER TABLE pub_posts ADD COLUMN approval_wa_message_id VARCHAR(255) DEFAULT '';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_posts' AND column_name='approval_phone') THEN
        ALTER TABLE pub_posts ADD COLUMN approval_phone VARCHAR(50) DEFAULT '';
    END IF;

    -- Historial de revisiones: [{caption, feedback}, ...]
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_posts' AND column_name='revision_history') THEN
        ALTER TABLE pub_posts ADD COLUMN revision_history JSONB DEFAULT '[]';
    END IF;

    -- Referencia al agente de IA que generó el post
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_posts' AND column_name='agent_id') THEN
        ALTER TABLE pub_posts ADD COLUMN agent_id BIGINT;
    END IF;

    -- ── pub_settings: claves de IA y configuración de aprobación ─────────────
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_settings' AND column_name='openai_api_key') THEN
        ALTER TABLE pub_settings ADD COLUMN openai_api_key TEXT DEFAULT '';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_settings' AND column_name='approval_required') THEN
        ALTER TABLE pub_settings ADD COLUMN approval_required BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_settings' AND column_name='approval_phone') THEN
        ALTER TABLE pub_settings ADD COLUMN approval_phone VARCHAR(50) DEFAULT '';
    END IF;

    -- Estilo de imagen para DALL-E: realistic | illustrated | minimalist | 3d
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_settings' AND column_name='image_style') THEN
        ALTER TABLE pub_settings ADD COLUMN image_style VARCHAR(50) DEFAULT 'realistic';
    END IF;

    -- Canal WhatsApp usado para enviar mensajes de aprobación
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_settings' AND column_name='wa_channel_id') THEN
        ALTER TABLE pub_settings ADD COLUMN wa_channel_id BIGINT;
    END IF;
END $$;

-- Índice para buscar posts por mensaje de aprobación (O(1) al recibir reply del webhook)
CREATE INDEX IF NOT EXISTS idx_pub_posts_approval_wa
    ON pub_posts(approval_wa_message_id)
    WHERE approval_wa_message_id IS NOT NULL AND approval_wa_message_id <> '';
