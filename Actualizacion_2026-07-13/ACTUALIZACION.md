# Harmony v3 — Paquete de actualización (2026-07-13)

Este paquete contiene todos los cambios realizados sobre Harmony v3 desde la
versión anterior, listos para aplicar en una instancia de producción.

## Contenido del paquete

| Carpeta / archivo | Descripción |
|---|---|
| `ACTUALIZACION.md` | Este documento |
| `sql/01_harmony_system.sql` | Migración de la base del sistema (`harmony_system`) |
| `sql/02_empresas_existentes.sql` | Corrección de esquemas viejos en cada base de empresa (`harmony_cN`) |
| `bin/harmony-api-windows.exe` | Binario del API compilado para Windows (amd64) |
| `bin/harmony-api-linux` | Binario del API compilado para Linux (amd64) |
| `web-dist/` | Frontend compilado para producción (contenido de `dist/`) |
| `manuales/` | Manuales de integración de WhatsApp con Meta, en PDF (entregables al cliente) |

---

## Novedades

### 1. Datos del encargado por empresa
Al crear una empresa, el formulario ahora solicita **Nombre del Encargado,
Correo y Teléfono** (obligatorios). También se pueden editar en empresas
existentes con el botón **Editar**. El correo del encargado es el destino de
los avisos automáticos del sistema (ver punto 5).

### 2. Logo del sistema configurable
En **Configuración del Sistema** hay una nueva tarjeta para subir el logo de
la plataforma (PNG, SVG, JPG o ICO). Se muestra en la pantalla de inicio de
sesión y en el sidebar, junto con el nombre de aplicación configurado.

### 3. Nuevo módulo "Correo del Sistema"
Nueva entrada en el menú del superadmin: configura la cuenta SMTP con la que
la plataforma envía correos a los usuarios (servidor, puerto 587/465, usuario,
contraseña, remitente). Incluye botón de **correo de prueba**.

### 4. Recuperación de contraseña funcional
El enlace de "¿Olvidaste tu contraseña?" ahora **envía el correo de verdad**
usando la cuenta del módulo Correo del Sistema (antes era un código vacío que
no enviaba nada).

### 5. Retención de historial por empresa con aviso y purga automática
- En la lista de empresas del superadmin se configura la **retención en días**
  por empresa (columna nueva "Retención"; 0 = sin límite).
- Un proceso automático revisa cada hora: cuando hay conversaciones cerradas
  más viejas que la retención, **avisa por correo al encargado** y **5 días
  después elimina definitivamente** esas conversaciones con sus mensajes y
  adjuntos de la base de datos.
- La **plantilla del aviso es 100% personalizable** (asunto y cuerpo HTML) en
  Correo del Sistema, con variables: `{{empresa}}`, `{{encargado}}`,
  `{{dias}}`, `{{fecha_limite}}`, `{{fecha_eliminacion}}`.
- Solo se purgan conversaciones **cerradas**; las abiertas nunca se eliminan.
- Cambiar la retención de una empresa reinicia el ciclo de aviso.

### 6. Optimización de carga al servidor
El frontend generaba peticiones constantes al API por cada usuario conectado.
Se redujo el tráfico en más de un 60% sin perder tiempo real:
- La bandeja de entrada ahora se actualiza **por WebSocket al instante**
  (verificado: un mensaje entrante aparece en ~300 ms); el polling pasó de cada
  12 s a un respaldo de 60 s que solo actúa si el socket se cae.
- Se eliminó el refetch masivo cada vez que la ventana recupera el foco.
- Intervalos de dashboard y reportes relajados (30 s → 60 s).
- El Monitoreo en tiempo real conserva sus intervalos (es su propósito).

### 7. Responsive en todos los dispositivos
Se auditaron las 30 ventanas de la aplicación (admin, superadmin y módulo de
publicidad) en móvil (375 px), tablet (768 px) y escritorio, midiendo contenido
recortado y desbordes. Correcciones aplicadas:
- Configuración del Bot: estadísticas y banner apilados en móvil.
- Comentarios (Pub): pestañas de estado con scroll horizontal en pantallas angostas.
- Analítica (Pub): tarjetas de métricas sin recortes y filtros que se acomodan.
- Panel Pub: etiquetas de KPIs con elipsis en vez de recorte.
- Branding: columnas de colores apiladas en tablet (el sidebar reduce el ancho útil).
- Wizard de campañas: en móvil los pasos muestran solo el número.
La bandeja de entrada ya alternaba correctamente entre lista y conversación en
móvil (con botón "Volver a la lista") y las tablas scrollean dentro de su
contenedor; eso se verificó sin cambios.

