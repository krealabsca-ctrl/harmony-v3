-- 016_template_channel_id.sql
--
-- La pantalla de Plantillas muestra las columnas "Departamento" y "Canal", pero
-- siempre salían vacías ("—" y "Sin canal"). Dos causas:
--
--  1. CreateTemplate no leía department_id ni channel_id del formulario: los
--     descartaba al deserializar, así que nunca se guardaban aunque el usuario
--     los eligiera.
--  2. La tabla no tenía columna channel_id -- solo channel_type ("whatsapp"),
--     que no permite saber CUÁL canal se eligió ni mostrar su nombre.
--
-- Se agrega channel_id como referencia opcional: una plantilla sin canal
-- específico (channel_id NULL) sigue siendo válida y aplica a todo el tipo de
-- canal, que es justo la opción "Sin canal específico" del formulario.
-- ON DELETE SET NULL: borrar un canal no debe arrastrar sus plantillas.

ALTER TABLE message_templates
    ADD COLUMN IF NOT EXISTS channel_id BIGINT REFERENCES channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_message_templates_channel_id
    ON message_templates(channel_id);
