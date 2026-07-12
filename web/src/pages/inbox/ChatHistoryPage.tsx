import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Eye } from 'lucide-react'
import api from '@/api/client'

// ─── Descripción ──────────────────────────────────────────────────────────────
//
// ChatHistoryPage — Página de historial de conversaciones por contacto.
//
// Permite al operador buscar el historial completo de un contacto específico
// ingresando su nombre y/o número de teléfono. El resultado muestra:
//   - Una tarjeta con los datos del contacto (nombre, teléfono, total de casos).
//   - Una tabla con todas las conversaciones del contacto, incluyendo canal,
//     agente asignado, etiquetas, estado y fecha del último mensaje.
//
// Flujo de búsqueda:
//   1. El usuario ingresa nombre y/o teléfono y presiona "Buscar" (o Enter).
//   2. Se actualiza lastSearchRef con los valores actuales antes de llamar a refetch().
//      Esto garantiza que la queryKey y los params enviados al backend sean siempre
//      los del último intento de búsqueda, evitando resultados obsoletos.
//   3. La query está en modo `enabled: false` (manual), por lo que solo se ejecuta
//      cuando se llama explícitamente a refetch().
//   4. Se evalúa el estado notFound para mostrar el mensaje de "no encontrado"
//      solo después de que la búsqueda finalizó sin resultados.
//
// Dependencias clave:
//   - @tanstack/react-query  → caché y disparo manual de queries
//   - api (axios)            → cliente HTTP configurado con token Bearer
//
// ──────────────────────────────────────────────────────────────────────────────

// ─── Types ────────────────────────────────────────────────────────────────────

// Tipos de canal de mensajería soportados en la plataforma
type ChannelType = 'whatsapp' | 'telegram' | 'messenger' | 'instagram' | 'sms' | 'email'

interface Tag {
  id: number
  name: string
  color: string   // Color hexadecimal para el badge de la etiqueta
}

interface Agent {
  id: number
  name: string
  is_bot?: boolean  // true si el agente es un bot de IA en lugar de un humano
}

interface Channel {
  id: number
  name: string
  type: ChannelType
}

interface ContactInfo {
  id: number
  name: string
  phone?: string
}

interface Conversation {
  id: number
  case_number: string
  status: 'open' | 'pending' | 'closed'
  last_message_at?: string
  channel?: Channel
  agent?: Agent
  tags: Tag[]
}

// Estructura de la respuesta del endpoint /chat-history
interface ContactHistoryResponse {
  contact: ContactInfo
  conversations: {
    data: Conversation[]
    total: number
    current_page: number
    last_page: number
  }
}

// ─── Channel badge ─────────────────────────────────────────────────────────────

// Color de fondo del ícono de canal. Instagram usa un degradado radial en lugar
// de un color plano porque su identidad visual lo requiere.
const CHANNEL_COLORS: Record<ChannelType, string> = {
  whatsapp: '#25D366',
  telegram: '#229ED9',
  messenger: '#0099FF',
  instagram: 'radial-gradient(circle at 30% 107%,#fdf497 0%,#fdf497 5%,#fd5949 45%,#d6249f 60%,#285AEB 90%)',
  sms: '#6B7280',
  email: '#8B5CF6',
}

// Paths SVG de los íconos de cada canal (inlined para evitar dependencias externas
// y cumplir con la CSP que bloquea recursos de red en los Artifacts).
// WhatsApp SVG path
const WA_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.117.549 4.103 1.51 5.829L0 24l6.335-1.493A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.017-1.375l-.36-.214-3.732.979.996-3.638-.234-.374A9.818 9.818 0 1112 21.818z'
// Telegram SVG path
const TG_PATH = 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'
// Messenger SVG path
const MS_PATH = 'M12 0C5.373 0 0 5.176 0 11.553c0 3.639 1.815 6.883 4.65 9.017V24l4.245-2.33c1.134.314 2.336.484 3.567.484 6.627 0 12-5.176 12-11.553C24 5.176 18.627 0 12 0zm1.194 15.553l-3.055-3.256-5.96 3.256L10.732 9l3.13 3.256L19.696 9l-6.502 6.553z'
// Instagram SVG path
const IG_PATH = 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z'

