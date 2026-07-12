-- Migración 013: Campos de detección de leads en pub_settings (paridad con v2)

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_settings' AND column_name='lead_threshold') THEN
        ALTER TABLE pub_settings ADD COLUMN lead_threshold INTEGER DEFAULT 70;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_settings' AND column_name='lead_whatsapp_numbers') THEN
        ALTER TABLE pub_settings ADD COLUMN lead_whatsapp_numbers TEXT DEFAULT '';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='pub_settings' AND column_name='lead_keywords') THEN
        ALTER TABLE pub_settings ADD COLUMN lead_keywords TEXT DEFAULT '';
    END IF;
END $$;
