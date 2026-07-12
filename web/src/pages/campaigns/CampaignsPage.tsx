import { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Plus,
  Eye,
  X,
  Loader2,
  Send,
  Clock,
  Upload,
  AlertTriangle,
} from 'lucide-react'
import DOMPurify from 'dompurify'
import api from '@/api/client'

// ─── Descripción ──────────────────────────────────────────────────────────────
//
// CampaignsPage — Página principal de gestión de campañas masivas.
//
// Permite al usuario:
//   1. Ver campañas activas (draft / scheduled / running) e historial
//      (completed / failed / cancelled) en pestañas separadas.
//   2. Crear una nueva campaña mediante un asistente (wizard) de 3 pasos:
//        Paso 1 — Configuración: nombre, canal, plantilla aprobada, país y
//                 cálculo automático del costo por mensaje según tabla oficial Meta.
//        Paso 2 — Destinatarios: ingresar teléfonos a mano o subir un CSV.
//        Paso 3 — Programación: enviar de inmediato o en una fecha/hora futura,
//                 con resumen final antes de confirmar.
//   3. Iniciar una campaña en estado "draft" (con confirmación de costo).
//   4. Cancelar una campaña en curso o programada.
//   5. Ver el detalle de una campaña (estadísticas + lista de destinatarios),
//      con recarga automática cada 5 segundos mientras la campaña está "running".
//
// Dependencias clave:
//   - @tanstack/react-query  → caché y mutaciones de datos
//   - react-hot-toast        → notificaciones de éxito/error
//   - api (axios)            → cliente HTTP configurado con token Bearer
//
// ──────────────────────────────────────────────────────────────────────────────

// ─── Types ────────────────────────────────────────────────────────────────────

// Posibles estados de una campaña durante su ciclo de vida
type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'completed' | 'cancelled' | 'failed'

interface Channel {
  id: number
  name: string
  type: string
  phone_number_id?: string
}

interface Template {
  id: number
  name: string
  channel_type: string
  status: string
  body: string
  category?: string
}