### 8. Precios WA y costos históricos
- **Lista de Precios WA reparada**: importar el CSV decía "importado" pero la
  lista quedaba vacía. El import siempre guardó bien; era el listado el que
  consultaba el esquema viejo de la tabla y fallaba en silencio.
- **Costos históricos blindados**: el costo por mensaje ahora lo calcula el
  SERVIDOR al crear cada campaña (tarifa vigente por país y categoría de la
  plantilla) y queda guardado en la campaña. Los reportes de costos y
  estadísticas leen ese valor guardado, por lo que cambiar los precios después
  NO altera los históricos — solo aplica a campañas futuras.

### 9. Bot IA v3 — recepcionista y agente de ventas
- **Memoria de conversación**: el bot ahora recibe el historial reciente del
  chat (antes solo veía el último mensaje), por lo que mantiene el hilo en
  conversaciones de venta o recepción.
- **Base de conocimiento funcional**: los documentos (PDF, DOCX, TXT, MD, CSV)
  se guardan en el servidor, se les extrae el texto y se inyectan en el
  contexto del bot. Se pueden activar/desactivar por documento y asignar a un
  departamento. (Antes la subida no guardaba nada y dependía de Azure.)
- **API key de Anthropic por empresa**: cada empresa guarda su propia key
  desde la pantalla del bot (cifrada AES-256 en reposo), con fallback a la
  del `.env`. Antes el guardado fallaba en silencio y siempre se usaba la
  global.
- **Transferencia inteligente de departamento**: si el cliente pide algo de
  otro departamento, el bot transfiere la conversación (mensaje de cortesía
  incluido) y asigna un agente del departamento destino.
- **Límite diario de respuestas** del bot ahora se aplica de verdad.
- Los canales ahora permiten asignar/cambiar su departamento al editarlos.
- Si el bot falla, el error queda en el log del servidor (antes se perdía).

### 10. SMTP y Branding exclusivos del superadmin
Las pantallas de SMTP y Branding que veían los administradores de empresa
escribían sobre configuración GLOBAL de la plataforma (la cuenta de correo y la
apariencia de todo el sistema). Se retiraron del rol admin:
- SMTP: eliminada por completo del lado empresa (menú, página y endpoints);
  la gestión queda en el superadmin (Correo del Sistema).
- Branding: movida al menú Sistema del superadmin (ruta y endpoints ahora
  requieren rol superadmin).
En el menú del admin de empresa queda Historial en la sección Configuración.

### 11. Manuales de integración de WhatsApp (PDF)
Se incluyen dos manuales nuevos en la carpeta `manuales/`, elaborados a partir de
la documentación oficial de Meta (Cloud API) y del comportamiento real del código:
- **Parte 1 – Integración de WhatsApp Business con Harmony**: procedimiento paso
  a paso para el administrador de la empresa (crear la app en Meta, obtener las
  credenciales, crear el canal, configurar el webhook, probar y pasar a producción),
  con lista de verificación y glosario.
- **Parte 2 – Manual Técnico**: referencia para TI (arquitectura del webhook,
  verificación de firma, plantillas, límites de mensajería, costos por conversación,
  el bot de IA y tabla de solución de problemas).
- **Parte 3 – Puesta en Marcha (Get Started oficial de Meta)**: sigue paso por paso
  la secuencia oficial de la documentación de Meta, con énfasis en la obtención del
  access token. Compara las dos vías que plantea Meta (System User, que es la que
  Harmony admite hoy, y Facebook Login for Business / Embedded Signup), incluye la
  prueba de envío por `curl` para aislar fallas, la tabla que mapea cada credencial
  de Meta a su campo en Harmony, y un anexo con lo que implicaría adoptar Embedded
  Signup para dar de alta clientes en minutos en lugar de ~40 minutos.

Además se corrigió la guía de integración dentro de la aplicación (Canales →
Guía de integración): faltaba el paso para obtener el **App Secret** y aclarar que
ese es el valor que debe registrarse como Webhook Secret del canal. Sin esa
precisión, Meta confirma el webhook pero Harmony descarta todos los mensajes
entrantes por firma inválida — el error más difícil de diagnosticar de toda la
integración.

### 12. Contadores de la Bandeja de Entrada en cero
Los badges de las pestañas (Todos / Abiertos / No leídos) mostraban 0 aunque la
bandeja listara conversaciones. La causa: los contadores contaban solo
`status = 'open'`, mientras que el listado incluye también `pending` — el estado
interno con el que nacen las conversaciones que llegan por webhook y todavía no
tienen agente asignado.

