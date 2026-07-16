// IntegrationGuidePage — Manuales de integración de canales de comunicación.
//
// Contiene instrucciones paso a paso para conectar cada plataforma con Harmony:
//   - WhatsApp Business (Meta Cloud API)
//   - Facebook Messenger (Meta Graph API)
//   - Instagram (Meta Graph API)
//   - Telegram (Bot API)
//
// La página usa tabs para cambiar entre los 4 manuales. Cada paso incluye
// un número de paso numerado con el color de la plataforma y texto explicativo
// detallado con formato HTML (negritas, código inline, listas anidadas).

import { useState } from 'react'
import DOMPurify from 'dompurify'
import { BookOpen, Download } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ChannelKey = 'whatsapp' | 'messenger' | 'instagram' | 'telegram'

interface GuideStep {
  num: string
  title: string
  steps: string[]
}

interface ChannelGuide {
  key: ChannelKey
  label: string
  color: string
  headerBg: string
  lightBg: string
  divideColor: string
  textLight: string
  textDark: string
  headerSub: string
  difficulty: string
  time: string
  requirement: string
  svgPath: string
  steps: GuideStep[]
  requiredFields: { label: string; desc: string }[]
  warningNote?: string
  infoNote?: string
}

// ─── Datos de los manuales ────────────────────────────────────────────────────

