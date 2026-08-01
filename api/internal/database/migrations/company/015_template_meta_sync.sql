-- 015_template_meta_sync.sql
--
-- Sincronización real de plantillas con Meta.
--
-- Hasta ahora CreateTemplate solo guardaba la plantilla en la base local con
-- status='pending' y nunca llamaba a la API de Meta, así que ninguna plantilla
-- llegaba a revisión y external_template_id quedaba siempre vacío (lo que además
-- rompía el envío de plantillas, porque el envío usa ese campo como nombre).
--
-- Esta migración agrega lo que hace falta para reflejar el estado real de Meta:
--
--  1. rejection_reason: el motivo que devuelve Meta cuando rechaza una plantilla.
--     Sin esto el usuario ve "Rechazada" sin saber por qué.
--
--  2. Se amplía el CHECK de status con dos valores:
--     - 'draft': la plantilla existe en Harmony pero NO se pudo enviar a Meta
--       (token vencido, nombre duplicado, sin canal de WhatsApp). Antes estos
--       casos quedaban indistinguibles de 'pending', que es justo la confusión
--       reportada: "no sé si se envió a Meta".
--     - 'disabled': Meta puede deshabilitar una plantilla aprobada por baja
--       calidad; llega por el webhook message_template_status_update.

ALTER TABLE message_templates
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT '';

ALTER TABLE message_templates
    DROP CONSTRAINT IF EXISTS message_templates_status_check;

ALTER TABLE message_templates
    ADD CONSTRAINT message_templates_status_check
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'paused', 'disabled'));

-- Las plantillas ya existentes sin external_template_id nunca llegaron a Meta:
-- pasarlas a 'draft' para que se vean como lo que son y se puedan reenviar.
UPDATE message_templates
   SET status = 'draft'
 WHERE status = 'pending'
   AND COALESCE(external_template_id, '') = '';

CREATE INDEX IF NOT EXISTS idx_message_templates_external_id
    ON message_templates(external_template_id)
    WHERE external_template_id <> '';
