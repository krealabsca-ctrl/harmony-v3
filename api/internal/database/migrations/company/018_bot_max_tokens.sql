-- 018_bot_max_tokens.sql
--
-- Largo máximo de la respuesta del bot, configurable por departamento.
--
-- Hasta ahora el límite estaba fijo en 512 tokens dentro del código. Cuando el bot
-- necesitaba explicar algo un poco largo, la respuesta se cortaba a media frase y le
-- llegaba truncada al cliente — que es justo lo que hace que un bot se sienta roto.
--
-- 1024 es un default holgado para atención al cliente (≈ 3 o 4 párrafos). El costo
-- solo sube si el modelo realmente usa esos tokens: es un techo, no una reserva.

ALTER TABLE bot_configs
    ADD COLUMN IF NOT EXISTS max_tokens INT NOT NULL DEFAULT 1024;
