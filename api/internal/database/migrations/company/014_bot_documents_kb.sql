-- Migración 014: Base de conocimiento funcional del bot
-- Agrega el texto extraído del documento, el flag de activación por documento y el
-- departamento al que aplica (NULL = global, todos los departamentos).
-- La ruta local del archivo se guarda en la columna existente azure_path (reutilizada).

ALTER TABLE bot_documents ADD COLUMN IF NOT EXISTS extracted_text TEXT DEFAULT '';
ALTER TABLE bot_documents ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE bot_documents ADD COLUMN IF NOT EXISTS department_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_bot_documents_active ON bot_documents(is_active, department_id);