Se unificó el criterio en toda la bandeja: para el usuario existen únicamente dos
estados, **Abiertos** y **No leídos**. El estado interno `pending` ya no se expone
en ninguna parte de la interfaz y se presenta como Abierto:
- Los contadores y los filtros de las pestañas usan exactamente el mismo criterio
  (`open` + `pending`), de modo que el número del badge siempre coincide con lo
  que se lista al hacer clic.
- El badge de estado de cada conversación y el del panel de detalle muestran
  Abierto (o Cerrado), nunca "Pendiente".
- El modal de reasignación masiva ya no pide elegir estados: reasigna todas las
  conversaciones activas del agente y lo explica en pantalla.

### 13. Configuración del webhook al crear canales (crítico)
Crear un canal desde la interfaz producía un canal **inservible para recibir
mensajes**, y la pantalla no mostraba ningún dato del webhook. Tres fallas
encadenadas en el backend:
- No se generaba ni se aceptaba el **secreto del webhook**: quedaba vacío, por lo
  que la verificación del webhook en Meta fallaba siempre (el token nunca podía
  coincidir con una cadena vacía) y toda notificación entrante se descartaba.
- La respuesta de creación no incluía la **dirección del webhook**, así que la UI
  —que ya tenía la pantalla para mostrarla— nunca la desplegaba.
- El listado de canales tampoco devolvía esa dirección ni el estado de las
  credenciales, de modo que las tarjetas aparecían sin los datos de integración.

Correcciones aplicadas:
- El canal ahora devuelve `webhook_url`, `webhook_secret` y `credential_flags`
  (qué credenciales están guardadas, sin exponer sus valores) al crearse, al
  editarse y en el listado.
- El formulario incorpora el campo **App Secret (secreto del webhook)** para los
  canales de Meta, con la advertencia de que ese mismo valor es el token de
  verificación y de qué ocurre si no coincide.
- Si no se indica un secreto, se genera uno aleatorio para que el canal quede
  operativo (suficiente para Telegram; en Meta debe reemplazarse por el App Secret).
- Editar un canal permite corregir el secreto y actualizar credenciales sueltas
  (por ejemplo el Phone Number ID al pasar a producción) sin borrar las demás.
- Los canales ahora aceptan cambio de departamento al editarlos.

**Acción requerida tras actualizar:** los canales creados con la versión anterior
tienen el secreto vacío. Entre a Canales → Editar en cada uno, pegue el App Secret
de la app de Meta y vuelva a verificar el webhook en el panel de Meta.

### 14. Diagnóstico de canales ("Probar canal")
Nuevo botón en cada tarjeta de la pantalla de Canales que verifica la integración
de punta a punta y explica en lenguaje claro qué está mal y cómo arreglarlo. Todas
las comprobaciones son de solo lectura: nunca envían mensajes ni modifican nada en
la plataforma externa.

Qué comprueba, según el tipo de canal:
- **Todos**: que el canal esté habilitado, y el webhook de Harmony (pide el
  desafío igual que lo hace Meta). Si la dirección pública no es alcanzable desde
  el servidor, reintenta contra el API local para distinguir un problema de
  red/proxy de una falla real del endpoint.
- **WhatsApp**: credenciales presentes; validez del Access Token consultando el
  número en la Graph API (detecta tokens temporales ya expirados); datos y estado
  de verificación del número; calificación de calidad (alta / media / baja); y que
  exista al menos una aplicación suscrita a la cuenta de WhatsApp, sin lo cual Meta
  no entrega los mensajes.
- **Messenger e Instagram**: credenciales presentes y validez del token de la página.
- **Telegram**: validez del Bot Token, y si el webhook está registrado en Telegram
  junto con el último error de entrega que Telegram haya reportado.

Cada resultado se muestra con su estado (correcto / revisar / error) y una
explicación accionable; por ejemplo, un 403 en el webhook indica directamente que
el secreto del canal no coincide con el App Secret.

### 15. Correcciones
- **Mensajes entrantes rechazados por la base de datos**: la tabla `messages`
  no permitía el estado `received` que usa el código para todo mensaje
  entrante, por lo que los webhooks de WhatsApp/Telegram fallaban con error
  500 al recibir mensajes. Corregido en la migración y en el script
  `02_empresas_existentes.sql`.
- **Pantalla en blanco al entrar a Campañas**: navegar Canales → Campañas (o
  Plantillas/Precios WA → Campañas) dejaba la aplicación en blanco hasta
  refrescar. Era un choque de formatos en la caché del frontend; se normalizó
  el formato compartido y se agregó una pantalla de error con botón de recarga
  para que ningún error futuro vuelva a dejar la app en blanco.
