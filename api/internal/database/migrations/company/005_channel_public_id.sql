-- ============================================================
-- Harmony v3 — Channel public UUID para URLs de webhook
-- Reemplaza el integer ID secuencial en las URLs públicas de webhook,
-- eliminando la posibilidad de enumerar canales de otros tenants.
-- ============================================================

ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_public_id ON channels(public_id);
