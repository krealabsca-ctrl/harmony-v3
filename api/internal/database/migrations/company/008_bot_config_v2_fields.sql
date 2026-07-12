-- Migración 008: Alinear bot_configs con el modelo de Harmony v2
-- Agrega los campos que usa la UI v2 y renombra system_prompt → instructions.

ALTER TABLE bot_configs
    ADD COLUMN IF NOT EXISTS instructions         TEXT         DEFAULT '',
    ADD COLUMN IF NOT EXISTS max_context_chars    INT          DEFAULT 80000,
    ADD COLUMN IF NOT EXISTS human_takeover       BOOLEAN      DEFAULT true,
    ADD COLUMN IF NOT EXISTS max_daily_responses  INT          DEFAULT 50,
    ADD COLUMN IF NOT EXISTS channel_ids          JSONB        DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS use_all_docs         BOOLEAN      DEFAULT true;

-- Migrar datos existentes de system_prompt → instructions
UPDATE bot_configs SET instructions = system_prompt WHERE instructions = '' AND system_prompt <> '';
