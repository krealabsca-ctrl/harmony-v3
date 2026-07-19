-- Migración 003: API key de Anthropic por empresa
-- Cada empresa puede guardar su propia key (cifrada AES-256 en la capa de aplicación,
-- serializer "encrypted"). Si está vacía, el bot cae en la key global del .env.
-- La columna es TEXT porque guarda el ciphertext con prefijo "enc:".

ALTER TABLE companies ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT DEFAULT '';