interface Campaign {
  id: number
  name: string
  template_id: number
  template_name: string
  channel_id: number
  channel_name: string
  status: CampaignStatus
  total_recipients: number
  sent_count: number
  failed_count: number
  total_cost: number
  cost_per_message: number
  country_code: string
  scheduled_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface CampaignRecipient {
  id: number
  phone: string
  // Estado de entrega individual de cada destinatario
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'read'
  error: string | null
  sent_at: string | null
}

interface PaginationLink {
  url: string | null
  label: string
  active: boolean
}

// Respuesta paginada genérica que devuelve el backend Laravel
interface PaginatedResponse<T> {
  data: T[]
  links: PaginationLink[]
  meta: {
    current_page: number
    last_page: number
    per_page: number
    total: number
    from: number
    to: number
  }
}

// Los tres pasos del wizard de creación de campaña
type WizardStep = 1 | 2 | 3

// Estado completo que maneja el wizard mientras el usuario lo completa
interface WizardState {
  name: string
  channel_id: number | null
  template_id: number | null
  country_code: string
  // 'manual' = textarea con números, 'csv' = archivo subido
  input_mode: 'manual' | 'csv'
  manual_phones: string
  csv_file: File | null
  // Números ya parseados del CSV, listos para contar y enviar
  csv_phones: string[]
  csv_discarded: number
  // 'now' = enviar inmediatamente al crear, 'later' = programar fecha/hora
  schedule_mode: 'now' | 'later'
  scheduled_at: string
}

// ─── Pricing data (tabla oficial Meta) ────────────────────────────────────────
//
// Estructura de precios por categoría de mensaje (USD por mensaje)
type PriceRow = { marketing: number; utility: number; authentication: number; service: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Mapa de estado de campaña → clase CSS de Tailwind y etiqueta en español.
// Se usa en StatusBadge para renderizar el pill de color correspondiente.
const STATUS_BADGE: Record<CampaignStatus, { cls: string; label: string }> = {
  draft:     { cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',    label: 'Borrador'   },
  scheduled: { cls: 'bg-yellow-100 text-yellow-700',  label: 'Programada' },
  running:   { cls: 'bg-blue-100 text-blue-700',      label: 'En curso'   },
  completed: { cls: 'bg-green-100 text-green-700',    label: 'Completada' },
  cancelled: { cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',    label: 'Cancelada'  },
  failed:    { cls: 'bg-red-100 text-red-600',        label: 'Fallida'    },
}

// Mapa de estado de destinatario → clase CSS y etiqueta para RecipientStatusBadge
const RECIPIENT_STATUS_BADGE: Record<CampaignRecipient['status'], { cls: string; label: string }> = {
  pending:   { cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',    label: 'Pendiente'  },
  sent:      { cls: 'bg-blue-100 text-blue-700',      label: 'Enviado'    },
  delivered: { cls: 'bg-indigo-100 text-indigo-700',  label: 'Entregado'  },
  failed:    { cls: 'bg-red-100 text-red-700',        label: 'Fallido'    },
  read:      { cls: 'bg-green-100 text-green-700',    label: 'Leído'      },
}

/**
 * Muestra un pill (badge) de color según el estado de la campaña.
 *
 * @param status - Estado actual de la campaña (CampaignStatus).
 */
function StatusBadge({ status }: { status: CampaignStatus }) {
  const { cls, label } = STATUS_BADGE[status] ?? STATUS_BADGE.draft
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

/**
 * Muestra un pill (badge) de color según el estado de entrega de un destinatario
 * individual dentro del detalle de una campaña.
 *
 * @param status - Estado de entrega: 'pending' | 'sent' | 'delivered' | 'failed' | 'read'.
 */
function RecipientStatusBadge({ status }: { status: CampaignRecipient['status'] }) {
  const { cls, label } = RECIPIENT_STATUS_BADGE[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

/**
 * Devuelve la fecha/hora actual en formato "YYYY-MM-DDTHH:MM" (sin segundos),
 * compatible con el atributo `value` de inputs tipo `datetime-local`.
 * Se usan los segundos a 0 para que el valor quede limpio.
 */
function nowIso() {
  const d = new Date()
  d.setSeconds(0, 0)
  return d.toISOString().slice(0, 16)
}

/**
 * Parsea el contenido de texto de un archivo CSV y extrae la primera columna
 * (número de teléfono) de cada línea, descartando encabezados y valores inválidos.
 *
 * Lógica de filtrado:
 *   - Toma solo la primera columna de cada fila (split por coma).
 *   - Descarta la fila si su valor en minúsculas es 'phone', 'telefono' o vacío
 *     (son encabezados típicos de CSV exportados).
 *   - Descarta entradas de menos de 8 caracteres (no son números válidos).
 *
 * @param text - Contenido completo del archivo CSV como string.
 * @returns    Array de strings con los números de teléfono limpios.
 */
function parseCsv(text: string): { phones: string[]; discarded: number } {
  const all = text.split('\n').map(line => line.split(',')[0].trim())
  const phones = all.filter(p => {
    const lower = p.toLowerCase()
    return lower !== 'phone' && lower !== 'telefono' && lower !== '' && p.length >= 8
  })
  const discarded = all.filter(p => {
    const lower = p.toLowerCase()
    return lower !== 'phone' && lower !== 'telefono' && p !== '' && p.length < 8
  }).length
  return { phones, discarded }
}

// Estado inicial del wizard; se restaura al cerrar o cancelar el modal
const EMPTY_WIZARD: WizardState = {
  name: '',
  channel_id: null,
  template_id: null,
  country_code: 'CR',      // Costa Rica como país por defecto
  input_mode: 'manual',
  manual_phones: '',
  csv_file: null,
  csv_phones: [],
  csv_discarded: 0,
  schedule_mode: 'now',
  scheduled_at: nowIso(),  // Fecha inicial = ahora (se actualiza al abrir)
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Página principal de Campañas.
 *
 * Gestiona el ciclo completo de campañas masivas de WhatsApp/Telegram:
 * listado (activas + historial), creación mediante wizard de 3 pasos,
 * inicio manual, cancelación y vista detallada de cada campaña.
 */
export default function CampaignsPage() {
  const qc = useQueryClient()

  // Tabs: activas (draft/scheduled/running) | historial (completed/failed/cancelled)
  const [tab, setTab] = useState<'active' | 'history'>('active')
  // Páginas separadas para cada tab; así navegar en historial no resetea la de activas
  const [pageActive, setPageActive] = useState(1)
  const [pageHistory, setPageHistory] = useState(1)

  // Control de visibilidad de los distintos modales
  const [showWizard, setShowWizard] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)    // null = cerrado
  const [cancelId, setCancelId] = useState<number | null>(null)    // null = cerrado

  // Modal de confirmación para iniciar campaña draft
  const [launchingCampaign, setLaunchingCampaign] = useState<Campaign | null>(null)

  // ── Estado del wizard de 3 pasos ─────────────────────────────────────────────
  // step avanza de 1→2→3 con el botón "Siguiente" y retrocede con "Atrás".
  // wizard acumula todos los campos del formulario multi-paso.
  const [step, setStep] = useState<WizardStep>(1)
  const [wizard, setWizard] = useState<WizardState>(EMPTY_WIZARD)
  // Estado visual del área de drag-and-drop para CSV
  const [dragOver, setDragOver] = useState(false)
  // Referencia al input file oculto; se activa al hacer clic en la zona de drop
  const csvInputRef = useRef<HTMLInputElement>(null)

  // ── Queries ─────────────────────────────────────────────────────────────────

  // Lista paginada de campañas activas (draft, scheduled, running).
  // Solo se ejecuta cuando la pestaña activa está seleccionada (enabled).
  const { data: activeData, isLoading: isLoadingActive } = useQuery<PaginatedResponse<Campaign>>({
    queryKey: ['campaigns', 'active', pageActive],
    queryFn: () =>
      api.get(`/campaigns?page=${pageActive}&status[]=draft&status[]=scheduled&status[]=running`).then(r => r.data),
    enabled: tab === 'active',
  })

  // Lista paginada de campañas históricas (completed, failed, cancelled).
  // Solo se ejecuta cuando la pestaña historial está seleccionada.
  const { data: historyData, isLoading: isLoadingHistory } = useQuery<PaginatedResponse<Campaign>>({
    queryKey: ['campaigns', 'history', pageHistory],
    queryFn: () =>
      api.get(`/campaigns?page=${pageHistory}&status[]=completed&status[]=failed&status[]=cancelled`).then(r => r.data),
    enabled: tab === 'history',
  })

  // Canales disponibles para el wizard. Solo se carga cuando el modal está abierto.
  const { data: channels } = useQuery<{ data: Channel[] }>({
    queryKey: ['channels'],
    queryFn: () => api.get('/channels').then(r => r.data),
    enabled: showWizard,
  })

  // Plantillas disponibles para el wizard. Solo se carga cuando el modal está abierto.
  const { data: templates } = useQuery<{ data: Template[] }>({
    queryKey: ['templates'],
    queryFn: () => api.get('/templates').then(r => r.data),
    enabled: showWizard,
  })

  // Precios WA desde el backend (misma fuente que el módulo de Precios WA).
  // Se carga cuando el wizard está abierto para que los cálculos sean consistentes.
  const { data: pricingData } = useQuery<{ data: { country_code: string; country_name: string; marketing: number; utility: number; authentication: number; service: number }[] }>({
    queryKey: ['whatsapp-pricing'],
    queryFn: () => api.get('/admin/whatsapp-pricing').then(r => r.data),
    enabled: showWizard,
  })

  // Mapa code → PriceRow y mapa code → nombre para el selector de países.
  // Se construye desde la respuesta de la API; fallback vacío mientras carga.
  const pricingMap: Record<string, PriceRow> = {}
  const countryNames: Record<string, string> = {}
  for (const row of pricingData?.data ?? []) {
    pricingMap[row.country_code] = { marketing: row.marketing, utility: row.utility, authentication: row.authentication, service: row.service }
    countryNames[row.country_code] = row.country_name
  }

  // Detalle de una campaña específica: estadísticas + lista de destinatarios.
  // refetchInterval implementa el polling automático: si la campaña está "running",
  // se recarga cada 5 segundos para mostrar el progreso en tiempo real;
  // en cualquier otro estado, no se hace polling (false).
  const { data: detailData } = useQuery<{ data: { campaign: Campaign; recipients: CampaignRecipient[] } }>({
    queryKey: ['campaign-detail', detailId],
    queryFn: () => api.get(`/campaigns/${detailId}`).then(r => r.data),
    enabled: detailId !== null,
    refetchInterval: (query) => {
      const campaign = query.state.data?.data?.campaign
      // Polling activo solo mientras la campaña está enviando mensajes
      return campaign?.status === 'running' ? 5000 : false
    },
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  // Crea una nueva campaña enviando un FormData (incluye posible archivo CSV).
  // Al éxito: invalida la caché de campañas y cierra el wizard.
  const createMutation = useMutation({
    mutationFn: (fd: FormData) => api.post('/campaigns', fd),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success('Campaña creada correctamente')
      closeWizard()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al crear la campaña')
    },
  })

  // Inicia una campaña que está en estado 'draft'.
  // Al éxito: invalida la caché y cierra el modal de confirmación.
  const launchMutation = useMutation({
    mutationFn: (id: number) => api.put(`/campaigns/${id}/launch`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success('Campaña iniciada.')
      setLaunchingCampaign(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al iniciar la campaña')
    },
  })

  // Cancela una campaña que está 'running' o 'scheduled'.
  // Al éxito: invalida tanto la lista general como el detalle específico (si estaba abierto).
  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.put(`/campaigns/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      // También refresca el modal de detalle en caso de que esté abierto
      qc.invalidateQueries({ queryKey: ['campaign-detail', cancelId] })
      toast.success('Campaña cancelada')
      setCancelId(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al cancelar la campaña')
    },
  })

  // ── Wizard helpers ───────────────────────────────────────────────────────────

  // Solo WhatsApp y Telegram soportan campañas masivas con plantillas
  const supportedChannels = channels?.data.filter(c => c.type === 'whatsapp' || c.type === 'telegram') ?? []
  // Filtra plantillas que: (a) estén aprobadas por Meta y (b) sean del mismo tipo de canal seleccionado
  const selectedChannel = supportedChannels.find(c => c.id === wizard.channel_id)
  const approvedTemplates = templates?.data.filter(
    t => t.status === 'approved' && t.channel_type === selectedChannel?.type
  ) ?? []
  // Plantilla actualmente seleccionada en el wizard (para vista previa y cálculo de costo)
  const selectedTemplate = approvedTemplates.find(t => t.id === wizard.template_id)

  // Lista unificada de destinatarios según el modo de ingreso elegido.
  // En modo 'manual': parsea el textarea (una por línea, mínimo 8 chars).
  // En modo 'csv': usa los números ya parseados del archivo subido.
  const recipientList =
    wizard.input_mode === 'manual'
      ? wizard.manual_phones
          .split('\n')
          .map(l => l.trim())
          .filter(p => p.length >= 8)
      : wizard.csv_phones

  // Cálculo de costos: precio unitario desde la API de precios × destinatarios.
  // Si no hay plantilla o no cargaron los precios aún, el costo es 0.
  const costPerMessage = (() => {
    if (!selectedTemplate || !wizard.country_code) return 0
    const row = pricingMap[wizard.country_code] ?? pricingMap['US']
    if (!row) return 0
    const cat = (['marketing', 'utility', 'authentication', 'service'].includes(selectedTemplate.category ?? '')
      ? selectedTemplate.category
      : 'marketing') as keyof PriceRow
    return row[cat] ?? 0
  })()
  const estimatedCost = costPerMessage * recipientList.length

  /**
   * Resetea y cierra el wizard de creación de campaña.
   * Vuelve al paso 1 y limpia todo el estado del formulario.
   */
  function closeWizard() {
    setShowWizard(false)
    setStep(1)
    setWizard(EMPTY_WIZARD)
  }

  /**
   * Lee un archivo CSV con FileReader y actualiza el estado del wizard
   * con el nombre del archivo y los números de teléfono parseados.
   *
   * @param file - Archivo CSV/TXT seleccionado por el usuario.
   */
  function handleCsvFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      // Parsea el texto y almacena tanto el archivo original como los teléfonos extraídos
      const { phones, discarded } = parseCsv(text)
      setWizard(w => ({ ...w, csv_file: file, csv_phones: phones, csv_discarded: discarded }))
    }
    reader.readAsText(file)
  }

  /**
   * Maneja el evento drop del área de arrastre de CSV.
   * Previene el comportamiento por defecto del navegador (abrir el archivo)
   * y procesa el primer archivo soltado.
   */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleCsvFile(file)
  }, [])

  /**
   * Construye el FormData y dispara la mutación de creación de campaña.
   * Incluye el archivo CSV como binario si el modo es 'csv',
   * o la lista de teléfonos separados por coma si es 'manual'.
   * Solo incluye 'scheduled_at' si el usuario eligió programar para más tarde.
   */
  function handleSubmit() {
    const fd = new FormData()
    fd.append('name', wizard.name)
    fd.append('channel_id', String(wizard.channel_id))
    fd.append('template_id', String(wizard.template_id))
    fd.append('country_code', wizard.country_code)
    // El backend necesita el costo fijo para registrarlo; se envía con 6 decimales
    fd.append('cost_per_message', costPerMessage.toFixed(6))
    if (wizard.input_mode === 'manual') {
      // Envía los números como string CSV separado por comas
      fd.append('phones', recipientList.join(','))
    } else {
      // Envía el archivo binario; el backend lo parsea en el servidor
      fd.append('csv_file', wizard.csv_file as File)
    }
    if (wizard.schedule_mode === 'later') {
      // Solo se adjunta la fecha si el usuario eligió programar
      fd.append('scheduled_at', wizard.scheduled_at)
    }
    createMutation.mutate(fd)
  }

  // Validaciones por paso del wizard:
  // Paso 1: requiere nombre, canal y plantilla seleccionados
  const step1Valid = !!wizard.name && !!wizard.channel_id && !!wizard.template_id
  // Paso 2: requiere al menos un destinatario válido (manual o CSV)
  const step2Valid = recipientList.length > 0

  // Datos de la tabla activa según pestaña:
  // se unifican para que el JSX de paginación y loader sea agnóstico al tab
  const isLoading = tab === 'active' ? isLoadingActive : isLoadingHistory
  const campaignsData = tab === 'active' ? activeData : historyData
  const setCurrentPage = tab === 'active' ? setPageActive : setPageHistory

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Campañas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Envía mensajes masivos vía WhatsApp o Telegram usando plantillas aprobadas.
          </p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-xl shadow-sm hover:opacity-90 transition-opacity"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={16} />
          Nueva campaña
        </button>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {([
          { key: 'active',  label: 'Activas'   },
          { key: 'history', label: 'Historial' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
            style={
              tab === t.key
                ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)', fontWeight: 600 }
                : { borderColor: 'transparent', color: '#6b7280' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            Cargando campañas...
          </div>
        ) : tab === 'active' ? (
          /* ── Tabla Activas ── */
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  {['Nombre', 'Canal', 'Plantilla', 'Estado', 'Enviados', 'Fallidos', 'Acciones'].map(h => (
                    <th
                      key={h}
                      className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-4 py-3 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {activeData?.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-2">
                      <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                        <svg className="w-14 h-14 mx-auto mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                        </svg>
                        <p className="font-medium">Aún no tenés campañas activas</p>
                        <p className="text-sm mt-1">Creá tu primera campaña masiva de WhatsApp o Telegram.</p>
                      </div>
                    </td>
                  </tr>
                )}
                {activeData?.data.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{c.channel_name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{c.template_name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-center text-green-600 font-semibold tabular-nums">
                      {c.sent_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center text-red-500 font-semibold tabular-nums">
                      {c.failed_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setDetailId(c.id)}
                          title="Ver detalle"
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          <Eye size={15} />
                        </button>
                        {/* Solo campañas en borrador pueden iniciarse manualmente */}
                        {c.status === 'draft' && (
                          <button
                            onClick={() => setLaunchingCampaign(c)}
                            title="Iniciar campaña"
                            className="text-xs font-medium hover:underline"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            Iniciar
                          </button>
                        )}
                        {/* Campañas en curso o programadas pueden cancelarse */}
                        {(c.status === 'running' || c.status === 'scheduled') && (
                          <button
                            onClick={() => setCancelId(c.id)}
                            title="Cancelar campaña"
                            className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* ── Tabla Historial ── */
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  {['Nombre', 'Canal', 'Estado', 'Completada', 'Destinatarios', 'Enviados', 'Fallidos', 'Entrega %', 'Costo/Msg', 'Costo Total'].map(h => (
                    <th
                      key={h}
                      className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-4 py-3 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {historyData?.data.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-5 py-10 text-center text-gray-400 dark:text-gray-500">
                      No hay campañas en el historial.
                    </td>
                  </tr>
                )}
                {historyData?.data.map(c => {
                  // Tasa de entrega: mensajes enviados exitosamente sobre total de destinatarios
                  const deliveryRate = c.total_recipients > 0
                    ? Math.round((c.sent_count / c.total_recipients) * 100)
                    : 0
                  // Usa completed_at si existe; si no, updated_at como aproximación
                  const completedLabel = c.completed_at
                    ? new Date(c.completed_at).toLocaleString('es-CR')
                    : new Date(c.updated_at).toLocaleString('es-CR')
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{c.name}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.channel_name}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{completedLabel}</td>
                      <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300 tabular-nums">
                        {c.total_recipients.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center text-green-600 font-semibold tabular-nums">
                        {c.sent_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center text-red-500 font-semibold tabular-nums">
                        {c.failed_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {/* Color semáforo: verde ≥90%, amarillo ≥70%, rojo <70% */}
                        <span className={`text-xs font-semibold ${
                          deliveryRate >= 90 ? 'text-green-600' :
                          deliveryRate >= 70 ? 'text-yellow-600' : 'text-red-500'
                        }`}>
                          {deliveryRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 text-xs tabular-nums">
                        {c.cost_per_message > 0 ? `$${c.cost_per_message.toFixed(4)}` : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                        {c.total_cost > 0 ? `$${c.total_cost.toFixed(2)}` : <span className="text-gray-400">-</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación: solo se muestra si hay más de una página de resultados */}
        {campaignsData && campaignsData.meta.last_page > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Mostrando {campaignsData.meta.from}–{campaignsData.meta.to} de {campaignsData.meta.total}
            </p>
            <div className="flex items-center gap-1">
              {campaignsData.links.map((link, i) => {
                // Laravel devuelve las entidades HTML en los labels de paginación («/»)
                const label = link.label.replace('&laquo;', '«').replace('&raquo;', '»')
                return (
                  <button
                    key={i}
                    disabled={!link.url}
                    onClick={() => {
                      if (!link.url) return
                      // Extrae el número de página del parámetro ?page= de la URL de Laravel
                      const u = new URL(link.url, window.location.origin)
                      const p = u.searchParams.get('page')
                      if (p) setCurrentPage(Number(p))
                    }}
                    className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
                      link.active
                        ? 'text-white shadow-sm'
                        : !link.url
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    style={link.active ? { backgroundColor: 'var(--color-primary)' } : undefined}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(label) }}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Modal: Confirmar inicio de campaña ────────────────────────────────── */}
      {/* Se muestra al hacer clic en "Iniciar" en una campaña draft.
          Presenta el resumen de destinatarios, plantilla, canal y costo estimado
          antes de que el usuario confirme la acción irreversible. */}
      {launchingCampaign !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              Confirmar inicio de campaña
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Revisá los detalles antes de iniciar.{' '}
              <strong className="text-gray-700 dark:text-gray-300">Esta acción no se puede deshacer.</strong>
            </p>

            <dl className="space-y-2 text-sm mb-5">
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Destinatarios</dt>
                <dd className="font-semibold text-gray-900 dark:text-gray-100">
                  {launchingCampaign.total_recipients.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Plantilla</dt>
                <dd className="font-semibold text-gray-900 dark:text-gray-100">
                  {launchingCampaign.template_name || '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Canal</dt>
                <dd className="font-semibold text-gray-900 dark:text-gray-100">
                  {launchingCampaign.channel_name || '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Costo estimado</dt>
                <dd className="font-semibold text-gray-900 dark:text-gray-100">
                  {/* Costo estimado = precio por mensaje × total de destinatarios */}
                  {launchingCampaign.cost_per_message > 0
                    ? `$${(launchingCampaign.cost_per_message * launchingCampaign.total_recipients).toFixed(2)} USD`
                    : 'Sin costo'}
                </dd>
              </div>
            </dl>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
              <p className="text-xs text-amber-700 font-medium">
                Una vez iniciada, la campaña comenzará a enviar mensajes de inmediato y no podrás
                revertir los envíos realizados.
              </p>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setLaunchingCampaign(null)}
                className="px-4 py-2 text-sm font-medium rounded-xl border border-gray-300 text-gray-700 dark:text-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => launchMutation.mutate(launchingCampaign.id)}
                disabled={launchMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white transition disabled:opacity-60"
                style={{ background: 'var(--color-primary)' }}
              >
                {launchMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Sí, iniciar campaña
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Wizard Modal ──────────────────────────────────────────────────────── */}
      {/* Máquina de estados de 3 pasos:
            Paso 1 (Configuración): nombre + canal + plantilla + país + costo
            Paso 2 (Destinatarios): manual (textarea) o CSV (drag-and-drop / file input)
            Paso 3 (Programación):  ahora / programada + tabla resumen final
          El botón "Siguiente" avanza solo si el paso actual es válido.
          El botón "Atrás" retrocede sin borrar los datos ya ingresados. */}
      {showWizard && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Nueva campaña</h2>
              <button
                onClick={closeWizard}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Indicador de pasos: el paso activo se destaca con el color primario,
                los pasos completados muestran un ✓ verde, los pendientes están en gris */}
            <div className="flex border-b border-gray-100 dark:border-gray-700">
              {([
                { n: 1 as WizardStep, label: 'Configuración' },
                { n: 2 as WizardStep, label: 'Destinatarios' },
                { n: 3 as WizardStep, label: 'Programación' },
              ] as { n: WizardStep; label: string }[]).map(s => (
                <div
                  key={s.n}
                  className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                    step === s.n
                      ? 'border-b-2 text-gray-900 dark:text-gray-100'
                      : step > s.n
                      ? 'text-green-600'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                  style={step === s.n ? { borderBottomColor: 'var(--color-primary)', color: 'var(--color-primary)' } : undefined}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      step > s.n
                        ? 'bg-green-100 text-green-600'
                        : step === s.n
                        ? 'text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                    }`}
                    style={step === s.n ? { backgroundColor: 'var(--color-primary)' } : undefined}
                  >
                    {step > s.n ? '✓' : s.n}
                  </span>
                  {s.label}
                </div>
              ))}
            </div>

            {/* Step body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">

              {/* ── Paso 1: Configuración ── */}
              {step === 1 && (
                <div className="space-y-5">
                  {/* Nombre */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Nombre de la campaña <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={wizard.name}
                      onChange={e => setWizard(w => ({ ...w, name: e.target.value }))}
                      placeholder="Ej. Promo Julio 2026"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                    />
                  </div>

                  {/* Canal (WhatsApp + Telegram) */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Canal <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={wizard.channel_id ?? ''}
                      // Al cambiar el canal se resetea la plantilla para evitar inconsistencias
                      onChange={e => setWizard(w => ({ ...w, channel_id: Number(e.target.value), template_id: null }))}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                    >
                      <option value="">Selecciona un canal...</option>
                      {supportedChannels.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.type.charAt(0).toUpperCase() + c.type.slice(1)})</option>
                      ))}
                    </select>
                  </div>

                  {/* Plantilla aprobada por Meta (filtrada por canal seleccionado) */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Plantilla aprobada <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={wizard.template_id ?? ''}
                      onChange={e => setWizard(w => ({ ...w, template_id: Number(e.target.value) }))}
                      // El select se deshabilita hasta que el usuario elija un canal
                      disabled={!wizard.channel_id}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] disabled:bg-gray-50 dark:disabled:bg-gray-900 disabled:text-gray-400"
                    >
                      <option value="">Selecciona una plantilla...</option>
                      {approvedTemplates.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({(t.category ?? 'marketing').charAt(0).toUpperCase() + (t.category ?? 'marketing').slice(1)})
                        </option>
                      ))}
                    </select>
                    {/* Aviso si el canal elegido no tiene plantillas aprobadas */}
                    {wizard.channel_id && approvedTemplates.length === 0 && (
                      <p className="mt-1.5 text-xs text-amber-600">No hay plantillas aprobadas para este canal.</p>
                    )}
                  </div>

                  {/* Vista previa del cuerpo de la plantilla seleccionada */}
                  {selectedTemplate && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Vista previa del mensaje</label>
                      <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">
                        {selectedTemplate.body}
                      </div>
                    </div>
                  )}

                  {/* País destino: determina el precio oficial de Meta por mensaje */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      País destino <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={wizard.country_code}
                      onChange={e => setWizard(w => ({ ...w, country_code: e.target.value }))}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                    >
                      {/* Ordenado alfabéticamente por nombre de país */}
                      {Object.entries(countryNames).sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => (
                        <option key={code} value={code}>{name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Costo por mensaje: campo de solo lectura, calculado automáticamente
                      según la combinación país + categoría de la plantilla seleccionada */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Costo por mensaje (USD)
                      {selectedTemplate && wizard.country_code && (
                        <span className="ml-2 text-xs font-normal text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-2 py-0.5 rounded-full">
                          Precio oficial Meta
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      min="0"
                      readOnly
                      value={costPerMessage > 0 ? costPerMessage.toFixed(6) : ''}
                      placeholder="Selecciona plantilla y país..."
                      className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-900 cursor-default focus:outline-none"
                    />
                    <p className="mt-1.5 text-xs text-gray-400">
                      {selectedTemplate && wizard.country_code
                        ? <>Precio cargado desde tabla oficial de Meta para <strong>{countryNames[wizard.country_code] ?? wizard.country_code}</strong>.</>
                        : 'Se llena automáticamente al seleccionar plantilla y país.'}
                    </p>

                    {/* Mini tabla de las 4 categorías de precio para el país seleccionado */}
                    {wizard.country_code && pricingMap[wizard.country_code] && (
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {([
                          ['marketing',      'Marketing'],
                          ['utility',        'Utilidad'],
                          ['authentication', 'Auth'],
                          ['service',        'Servicio'],
                        ] as [keyof PriceRow, string][]).map(([cat, label]) => {
                          const price = pricingMap[wizard.country_code][cat]
                          return (
                            <div key={cat} className="text-center bg-gray-50 dark:bg-gray-700 rounded-lg px-2 py-1.5 border border-gray-100 dark:border-gray-600">
                              <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                              {/* 'service' es gratuito; los demás muestran el precio en USD */}
                              <p className={`text-xs font-semibold ${price === 0 ? 'text-green-600' : 'text-gray-700 dark:text-gray-300'}`}>
                                {price === 0 ? 'Gratis' : `$${price.toFixed(4)}`}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Paso 2: Destinatarios ── */}
              {step === 2 && (
                <div className="space-y-5">
                  {/* Toggle entre modo manual (textarea) y modo CSV (archivo) */}
                  <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-1">
                    {(['manual', 'csv'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => setWizard(w => ({ ...w, input_mode: m }))}
                        className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                          wizard.input_mode === m
                            ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                      >
                        {m === 'manual' ? 'Manual' : 'Subir CSV'}
                      </button>
                    ))}
                  </div>

                  {wizard.input_mode === 'manual' ? (
                    /* Modo manual: textarea con un número por línea en formato internacional */
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        Números de teléfono{' '}
                        <span className="text-gray-400 font-normal">(uno por línea, con código de país)</span>
                      </label>
                      <textarea
                        value={wizard.manual_phones}
                        onChange={e => setWizard(w => ({ ...w, manual_phones: e.target.value }))}
                        rows={8}
                        placeholder={'+50688887777\n+50611112222'}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] resize-none"
                      />
                      {/* Contador en tiempo real de destinatarios válidos */}
                      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{recipientList.length} destinatarios válidos</p>
                    </div>
                  ) : (
                    /* Modo CSV: zona de drag-and-drop o selector de archivo */
                    <div>
                      <div
                        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        // El clic en la zona abre el input file oculto
                        onClick={() => csvInputRef.current?.click()}
                        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${
                          dragOver
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                            : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 hover:border-gray-400'
                        }`}
                      >
                        <Upload size={32} className="mb-3 text-gray-400 dark:text-gray-500" />
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {/* Muestra el nombre del archivo subido o el texto de instrucción */}
                          {wizard.csv_file ? wizard.csv_file.name : 'Arrastra un CSV o haz clic para seleccionar'}
                        </p>
                        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                          Números en formato internacional (+50688888888)
                        </p>
                      </div>
                      {/* Input file real, oculto; se activa mediante el ref */}
                      <input
                        ref={csvInputRef}
                        type="file"
                        accept=".csv,.txt"
                        className="hidden"
                        onChange={e => { if (e.target.files?.[0]) handleCsvFile(e.target.files[0]) }}
                      />
                      {/* Confirmación de cuántos números fueron parseados exitosamente */}
                      {wizard.csv_phones.length > 0 && (
                        <p className="mt-2 text-xs text-green-600 font-medium">
                          Se enviará a <strong>{wizard.csv_phones.length.toLocaleString()}</strong> destinatarios
                        </p>
                      )}
                      {wizard.csv_discarded > 0 && (
                        <p className="mt-1 text-xs text-amber-600">
                          {wizard.csv_discarded} {wizard.csv_discarded === 1 ? 'fila fue ignorada' : 'filas fueron ignoradas'} (teléfono inválido o muy corto)
                        </p>
                      )}
                    </div>
                  )}

                  {/* Resumen de costo estimado: solo se muestra si hay precio y destinatarios */}
                  {costPerMessage > 0 && recipientList.length > 0 && (
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Costo estimado</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">${estimatedCost.toFixed(2)} USD</p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {recipientList.length.toLocaleString()} destinatarios × ${costPerMessage.toFixed(6)} por mensaje
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Paso 3: Programación ── */}
              {step === 3 && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">¿Cuándo enviar?</label>
                    <div className="flex rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-1">
                      {(['now', 'later'] as const).map(m => (
                        <button
                          key={m}
                          onClick={() => setWizard(w => ({ ...w, schedule_mode: m }))}
                          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${
                            wizard.schedule_mode === m
                              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                          }`}
                        >
                          {m === 'now' ? <><Send size={14} /> Enviar ahora</> : <><Clock size={14} /> Programar</>}
                        </button>
                      ))}
                    </div>
                    {/* El selector de fecha/hora solo aparece si se eligió "Programar" */}
                    {wizard.schedule_mode === 'later' && (
                      <input
                        type="datetime-local"
                        // min impide seleccionar fechas pasadas
                        min={nowIso()}
                        value={wizard.scheduled_at}
                        onChange={e => setWizard(w => ({ ...w, scheduled_at: e.target.value }))}
                        className="mt-3 w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                      />
                    )}
                  </div>

                  {/* Tabla resumen de todos los datos del wizard antes de confirmar */}
                  <div className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                        {([
                          ['Nombre',        wizard.name],
                          ['Canal',         supportedChannels.find(c => c.id === wizard.channel_id)?.name ?? '—'],
                          ['Plantilla',     selectedTemplate?.name ?? '—'],
                          ['País',          countryNames[wizard.country_code] ?? wizard.country_code],
                          ['Destinatarios', recipientList.length.toLocaleString()],
                          ['Costo estimado', costPerMessage > 0 ? `$${estimatedCost.toFixed(2)} USD` : 'Sin costo'],
                          ['Envío',         wizard.schedule_mode === 'now' ? 'Inmediato' : new Date(wizard.scheduled_at).toLocaleString('es-CR')],
                        ] as [string, string][]).map(([k, v]) => (
                          <tr key={k} className="bg-white dark:bg-gray-800">
                            <td className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 w-40 text-xs uppercase tracking-wide">{k}</td>
                            <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer del wizard con navegación entre pasos */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              {/* En paso 1 el botón izquierdo cancela; en pasos 2 y 3 retrocede */}
              <button
                onClick={() => step === 1 ? closeWizard() : setStep(s => (s - 1) as WizardStep)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                {step === 1 ? 'Cancelar' : 'Atrás'}
              </button>

              {/* En pasos 1 y 2 avanza; en paso 3 ejecuta el submit final */}
              {step < 3 ? (
                <button
                  onClick={() => setStep(s => (s + 1) as WizardStep)}
                  // Bloqueado si el paso actual no cumple sus validaciones
                  disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
                  className="px-5 py-2.5 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  Siguiente
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={createMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Crear campaña
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ──────────────────────────────────────────────────────── */}
      {/* Muestra estadísticas agregadas y la tabla de destinatarios individuales.
          Si la campaña está "running", el refetchInterval de la query actualiza
          los datos cada 5 segundos y se muestra el indicador de pulso animado. */}
      {detailId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">

            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {detailData?.data.campaign.name ?? 'Detalle de campaña'}
              </h2>
              <button
                onClick={() => setDetailId(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {detailData ? (
              <>
                {/* Tarjetas de estadísticas: total / enviados / fallidos / costo total */}
                <div className="grid grid-cols-4 divide-x divide-gray-100 dark:divide-gray-700 border-b border-gray-100 dark:border-gray-700">
                  {[
                    { label: 'Total',       value: detailData.data.campaign.total_recipients.toLocaleString() },
                    { label: 'Enviados',    value: detailData.data.campaign.sent_count.toLocaleString() },
                    { label: 'Fallidos',    value: detailData.data.campaign.failed_count.toLocaleString() },
                    { label: 'Costo total', value: `$${detailData.data.campaign.total_cost.toFixed(2)}` },
                  ].map(s => (
                    <div key={s.label} className="px-5 py-4 text-center">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{s.label}</p>
                      <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Barra de estado con indicador de polling activo cuando está "running" */}
                <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <StatusBadge status={detailData.data.campaign.status} />
                  {/* El punto pulsante avisa al usuario que los datos se están actualizando */}
                  {detailData.data.campaign.status === 'running' && (
                    <span className="flex items-center gap-1.5 text-xs text-yellow-600">
                      <span className="inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                      Actualizando cada 5 segundos...
                    </span>
                  )}
                </div>

                {/* Lista scrolleable de destinatarios con su estado de entrega individual */}
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                      <tr>
                        {['Teléfono', 'Estado', 'Error', 'Enviado a las'].map(h => (
                          <th key={h} className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-4 py-2.5">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                      {detailData.data.recipients.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                            No hay destinatarios registrados aún.
                          </td>
                        </tr>
                      ) : detailData.data.recipients.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-2.5 font-mono text-gray-700 dark:text-gray-300">{r.phone}</td>
                          <td className="px-4 py-2.5">
                            <RecipientStatusBadge status={r.status} />
                          </td>
                          <td className="px-4 py-2.5 text-red-600 text-xs">{r.error ?? '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">
                            {r.sent_at ? new Date(r.sent_at).toLocaleTimeString('es-CR') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <Loader2 size={24} className="animate-spin mr-2" />
                Cargando...
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Cancel Confirm Modal ──────────────────────────────────────────────── */}
      {/* Confirmación de cancelación con advertencia de irreversibilidad.
          Solo aplica a campañas en estado 'running' o 'scheduled'. */}
      {cancelId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Cancelar campaña</h2>
              <button
                onClick={() => setCancelId(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700">
                  Esta acción cancelará el envío. Los mensajes ya enviados no pueden revertirse.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setCancelId(null)}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Volver
                </button>
                <button
                  onClick={() => cancelMutation.mutate(cancelId)}
                  disabled={cancelMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-60"
                >
                  {cancelMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Sí, cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