/**
 * Muestra un ícono circular del canal de mensajería junto al nombre del canal.
 * Para WhatsApp, Telegram, Messenger e Instagram renderiza el SVG oficial de la marca.
 * Para SMS y Email solo muestra el círculo de color sin ícono interno.
 *
 * @param type - Tipo de canal ('whatsapp' | 'telegram' | 'messenger' | 'instagram' | 'sms' | 'email').
 * @param name - Nombre legible del canal para mostrar junto al ícono.
 */
function ChannelDot({ type, name }: { type: ChannelType; name: string }) {
  // Selecciona el path SVG correspondiente al tipo de canal; null = sin ícono interno
  const svgPath = type === 'whatsapp' ? WA_PATH
    : type === 'telegram' ? TG_PATH
    : type === 'messenger' ? MS_PATH
    : type === 'instagram' ? IG_PATH
    : null

  // Usa el color del mapa; fallback gris si el tipo no está registrado
  const bg = CHANNEL_COLORS[type] ?? '#6B7280'

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: bg }}
      >
        {svgPath && (
          <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white">
            <path d={svgPath} />
          </svg>
        )}
      </span>
      <span className="text-xs text-gray-600 dark:text-gray-300">{name}</span>
    </div>
  )
}

// ─── Status badge ──────────────────────────────────────────────────────────────