- **Aprovisionamiento de empresas nuevas reparado**: la migración 001 definía
  versiones viejas de `whatsapp_pricing`, `pub_agents` y `pub_comments` que
  chocaban con las migraciones 003/006/007/009 y hacían fallar con error 500
  la creación de cualquier empresa nueva.
- **Lista de empresas vacía**: el endpoint devolvía un formato que el frontend
  no entendía; ahora responde `{data: [...]}` como el resto de la API.
- **Textos corruptos** ("GestiÃ³n" → "Gestión") corregidos en la pantalla de
  Empresas.
- **Logo/favicon públicos**: los archivos de `uploads/system/` se sirven sin
  sesión para que el logo se vea en la pantalla de login.
- **Responsive del superadmin**: el modal de empresa limita su altura al 90%
  de la pantalla con scroll interno, los campos se apilan en móvil y ninguna
  página desborda horizontalmente.

---

## Pasos de actualización

> **Antes de empezar: respaldar las bases de datos.**
>
> ```
> pg_dump -U harmony -Fc harmony_system > respaldo_harmony_system.dump
> pg_dump -U harmony -Fc harmony_c1     > respaldo_harmony_c1.dump      (repetir por cada empresa)
> ```

### Paso 1 — Detener el servicio del API

Detener el proceso/servicio que ejecuta el binario del API.

### Paso 2 — Actualizar la base del sistema

```
psql -U harmony -d harmony_system -f sql/01_harmony_system.sql
```

### Paso 3 — Corregir las bases de empresa existentes

Ejecutar en **cada** base `harmony_cN`:

```
psql -U harmony -d harmony_c1 -f sql/02_empresas_existentes.sql
psql -U harmony -d harmony_c2 -f sql/02_empresas_existentes.sql
...
```

El script solo actúa si detecta el esquema viejo (verás un `NOTICE` por cada
tabla corregida); si la base ya está bien, no toca nada. Nota: las tablas con
esquema viejo correspondían a funcionalidades que daban error con ese esquema
(tarifas WhatsApp, agentes IA de publicaciones, comentarios de redes), por lo
que no contienen datos de producción reales.

### Paso 4 — Reemplazar el binario del API

Copiar el binario correspondiente al sistema operativo del servidor
(`bin/harmony-api-linux` o `bin/harmony-api-windows.exe`) sobre el binario
actual y reiniciar el servicio.

En Linux no olvidar: `chmod +x harmony-api-linux`

> Si en producción compilan desde código fuente en lugar de usar el binario,
> basta con copiar el código actualizado y ejecutar
> `go build -o harmony-api ./cmd/server`.

El `.env` **no requiere cambios** (no hay variables nuevas).

### Paso 5 — Reemplazar el frontend

Sustituir el contenido de la carpeta que sirve el frontend (normalmente
`dist/`) por el contenido de `web-dist/` de este paquete.

**Importante**: el servidor web (nginx/Apache/IIS) debe reenviar las rutas
`/uploads/*` al API (puerto 8080), igual que ya hace con `/api/*` y `/ws`.
Si la regla de `/uploads` no existe, agregarla; sin ella el logo del sistema
no se mostrará.

### Paso 6 — Configuración posterior (en la interfaz, como superadmin)

1. **Correo del Sistema** → ingresar los datos SMTP reales y usar
   "Enviar prueba" para verificar. Sin esto no salen ni el correo de
   recuperación de contraseña ni los avisos de retención.
2. **Configuración del Sistema** → subir el logo de la plataforma.
3. **Empresas → Editar** → completar Nombre del Encargado, Correo y Teléfono
   de las empresas existentes (quedaron vacíos tras la migración) y definir
   la retención de historial deseada.
4. (Opcional) **Correo del Sistema → Aviso de eliminación de historial** →
   personalizar la plantilla del aviso.

### Verificación rápida

- `GET /api/system-config` debe responder con `app_name`, `favicon_url` y
  `logo_url`.
- En el log del API al arrancar debe aparecer:
  `✓ Job de retención de historial iniciado`.
- Crear una empresa de prueba desde el superadmin: debe pedir los datos del
  encargado y crearse sin error 500 (y poder eliminarse el registro después).

---

## Advertencias

- La purga de retención es **definitiva** (hard delete, sin papelera). El
  aviso da 5 días de margen; si el correo del aviso falla (SMTP mal
  configurado o encargado sin correo), la eliminación **se ejecuta igual** al
  cumplirse el plazo, para que la política de retención se cumpla.
- La configuración SMTP de la pantalla de empresa (admin) y la del superadmin
  escriben sobre la **misma cuenta global**; hoy todas las empresas comparten
  la cuenta de correo del sistema.
