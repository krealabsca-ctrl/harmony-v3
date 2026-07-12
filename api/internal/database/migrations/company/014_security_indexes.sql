-- 014_security_indexes.sql
-- Ronda 3 de auditoría: índices para el hot path de mensajería y deduplicación.
-- Idempotente (IF NOT EXISTS) y seguro de re-ejecutar en DBs existentes.

-- M-08: índice ÚNICO parcial sobre messages.external_id para evitar mensajes duplicados
-- en reintentos concurrentes de webhooks de Meta. Se envuelve en un bloque que tolera
-- duplicados preexistentes (no aborta la migración si ya hay filas duplicadas).
DO $$
BEGIN
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id_unique
            ON messages(external_id) WHERE external_id <> '';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'No se pudo crear idx_messages_external_id_unique (posibles duplicados previos): %', SQLERRM;
    END;
END $$;

-- A-25: índices para las consultas más frecuentes de ProcessInbound y del inbox.

-- Lookup de contacto por (teléfono, canal) en cada mensaje entrante.
CREATE INDEX IF NOT EXISTS idx_contacts_phone_channel
    ON contacts(phone, channel_id);

-- Búsqueda de la conversación activa del contacto en cada mensaje entrante.
CREATE INDEX IF NOT EXISTS idx_conversations_contact_channel_status
    ON conversations(contact_id, channel_id, status);

-- Orden del inbox: primero no leídas, luego por actividad reciente.
CREATE INDEX IF NOT EXISTS idx_conversations_inbox
    ON conversations(status, unread_count DESC, last_message_at DESC);

-- C-06: los campos sensibles de channels se cifran (AES-GCM) y se almacenan como texto
-- con prefijo "enc:". La columna credentials era JSONB (rechazaría un string cifrado no-JSON),
-- así que se convierte a TEXT. Idempotente: solo altera si el tipo aún es el antiguo.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'channels' AND column_name = 'credentials' AND data_type = 'jsonb') THEN
        ALTER TABLE channels ALTER COLUMN credentials DROP DEFAULT;
        ALTER TABLE channels ALTER COLUMN credentials TYPE TEXT USING credentials::text;
        ALTER TABLE channels ALTER COLUMN credentials SET DEFAULT '';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'channels' AND column_name = 'webhook_secret' AND data_type = 'character varying') THEN
        ALTER TABLE channels ALTER COLUMN webhook_secret TYPE TEXT;
    END IF;
END $$;