const GUIDES: ChannelGuide[] = [
  // ── WhatsApp ──────────────────────────────────────────────────────────────
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    color: '#25D366',
    headerBg: '#25D366',
    lightBg: 'bg-green-50',
    divideColor: 'divide-green-200',
    textLight: 'text-green-700',
    textDark: 'text-green-800',
    headerSub: 'Requiere cuenta Meta for Developers · developers.facebook.com',
    difficulty: 'Media',
    time: '20 – 40 minutos',
    requirement: 'Número exclusivo para API',
    svgPath: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.117.549 4.103 1.51 5.829L0 24l6.335-1.493A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.017-1.375l-.36-.214-3.732.979.996-3.638-.234-.374A9.818 9.818 0 1112 21.818z',
    steps: [
      { num: '01', title: 'Crear una app en Meta for Developers', steps: [
        'Abrí <strong>developers.facebook.com</strong> e iniciá sesión con tu cuenta de Facebook (preferiblemente la del administrador de la empresa).',
        'Hacé clic en <strong>Mis apps → Crear app</strong>.',
        'En "¿Para qué usarás tu app?", seleccioná <strong>Otro</strong> y presioná Siguiente.',
        'Elegí el tipo <strong>Empresa</strong> y presioná Siguiente.',
        'Completá el nombre de la app (ej: <em>Harmony Soporte</em>), tu correo de contacto y la <strong>Cuenta Business de Meta</strong>. Presioná <strong>Crear app</strong>.',
        '<strong>Importante:</strong> si no tenés Cuenta Business, primero creá una en <em>business.facebook.com</em>.',
      ]},
      { num: '02', title: 'Agregar el producto WhatsApp a la app', steps: [
        'Dentro del panel de tu app, en el menú izquierdo hacé clic en <strong>Agregar producto</strong>.',
        'Buscá <strong>WhatsApp</strong> y presioná <strong>Configurar</strong>.',
        'Si se te pide vincular una Cuenta WhatsApp Business (WABA), podés elegir una existente o crear una nueva.',
        'Aceptá las condiciones de uso de la API de WhatsApp Business.',
      ]},
      { num: '03', title: 'Obtener el Phone Number ID y el WABA ID', steps: [
        'En el menú izquierdo, ir a <strong>WhatsApp → Inicio de la API</strong>.',
        'Hacé clic en el número y buscá el campo <strong>Phone Number ID</strong> (número largo, ej: 123456789012345). Copialo y guardalo.',
        'El <strong>WhatsApp Business Account ID (WABA ID)</strong> está en esa misma página o en <strong>WhatsApp → Configuración</strong>. Copialo y guardalo.',
        '<strong>Consejo:</strong> también podés verlo en <em>business.facebook.com → Configuración → Cuentas de WhatsApp</em>.',
      ]},
      { num: '04', title: 'Generar un Access Token permanente', steps: [
        'Un token temporal (válido 24h) sirve para pruebas, <strong>no para producción</strong>.',
        'Para token permanente: en <em>business.facebook.com</em> ir a <strong>Configuración → Usuarios del sistema</strong>.',
        'Creá un <strong>Usuario del sistema administrador</strong> (o usá uno existente).',
        'Hacé clic en <strong>Generar nuevo token</strong>, seleccioná tu app y marcá los permisos: <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">whatsapp_business_messaging</code> y <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">whatsapp_business_management</code>.',
        'Copiá el token generado. No caduca mientras el Usuario del sistema esté activo.',
        '<strong>Nunca compartás este token.</strong> Tratalo como una contraseña.',
      ]},
      { num: '05', title: 'Crear el canal en Harmony', steps: [
        'En Harmony ir a <strong>Canales → Nuevo canal</strong> y seleccioná <strong>WhatsApp</strong>.',
        'Completá: Número de teléfono (ej: +50688881234), Phone Number ID, WABA ID y Access Token.',
        'Hacé clic en <strong>Guardar Canal</strong>.',
        'Copiá la <strong>URL del webhook</strong> que aparece en la tarjeta del canal.',
      ]},
      { num: '06', title: 'Configurar el webhook en Meta', steps: [
        'En Meta for Developers, ir a <strong>WhatsApp → Configuración → Webhooks</strong>.',
        'Hacé clic en <strong>Editar</strong> junto a "URL de devolución de llamada".',
        'Pegá la URL del webhook de Harmony y en <strong>Token de verificación</strong> ingresá el Webhook Secret del canal.',
        'Presioná <strong>Verificar y guardar</strong>. Si el servidor es accesible, dirá "¡Éxito!".',
        'Hacé clic en <strong>Administrar</strong> y activá las suscripciones: <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">messages</code> y <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">messaging_handovers</code>.',
        'En <strong>WhatsApp → Configuración → Número de teléfono</strong>, presioná <strong>Suscribirse</strong>.',
      ]},
      { num: '07', title: 'Pasar la app a Producción (números reales)', steps: [
        'Con el número de prueba podés recibir mensajes de hasta 5 números verificados. Para producción necesitás un número real.',
        'En Meta for Developers, ir a <strong>WhatsApp → Inicio de la API → Agregar número de teléfono</strong>.',
        'El número <strong>no puede tener WhatsApp normal instalado</strong>. Usá un número exclusivo para la API.',
        'Para quitar el límite de 1.000 conversaciones/día, verificá tu empresa en <em>business.facebook.com</em>.',
        'Cambiá el modo de la app de <strong>Desarrollo</strong> a <strong>Activo</strong> en la configuración.',
      ]},
    ],
    requiredFields: [
      { label: 'Phone Number ID', desc: 'ID numérico del número en Meta' },
      { label: 'WABA ID',         desc: 'WhatsApp Business Account ID' },
      { label: 'Access Token',    desc: 'Token permanente de usuario del sistema' },
    ],
  },

  // ── Messenger ─────────────────────────────────────────────────────────────
  {
    key: 'messenger',
    label: 'Messenger',
    color: '#0099FF',
    headerBg: '#0099FF',
    lightBg: 'bg-blue-50',
    divideColor: 'divide-blue-200',
    textLight: 'text-blue-700',
    textDark: 'text-blue-800',
    headerSub: 'Requiere Página de Facebook y cuenta Meta for Developers',
    difficulty: 'Media',
    time: '15 – 30 minutos',
    requirement: 'Página de Facebook activa',
    svgPath: 'M12 0C5.373 0 0 5.176 0 11.553c0 3.639 1.815 6.883 4.65 9.017V24l4.245-2.33c1.134.314 2.336.484 3.567.484 6.627 0 12-5.176 12-11.553C24 5.176 18.627 0 12 0zm1.194 15.553l-3.055-3.256-5.96 3.256L10.732 9l3.13 3.256L19.696 9l-6.502 6.553z',
    steps: [
      { num: '01', title: 'Crear o tener una Página de Facebook', steps: [
        'Necesitás una <strong>Página de Facebook</strong> (no perfil personal) que represente a tu empresa.',
        'Si no tenés una, ir a <em>facebook.com/pages/create</em> y creá una del tipo "Empresa o marca".',
        'La página debe estar <strong>publicada</strong> (no en modo sin publicar).',
        'Necesitás rol de <strong>Administrador</strong> en esa página.',
      ]},
      { num: '02', title: 'Crear la app en Meta for Developers', steps: [
        'Ir a <strong>developers.facebook.com</strong> e iniciá sesión.',
        'Clic en <strong>Mis apps → Crear app</strong> → tipo <strong>Empresa</strong>.',
        'En <strong>Agregar producto</strong> buscá <strong>Messenger</strong> y presioná <strong>Configurar</strong>.',
      ]},
      { num: '03', title: 'Vincular la Página de Facebook a la app', steps: [
        'En el menú izquierdo, ir a <strong>Messenger → Configuración de la API de Messenger</strong>.',
        'En "Tokens de acceso", hacé clic en <strong>Agregar o quitar páginas</strong>.',
        'Autenticá con tu cuenta de Facebook y seleccioná la página que querés vincular.',
        'Aceptá los permisos: <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">pages_messaging</code>, <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">pages_read_engagement</code>.',
      ]},
      { num: '04', title: 'Obtener el Page ID y el Page Access Token', steps: [
        '<strong>Page ID:</strong> en Facebook, abrí tu página → <strong>Acerca de</strong> → "ID de página" al final.',
        '<strong>Token temporal:</strong> en Messenger → Configuración → presioná <strong>Generar token</strong>. Caduca, no usar en producción.',
        '<strong>Token permanente (recomendado):</strong> en <em>business.facebook.com → Usuarios del sistema</em>, creá un usuario admin, asignale la página, generá el token con permiso <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">pages_messaging</code>.',
      ]},
      { num: '05', title: 'Crear el canal en Harmony', steps: [
        'En Harmony ir a <strong>Canales → Nuevo canal → Messenger</strong>.',
        'Completá: ID de página y Page Access Token permanente.',
        'Guardá el canal. Copiá la <strong>URL del webhook</strong> generada.',
      ]},
      { num: '06', title: 'Configurar el webhook en Meta', steps: [
        'En Meta for Developers, ir a <strong>Messenger → Configuración → Webhooks</strong>.',
        'Presioná <strong>Agregar URL de devolución de llamada</strong>.',
        'Pegá la URL del webhook de Harmony y el Webhook Secret del canal.',
        'Presioná <strong>Verificar y guardar</strong>.',
        'En "Suscripciones de webhook", activá: <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">messages</code>, <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">messaging_postbacks</code>, <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">messaging_optins</code>.',
      ]},
      { num: '07', title: 'Solicitar revisión de app (para todos los usuarios)', steps: [
        'En modo Desarrollo, solo cuentas con rol en la app pueden enviar/recibir mensajes.',
        'Para recibir mensajes de cualquier usuario, la app debe estar en modo <strong>Activo</strong> con el permiso <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">pages_messaging</code> aprobado.',
        'Ir a <strong>Revisión de la app → Permisos y funciones</strong> → buscá <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">pages_messaging</code> → <strong>Solicitar</strong>.',
        'Meta puede tardar de 1 a 5 días hábiles. Una vez aprobado, cambiá la app a modo <strong>Activo</strong>.',
      ]},
    ],
    requiredFields: [
      { label: 'Page ID',           desc: 'ID numérico de la Página de Facebook' },
      { label: 'Page Access Token', desc: 'Token permanente con permiso pages_messaging' },
    ],
  },

  // ── Instagram ─────────────────────────────────────────────────────────────
  {
    key: 'instagram',
    label: 'Instagram',
    color: '#C13584',
    headerBg: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af,#515bd4)',
    lightBg: 'bg-purple-50',
    divideColor: 'divide-purple-200',
    textLight: 'text-purple-700',
    textDark: 'text-purple-800',
    headerSub: 'Requiere cuenta Instagram Business vinculada a Página de Facebook',
    difficulty: 'Alta',
    time: '30 – 60 minutos',
    requirement: 'Instagram Business + Página FB',
    svgPath: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z',
    warningNote: 'Instagram Messages API <strong>solo funciona con cuentas Instagram de tipo Business o Creador</strong>, vinculadas a una <strong>Página de Facebook</strong>. Cuentas personales no son compatibles.',
    steps: [
      { num: '01', title: 'Convertir la cuenta Instagram a Business o Creador', steps: [
        'Abrí la app de Instagram en tu teléfono.',
        'Ir a <strong>Perfil → Menú (☰) → Configuración y privacidad → Tipo de cuenta y herramientas</strong>.',
        'Seleccioná <strong>Cambiar a cuenta profesional → Empresa</strong>.',
        'Completá la categoría de tu negocio.',
      ]},
      { num: '02', title: 'Vincular la cuenta Instagram a una Página de Facebook', steps: [
        'Desde Instagram: <strong>Perfil → Editar perfil → Página</strong> → seleccioná tu Página de Facebook.',
        'Alternativa desde Facebook: en tu Página → <strong>Configuración → Instagram → Conectar cuenta</strong>.',
        'Verificá la vinculación: en Página de Facebook → Configuración → Instagram debe aparecer la cuenta conectada.',
      ]},
      { num: '03', title: 'Crear la app en Meta for Developers y agregar Instagram', steps: [
        'Creá una app de tipo <strong>Empresa</strong> en <em>developers.facebook.com</em>.',
        'En <strong>Agregar producto</strong>, buscá <strong>Instagram</strong> y configuralo.',
        'En "Tokens de acceso para Instagram Business", hacé clic en <strong>Agregar o quitar páginas</strong>.',
        'Autenticá y seleccioná la Página de Facebook vinculada a Instagram.',
      ]},
      { num: '04', title: 'Obtener el Instagram Account ID y el Access Token', steps: [
        '<strong>Instagram Account ID:</strong> está visible en la sección de configuración de la app. También vía API: <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">GET /v19.0/{page_id}?fields=instagram_business_account</code>.',
        '<strong>Token permanente:</strong> en <em>business.facebook.com → Usuarios del sistema</em>, asignale la página y la cuenta de Instagram. Generá el token con permisos: <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">instagram_basic</code>, <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">instagram_manage_messages</code>, <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">pages_messaging</code>.',
      ]},
      { num: '05', title: 'Activar el acceso a mensajes de Instagram', steps: [
        'Desde Instagram: <strong>Configuración → Privacidad → Mensajes → Acceso a mensajes conectados</strong>.',
        'Activá la opción que permite que apps de terceros accedan a los mensajes.',
        'Si no ves esta opción, verificá que la cuenta sea Business y esté vinculada a la página.',
      ]},
      { num: '06', title: 'Crear el canal en Harmony', steps: [
        'En Harmony ir a <strong>Canales → Nuevo canal → Instagram</strong>.',
        'Completá: Instagram Account ID y Page Access Token permanente.',
        'Guardá el canal. Copiá la URL del webhook.',
      ]},
      { num: '07', title: 'Configurar el webhook y solicitar revisión', steps: [
        'En Meta for Developers ir a <strong>Webhooks</strong> y agregá la URL del webhook de Harmony.',
        'Suscribite a los campos: <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">messages</code>, <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">messaging_seen</code>.',
        'En <strong>Revisión de app</strong>, solicitá los permisos <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">instagram_basic</code> e <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">instagram_manage_messages</code>.',
      ]},
    ],
    requiredFields: [
      { label: 'Instagram Account ID', desc: 'ID numérico de la cuenta Business de Instagram' },
      { label: 'Page Access Token',    desc: 'Token permanente con permisos instagram_manage_messages' },
    ],
  },

  // ── Telegram ──────────────────────────────────────────────────────────────
  {
    key: 'telegram',
    label: 'Telegram',
    color: '#229ED9',
    headerBg: '#229ED9',
    lightBg: 'bg-sky-50',
    divideColor: 'divide-sky-200',
    textLight: 'text-sky-700',
    textDark: 'text-sky-800',
    headerSub: 'El más simple · Solo necesitás el Bot Token · Webhook automático',
    difficulty: 'Baja',
    time: '5 – 10 minutos',
    requirement: 'Solo una cuenta de Telegram',
    svgPath: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
    infoNote: 'Telegram es el canal más fácil. <strong>El webhook se registra automáticamente</strong> cuando guardás el canal en Harmony — no necesitás configurar nada adicional en Telegram.',
    steps: [
      { num: '01', title: 'Abrir Telegram y buscar @BotFather', steps: [
        'Abrí la aplicación de Telegram (teléfono, escritorio o <em>web.telegram.org</em>).',
        'En el buscador de Telegram, buscá <strong>@BotFather</strong>. Es la cuenta oficial con el escudo azul de verificación.',
        'Iniciá una conversación con @BotFather.',
      ]},
      { num: '02', title: 'Crear el bot con @BotFather', steps: [
        'Enviá el comando: <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">/newbot</code>',
        'BotFather te pedirá el <strong>nombre del bot</strong> (ej: <em>Soporte Harmony</em>). Podés usar espacios.',
        'Luego el <strong>username</strong>: debe terminar en <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">bot</code> y sin espacios (ej: <em>SoporteHarmonyBot</em>). Debe ser único.',
        'BotFather te responderá con el <strong>Bot Token HTTP API</strong>. Formato: <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">123456789:ABCdefGHIjklmNOPqrstUVwxyz</code>',
        'Copiá el token. Si lo perdés, podés generarlo de nuevo con <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">/token</code> en @BotFather.',
      ]},
      { num: '03', title: 'Configurar opciones del bot (opcional pero recomendado)', steps: [
        '<strong>Descripción:</strong> enviá <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">/setdescription</code>, seleccioná tu bot y escribí la descripción.',
        '<strong>Foto de perfil:</strong> enviá <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">/setuserpic</code> y enviá la imagen de tu empresa.',
        '<strong>Modo privacidad:</strong> por defecto el bot solo recibe mensajes directos, que es lo correcto para soporte al cliente.',
      ]},
      { num: '04', title: 'Crear el canal en Harmony', steps: [
        'En Harmony ir a <strong>Canales → Nuevo canal → Telegram</strong>.',
        'Completá el campo <strong>Bot Token</strong> con el token completo de @BotFather.',
        'Hacé clic en <strong>Guardar Canal</strong>.',
        'Harmony llamará automáticamente a <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">setWebhook</code> en la API de Telegram. No necesitás hacer nada más.',
        'Verificá que el canal quede con estado <strong>Activo</strong> en la lista de canales.',
      ]},
      { num: '05', title: 'Verificar que el webhook quedó activo', steps: [
        'Para verificar manualmente, abrí en tu navegador:',
        '<code class="block mt-1 mb-1 bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-lg text-xs font-mono">https://api.telegram.org/bot{TU_TOKEN}/getWebhookInfo</code>',
        'Deberías ver <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">"url": "https://tudominio.com/api/webhooks/telegram/ID"</code> y <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">"pending_update_count": 0</code>.',
        'Si el campo url está vacío, el webhook no se registró. Verificá que tu servidor sea accesible públicamente con HTTPS.',
      ]},
      { num: '06', title: 'Consideraciones importantes', steps: [
        '<strong>HTTPS obligatorio:</strong> Telegram solo acepta webhooks bajo HTTPS con certificado SSL válido.',
        '<strong>No se puede usar localhost:</strong> el servidor debe tener una IP pública o dominio con HTTPS.',
        '<strong>Un token = un webhook:</strong> cada Bot Token solo puede tener un webhook activo.',
        '<strong>No compartas el token:</strong> cualquiera con el token puede controlar el bot. Si fue comprometido, regeneralo con <code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded text-xs">/token</code>.',
        '<strong>Sin límite ni revisión:</strong> Telegram no requiere aprobación. Cualquier usuario puede escribirle al bot desde el primer momento.',
      ]},
    ],
    requiredFields: [
      { label: 'Bot Token', desc: 'Token HTTP API de @BotFather · formato 123456789:ABCdef...' },
      { label: 'Webhook',   desc: 'Se registra automáticamente al guardar el canal' },
    ],
  },
]

