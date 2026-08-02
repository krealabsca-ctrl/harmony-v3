-- 017_user_active_flag.sql
--
-- Usuarios activos / inactivos.
--
-- Hasta ahora un usuario solo podía existir o estar eliminado (deleted_at), sin
-- punto intermedio: para sacar a alguien de la rotación había que borrarlo. Eso es
-- destructivo y confuso cuando la persona se va de vacaciones, cambia de puesto o
-- deja la empresa temporalmente.
--
-- is_active = false significa: la persona sigue existiendo y su historial se
-- conserva intacto, pero no puede iniciar sesión ni recibir conversaciones nuevas
-- por autoasignación.
--
-- Se crea en TRUE para no cambiar el comportamiento de los usuarios ya existentes.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Índice parcial: la búsqueda de agente para autoasignación filtra siempre por
-- activos y no eliminados.
CREATE INDEX IF NOT EXISTS idx_users_active_role
    ON users(role)
    WHERE is_active = TRUE AND deleted_at IS NULL;
