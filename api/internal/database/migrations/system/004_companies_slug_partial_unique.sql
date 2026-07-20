-- Migración 004: el slug de empresa solo debe ser único entre empresas NO eliminadas.
-- Antes la constraint UNIQUE(slug) incluía las soft-deleted, así que recrear una empresa
-- con el slug de una borrada fallaba con "ya existe" aunque no apareciera en el listado.

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_slug_active
    ON companies(slug) WHERE deleted_at IS NULL;