// ─── Íconos SVG inline de cada plataforma ─────────────────────────────────────

function ChannelIcon({ path, size = 28 }: { path: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="fill-white flex-shrink-0">
      <path d={path} />
    </svg>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * IntegrationGuidePage — Manuales de integración de canales.
 * Replica el contenido y diseño de la página de guías de Harmony v2,
 * adaptado a React + TailwindCSS v4.
 */
export default function IntegrationGuidePage() {
  const [activeTab, setActiveTab] = useState<ChannelKey>('whatsapp')

  const guide = GUIDES.find(g => g.key === activeTab)!

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <BookOpen size={24} className="text-gray-400" />
            Manuales de integración de canales
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Instrucciones paso a paso para conectar cada plataforma con Harmony.
            Seguí el manual de tu canal antes de crear el canal en el sistema.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-xl shadow-sm hover:opacity-90 transition-opacity flex-shrink-0 print:hidden"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Download size={15} />
          Descargar PDF
        </button>
      </div>

      {/* Tabs de selección de canal */}
      <div className="flex gap-2 flex-wrap">
        {GUIDES.map(g => {
          const isActive = g.key === activeTab
          return (
            <button
              key={g.key}
              onClick={() => setActiveTab(g.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
                !isActive ? 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300' : ''
              }`}
              style={isActive
                ? { background: g.color, borderColor: g.color, color: 'white' }
                : {}
              }
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: isActive ? 'rgba(255,255,255,0.25)' : g.color }}
              >
                <ChannelIcon path={g.svgPath} size={12} />
              </span>
              {g.label}
            </button>
          )
        })}
      </div>

      {/* ── Cabecera del canal seleccionado ─────────────────────────────────── */}
      <div className="rounded-2xl border-2 overflow-hidden" style={{ borderColor: guide.color }}>
        <div className="px-6 py-4 flex items-center gap-3" style={{ background: guide.headerBg }}>
          <ChannelIcon path={guide.svgPath} size={28} />
          <div>
            <p className="text-white font-bold text-lg">{guide.label}</p>
            <p className="text-white/80 text-sm">{guide.headerSub}</p>
          </div>
        </div>
        <div className="px-2 py-3 dark:bg-gray-800/80" style={{ backgroundColor: guide.color + '12' }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 sm:divide-x text-center" style={{ borderColor: guide.color + '33' }}>
            {[
              { label: 'Dificultad',      value: guide.difficulty },
              { label: 'Tiempo estimado', value: guide.time },
              { label: 'Requisito',       value: guide.requirement },
            ].map(item => (
              <div key={item.label} className="px-4 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</p>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-200 mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Nota de advertencia (Instagram) */}
      {guide.warningNote && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl px-5 py-4 flex gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div className="text-sm text-amber-800">
            <p className="font-semibold">Requisito obligatorio</p>
            <p className="mt-0.5" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(guide.warningNote) }} />
          </div>
        </div>
      )}

      {/* Nota informativa (Telegram) */}
      {guide.infoNote && (
        <div className={`${guide.lightBg} border rounded-2xl px-5 py-4 flex gap-3`} style={{ borderColor: guide.color + '66' }}>
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: guide.color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm" style={{ color: guide.color === '#229ED9' ? '#0c4a6e' : '#1e1b4b' }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(guide.infoNote) }} />
        </div>
      )}

      {/* ── Pasos del manual ────────────────────────────────────────────────── */}
      {guide.steps.map(step => (
        <div key={step.num} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          {/* Encabezado del paso */}
          <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
              style={{ background: guide.color }}
            >
              {step.num}
            </span>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-base">{step.title}</h3>
          </div>
          {/* Lista de instrucciones */}
          <div className="px-6 py-5">
            <ol className="space-y-3">
              {step.steps.map((s, i) => {
                // Las instrucciones que son bloques de código o listas no llevan número
                const isBlock = s.startsWith('<code class="block') || s.startsWith('<ul')
                return (
                  <li key={i} className="flex gap-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {!isBlock ? (
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold text-white mt-0.5"
                        style={{ background: guide.color + '99' }}
                      >
                        {i + 1}
                      </span>
                    ) : (
                      <span className="w-5 flex-shrink-0" />
                    )}
                    <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(s) }} />
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      ))}

      {/* ── Campos requeridos en Harmony ───────────────────────────────────── */}
      <div
        className="border rounded-2xl px-6 py-4 space-y-3 dark:bg-gray-800/60"
        style={{ borderColor: guide.color + '66', backgroundColor: guide.color + '18' }}
      >
        <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">
          Campos requeridos en Harmony — {guide.label}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {guide.requiredFields.map(f => (
            <div
              key={f.label}
              className="bg-white dark:bg-gray-800 rounded-xl px-4 py-3"
              style={{ border: `1px solid ${guide.color}66` }}
            >
              <p className="text-xs font-bold text-gray-800 dark:text-gray-200">{f.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Notas generales para todos los canales ──────────────────────────── */}
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-6 py-5">
        <p className="font-semibold text-gray-800 dark:text-gray-200 text-sm mb-3">Notas generales para todos los canales</p>
        <ul className="space-y-2.5 text-sm text-gray-600 dark:text-gray-400">
          {[
            '<strong>HTTPS obligatorio:</strong> los webhooks de Meta y Telegram requieren HTTPS con certificado SSL válido. No funcionan en HTTP ni con localhost sin tunelización.',
            '<strong>Tokens como contraseñas:</strong> nunca compartás Access Tokens, Bot Tokens ni API Keys. Si sospechas que fueron comprometidos, regeneralos de inmediato.',
            '<strong>Un canal = un número/cuenta:</strong> no podés conectar el mismo número de WhatsApp o la misma cuenta de Instagram en dos sistemas al mismo tiempo.',
            '<strong>Credenciales encriptadas:</strong> Harmony encripta todas las credenciales antes de guardarlas. Los tokens nunca se muestran en texto plano después de guardar.',
          ].map((note, i) => (
            <li key={i} className="flex gap-2.5">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note) }} />
            </li>
          ))}
        </ul>
      </div>

    </div>
  )
}