// Configuración de apariencia por estado de conversación.
// 'pending' corresponde a conversaciones no leídas esperando atención.
const STATUS_CFG = {
  open:    { label: 'Abierto',  cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  pending: { label: 'No leído', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' },
  closed:  { label: 'Cerrado',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
} as const

/**
 * Muestra un pill (badge) coloreado con el estado de una conversación.
 *
 * @param status - Estado de la conversación: 'open' | 'pending' | 'closed'.
 *                 Si el valor no existe en STATUS_CFG, se usa 'closed' como fallback.
 */
function StatusBadge({ status }: { status: 'open' | 'pending' | 'closed' }) {
  // Fallback a 'closed' si el estado recibido no está en la configuración
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.closed
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Genera las iniciales de un nombre completo (máximo 2 palabras).
 * Se usa para el avatar del contacto cuando no hay foto disponible.
 *
 * @param name - Nombre completo del contacto.
 * @returns    String de 1-2 caracteres en mayúsculas, o '?' si el nombre es vacío.
 */
function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
}

/**
 * Formatea una fecha ISO 8601 a una cadena localizada en español (Costa Rica).
 * Muestra: día/mes/año hora:minuto — formato compacto para tablas.
 *
 * @param iso - Cadena de fecha ISO opcional (ej. "2026-06-28T14:30:00Z").
 * @returns   Fecha formateada en es-CR, o '—' si el valor es undefined/null.
 */
function formatDatetime(iso?: string) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-CR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * Página de Historial de Chat.
 *
 * Ofrece un buscador por nombre y/o teléfono que consulta el historial
 * completo de conversaciones de un contacto. La búsqueda es manual
 * (no se dispara automáticamente al tipear) para evitar peticiones excesivas.
 *
 * Estados de la UI:
 *   - Sin búsqueda aún    → pantalla vacía con ilustración y descripción.
 *   - Buscando            → el botón muestra "Buscando..." y está deshabilitado.
 *   - Sin resultados      → mensaje de "no encontrado" con sugerencia de formato.
 *   - Con resultados      → tarjeta del contacto + tabla de conversaciones.
 */
export default function ChatHistoryPage() {
  const navigate = useNavigate()
  const [urlParams, setUrlParams] = useSearchParams()

  // Inicializar los inputs desde la URL para restaurar la búsqueda al volver atrás
  const [name, setName]   = useState(() => urlParams.get('name')  ?? '')
  const [phone, setPhone] = useState(() => urlParams.get('phone') ?? '')

  // Si la URL ya trae parámetros (ej. al presionar Atrás), la búsqueda se considera enviada
  const [submitted, setSubmitted] = useState(() =>
    !!(urlParams.get('name') || urlParams.get('phone'))
  )

  // searchQuery refleja los parámetros confirmados que se usan en la queryKey
  const [searchQuery, setSearchQuery] = useState<{ name: string; phone: string } | null>(() => {
    const n = urlParams.get('name') ?? ''
    const p = urlParams.get('phone') ?? ''
    return (n || p) ? { name: n, phone: p } : null
  })

  // Sincronizar los inputs si la URL cambia externamente (ej. navegación del historial)
  useEffect(() => {
    const n = urlParams.get('name')  ?? ''
    const p = urlParams.get('phone') ?? ''
    setName(n)
    setPhone(p)
    if (n || p) {
      setSubmitted(true)
      setSearchQuery({ name: n, phone: p })
    }
  }, [urlParams])

  const { data, isFetching } = useQuery<ContactHistoryResponse>({
    queryKey: ['chat-history', searchQuery?.name ?? '', searchQuery?.phone ?? ''],
    queryFn: async () => {
      const res = await api.get('/chat-history', {
        params: {
          name:  searchQuery?.name  || undefined,
          phone: searchQuery?.phone || undefined,
        },
      })
      return res.data
    },
    enabled: !!searchQuery,
    retry: false,
  })

  function handleSearch() {
    if (!name.trim() && !phone.trim()) return
    const n = name.trim().slice(0, 120)
    const p = phone.trim()
    if (p && !/^\+?[\d\s\-().]{6,20}$/.test(p)) return
    setSubmitted(true)
    setSearchQuery({ name: n, phone: p })
    // Guardar en la URL para que el botón Atrás restaure la búsqueda
    const params: Record<string, string> = {}
    if (n) params.name = n
    if (p) params.phone = p
    setUrlParams(params, { replace: false })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch()
  }

  // Extrae los datos de la respuesta con valores por defecto para evitar null checks repetidos
  const contact       = data?.contact ?? null
  const conversations = data?.conversations?.data ?? []
  const total         = data?.conversations?.total ?? 0

  // "no encontrado": se buscó al menos una vez, no está cargando, y no llegó ningún contacto.
  // La condición evita mostrar este mensaje durante la carga inicial antes de la primera búsqueda.
  const notFound = submitted && !isFetching && !contact

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Historial de chat</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Buscá el historial completo de un contacto</p>
      </div>

      {/* Formulario de búsqueda: nombre y/o teléfono + botón Buscar */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 px-5 py-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-44">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Nombre del contacto
            </label>
            <input
              type="text"
              placeholder="Ej: Juan Pérez"
              value={name}
              maxLength={120}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as string]: 'var(--color-primary)' }}
            />
          </div>
          <div className="flex-1 min-w-44">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Número de teléfono
            </label>
            <input
              type="tel"
              placeholder="+50688881234"
              value={phone}
              maxLength={20}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as string]: 'var(--color-primary)' }}
            />
          </div>
          {/* El botón se deshabilita mientras está cargando o si ambos campos están vacíos */}
          <button
            onClick={handleSearch}
            disabled={isFetching || (!name.trim() && !phone.trim())}
            className="flex-shrink-0 px-5 py-2.5 rounded-xl text-white text-sm font-medium flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <Search size={15} />
            {isFetching ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          Formato: +506XXXXXXXX · También podés buscar por nombre.
        </p>
      </div>

      {/* Cuerpo principal: cambia entre 3 estados según el flujo de búsqueda */}
      {!submitted ? (
        /* Estado inicial: sin ninguna búsqueda realizada todavía */
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <svg className="w-14 h-14 mb-4 opacity-25" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-base font-medium">Historial de contacto</p>
          <p className="text-sm mt-1 text-center max-w-xs">
            Buscá por nombre o teléfono para ver el historial de un contacto.
          </p>
        </div>

      ) : notFound ? (
        /* Estado "no encontrado": se buscó pero el backend no devolvió ningún contacto */
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <svg className="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
          <p className="text-sm">No se encontró ningún contacto con ese dato.</p>
          <p className="text-xs mt-1">Verificá el formato internacional, ej: +50688881234</p>
        </div>

      ) : contact ? (
        <>
          {/* Tarjeta del contacto encontrado: avatar con iniciales, nombre, teléfono y total de casos */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm px-5 py-4 flex items-center gap-4">
            {/* Avatar generado con iniciales del nombre; fondo en color primario de la app */}
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {initials(contact.name)}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{contact.name}</p>
              {contact.phone && (
                <p className="text-sm text-gray-500 dark:text-gray-400">{contact.phone}</p>
              )}
            </div>
            {/* Total de casos del contacto destacado en el color primario */}
            <div className="ml-auto text-right flex-shrink-0">
              <p className="text-xs text-gray-400 dark:text-gray-500">Total de casos</p>
              <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-primary)' }}>
                {total}
              </p>
            </div>
          </div>

          {/* Tabla de conversaciones del contacto */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/60 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3 text-left">N° Caso</th>
                    <th className="px-5 py-3 text-left">Canal</th>
                    <th className="px-5 py-3 text-left">Agente</th>
                    <th className="px-5 py-3 text-left">Tags</th>
                    <th className="px-5 py-3 text-left">Estado</th>
                    <th className="px-5 py-3 text-right">Último mensaje</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {conversations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                        Este contacto no tiene conversaciones registradas.
                      </td>
                    </tr>
                  ) : conversations.map((conv) => (
                    <tr key={conv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                      {/* Número de caso en formato monoespaciado para alineación visual */}
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                          {conv.case_number}
                        </span>
                      </td>

                      {/* Canal: ícono + nombre usando ChannelDot; '—' si no hay canal asignado */}
                      <td className="px-5 py-3">
                        {conv.channel
                          ? <ChannelDot type={conv.channel.type as ChannelType} name={conv.channel.name} />
                          : <span className="text-gray-300 dark:text-gray-600">—</span>
                        }
                      </td>

                      {/* Agente: badge especial para bots de IA; nombre para agentes humanos */}
                      <td className="px-5 py-3 text-xs text-gray-600 dark:text-gray-300">
                        {conv.agent?.is_bot ? (
                          // Badge diferenciado para el bot de IA con ícono de robot
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                            🤖 Bot IA
                          </span>
                        ) : conv.agent ? (
                          conv.agent.name
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>

                      {/* Tags: se muestran hasta 3 para no desbordar la celda */}
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(conv.tags ?? []).slice(0, 3).map(tag => (
                            <span
                              key={tag.id}
                              className="text-xs px-1.5 py-0.5 rounded-full text-white"
                              // El color de fondo viene del campo 'color' del tag (hex)
                              style={{ backgroundColor: tag.color }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Estado de la conversación (abierta, no leída, cerrada) */}
                      <td className="px-5 py-3">
                        <StatusBadge status={conv.status} />
                      </td>

                      {/* Fecha del último mensaje formateada con formatDatetime */}
                      <td className="px-5 py-3 text-right text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap tabular-nums">
                        {formatDatetime(conv.last_message_at)}
                      </td>

                      {/* Botón para abrir la conversación */}
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => navigate(`/chat-history/${conv.id}`)}
                          className="text-xs px-3 py-1.5 rounded-lg font-medium text-white inline-flex items-center gap-1 hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2"
                          style={{
                            backgroundColor: 'var(--color-primary)',
                            ['--tw-ring-color' as string]: 'var(--color-primary)',
                          }}
                          aria-label={`Ver conversación ${conv.case_number}`}
                        >
                          <Eye size={13} />
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
