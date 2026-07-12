-- Agregar campos de costo y país a campañas
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS country_code     VARCHAR(10)    DEFAULT 'CR';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cost_per_message NUMERIC(10,6)  DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_cost       NUMERIC(12,2)  DEFAULT 0;
