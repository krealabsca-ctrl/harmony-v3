import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Loader2, X, Eye, EyeOff } from 'lucide-react'
import api from '@/api/client'
import IntegrationGuidePage from './IntegrationGuidePage'

// ─── Types ────────────────────────────────────────────────────────────────────

type ChannelType = 'whatsapp' | 'messenger' | 'instagram' | 'telegram'
type ChannelStatus = 'active' | 'inactive' | 'error'

interface Department {
  id: number
  name: string
}

interface Channel {
  id: number
  name: string
  type: ChannelType
  status: ChannelStatus
  is_active: boolean
  department_id: number | null
  department_name: string | null
  description: string | null
  identifier: string | null
  webhook_url: string | null
  webhook_secret: string | null
  // Credential set flags (truthy when the credential exists in DB)
  credential_flags?: {
    phone_number_id?: boolean
    waba_id?: boolean
    access_token?: boolean
    page_id?: boolean
    bot_token?: boolean
  }
}

interface ChannelsResponse {
  data: Channel[]
  current_page?: number
  last_page?: number
  total?: number
}

interface ChannelFormData {
  name: string
  type: ChannelType
  department_id: string
  description: string
  identifier: string
  is_active: boolean
  // Credentials
  phone_number_id: string
  waba_id: string
  access_token: string
  page_id: string
  bot_token: string
}

// ─── Brand config ─────────────────────────────────────────────────────────────

const CHANNEL_TYPES: {
  value: ChannelType
  label: string
  sub: string
  color: string
  gradient?: string
  svg: string
}[] = [
  {
    value: 'whatsapp',
    label: 'WhatsApp',
    sub: 'Meta Cloud API',
    color: '#25D366',
    svg: '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.549 4.103 1.51 5.829L0 24l6.335-1.493A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.017-1.375l-.36-.214-3.732.979.996-3.638-.234-.374A9.818 9.818 0 1112 21.818z"/>',
  },
  {
    value: 'messenger',
    label: 'Messenger',
    sub: 'Meta Graph API',
    color: '#0099FF',
    gradient: 'linear-gradient(135deg,#0099FF,#A033FF)',
    svg: '<path d="M12 0C5.373 0 0 5.176 0 11.553c0 3.639 1.815 6.883 4.65 9.017V24l4.245-2.33c1.134.314 2.336.484 3.567.484 6.627 0 12-5.176 12-11.553C24 5.176 18.627 0 12 0zm1.194 15.553l-3.055-3.256-5.96 3.256L10.732 9l3.13 3.256L19.696 9l-6.502 6.553z"/>',
  },
  {
    value: 'instagram',
    label: 'Instagram',
    sub: 'Meta Graph API',
    color: '#C13584',
    gradient: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af,#515bd4)',
    svg: '<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>',
  },
  {
    value: 'telegram',
    label: 'Telegram',
    sub: 'Bot API',
    color: '#229ED9',
    svg: '<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>',
  },
]

const getChannelConfig = (type: ChannelType) =>
  CHANNEL_TYPES.find((c) => c.value === type)!

const CRED_BG: Record<ChannelType, string> = {
  whatsapp: '#f0fdf4',
  messenger: '#eff6ff',
  instagram: '#fdf4ff',
  telegram: '#f0f9ff',
}
const CRED_BORDER: Record<ChannelType, string> = {
  whatsapp: '#bbf7d0',
  messenger: '#bfdbfe',
  instagram: '#e9d5ff',
  telegram: '#bae6fd',
}
const CRED_RING: Record<ChannelType, string> = {
  whatsapp: 'focus:ring-green-300',
  messenger: 'focus:ring-blue-300',
  instagram: 'focus:ring-purple-300',
  telegram: 'focus:ring-sky-300',
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ChannelCircle({ type, size = 10 }: { type: ChannelType; size?: number }) {
  const cfg = getChannelConfig(type)
  const bg = cfg.gradient ?? cfg.color
  const cls = `w-${size} h-${size} rounded-xl flex items-center justify-center flex-shrink-0`
  return (
    <div className={cls} style={{ background: bg }}>
      <svg
        viewBox="0 0 24 24"
        className="w-6 h-6 fill-white"
        dangerouslySetInnerHTML={{ __html: cfg.svg }}
      />
    </div>
  )
}

function PasswordField({
  label,
  hint,
  name,
  value,
  onChange,
  isConfigured,
  placeholder,
  type: channelType,
}: {
  label: string
  hint?: string
  name: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  isConfigured?: boolean
  placeholder?: string
  type: ChannelType
}) {
  const [show, setShow] = useState(false)
  const border = CRED_BORDER[channelType]
  const ring = CRED_RING[channelType]

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-xs font-semibold text-gray-700">{label}</label>
        {isConfigured && (
          <span aria-label="Campo ya configurado" className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            Configurado · dejar en blanco para mantener
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-gray-400 mb-1.5">{hint}</p>}
      <div className="relative">
        <input
          name={name}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete="new-password"
          placeholder={placeholder}
          className={`w-full border bg-white rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 ${ring}`}
          style={{ borderColor: border }}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  )
}

// ─── Empty form ───────────────────────────────────────────────────────────────

const emptyForm: ChannelFormData = {
  name: '',
  type: 'whatsapp',
  department_id: '',
  description: '',
  identifier: '',
  is_active: true,
  phone_number_id: '',
  waba_id: '',
  access_token: '',
  page_id: '',
  bot_token: '',
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChannelsPage() {
  const qc = useQueryClient()

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'channels' | 'guide'>('channels')

  // ── State ─────────────────────────────────────────────────────────────────

  const [formOpen, setFormOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [form, setForm] = useState<ChannelFormData>(emptyForm)
  const [formErrors, setFormErrors] = useState<Partial<Record<string, string>>>({})
  const [simulatedId, setSimulatedId] = useState<number | null>(null)
  const [simulatingId, setSimulatingId] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  // webhook display after creation
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null)
  const [createdVerifyToken, setCreatedVerifyToken] = useState<string | null>(null)
  const [copiedCreatedWebhook, setCopiedCreatedWebhook] = useState(false)
  const [showVerifyToken, setShowVerifyToken] = useState(false)
  const [copiedVerifyToken, setCopiedVerifyToken] = useState(false)

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: channels = [], isLoading } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await api.get<ChannelsResponse>('/channels')
      return res.data.data ?? (res.data as unknown as Channel[])
    },
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin-departments'],
    queryFn: async () => {
      const res = await api.get('/admin/departments')
      return res.data.data ?? res.data
    },
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['channels'] })

  const createMutation = useMutation({
    mutationFn: (data: object) => api.post('/channels', data),
    onSuccess: (res) => {
      toast.success('Canal guardado correctamente.')
      invalidate()
      const webhookUrl =
        res.data?.webhook_url ?? res.data?.data?.webhook_url ?? null
      const verifyToken =
        res.data?.webhook_secret ?? res.data?.data?.webhook_secret ?? null
      if (webhookUrl) {
        setCreatedWebhookUrl(webhookUrl)
        setCreatedVerifyToken(verifyToken)
      } else {
        closeForm()
      }
    },
    onError: (err: any) => {
      const errors = err.response?.data?.errors
      if (errors) setFormErrors(errors)
      else toast.error(err.response?.data?.message ?? 'Error al crear canal')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) =>
      api.put(`/channels/${id}`, data),
    onSuccess: () => {
      toast.success('Canal guardado correctamente.')
      closeForm()
      invalidate()
    },
    onError: (err: any) => {
      const errors = err.response?.data?.errors
      if (errors) setFormErrors(errors)
      else toast.error(err.response?.data?.message ?? 'Error al actualizar canal')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.put(`/channels/${id}`, { is_active, status: is_active ? 'active' : 'inactive' }),
    onSuccess: (_r, vars) => {
      const msg = vars.is_active
        ? 'Canal activado correctamente.'
        : 'Canal desactivado. No recibirá ni enviará mensajes.'
      toast.success(msg)
      invalidate()
    },
    onError: () => toast.error('Error al cambiar estado del canal'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/channels/${id}`),
    onSuccess: () => {
      toast.success('Canal eliminado. El historial de conversaciones se conserva.')
      invalidate()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al eliminar canal')
    },
  })

  const simulateMutation = useMutation({
    mutationFn: (id: number) => api.post(`/channels/${id}/simulate-inbound`),
    onSuccess: (_r, id) => {
      setSimulatedId(id)
      setSimulatingId(null)
    },
    onError: () => {
      setSimulatingId(null)
      toast.error('Error al simular mensaje entrante')
    },
  })

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setEditingChannel(null)
    setForm(emptyForm)
    setFormErrors({})
    setCreatedWebhookUrl(null)
    setCreatedVerifyToken(null)
    setShowVerifyToken(false)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((channel: Channel) => {
    setEditingChannel(channel)
    setForm({
      name: channel.name,
      type: channel.type,
      department_id: channel.department_id ? String(channel.department_id) : '',
      description: channel.description ?? '',
      identifier: channel.identifier ?? '',
      is_active: channel.is_active,
      phone_number_id: '',
      waba_id: '',
      access_token: '',
      page_id: '',
      bot_token: '',
    })
    setFormErrors({})
    setCreatedWebhookUrl(null)
    setCreatedVerifyToken(null)
    setShowVerifyToken(false)
    setFormOpen(true)
  }, [])

  const closeForm = useCallback(() => {
    setFormOpen(false)
    setEditingChannel(null)
    setForm(emptyForm)
    setFormErrors({})
    setCreatedWebhookUrl(null)
    setCreatedVerifyToken(null)
    setShowVerifyToken(false)
    setCopiedCreatedWebhook(false)
    setCopiedVerifyToken(false)
  }, [])

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
    setFormErrors((prev) => ({ ...prev, [name]: undefined }))
  }

  const handleTypeSelect = (type: ChannelType) => {
    setForm((prev) => ({
      ...prev,
      type,
      phone_number_id: '',
      waba_id: '',
      access_token: '',
      page_id: '',
      bot_token: '',
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const credentials: Record<string, string> = {}
    if (form.type === 'whatsapp') {
      if (form.phone_number_id) credentials.phone_number_id = form.phone_number_id
      if (form.waba_id) credentials.waba_id = form.waba_id
      if (form.access_token) credentials.access_token = form.access_token
    } else if (form.type === 'messenger' || form.type === 'instagram') {
      if (form.page_id) credentials.page_id = form.page_id
      if (form.access_token) credentials.access_token = form.access_token
    } else if (form.type === 'telegram') {
      if (form.bot_token) credentials.bot_token = form.bot_token
    }

    const payload = {
      name: form.name,
      type: form.type,
      department_id: form.department_id ? Number(form.department_id) : null,
      description: form.description,
      identifier: form.identifier,
      is_active: form.is_active,
      credentials,
    }

    if (editingChannel) {
      updateMutation.mutate({ id: editingChannel.id, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const handleDelete = (channel: Channel) => {
    const msg = `Eliminar este canal desconectará todas sus conversaciones activas. Esta acción no se puede deshacer. ¿Continuar?`
    if (window.confirm(msg)) {
      deleteMutation.mutate(channel.id)
    }
  }

  const handleCopyWebhook = (url: string, channelId: number) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(channelId)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const handleSimulate = (id: number) => {
    setSimulatingId(id)
    simulateMutation.mutate(id)
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  const currentCfg = getChannelConfig(form.type)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Canales</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Gestiona los canales de comunicación de la empresa
          </p>
        </div>
        {activeTab === 'channels' && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-xl shadow-sm hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <Plus size={16} />
            Nuevo canal
          </button>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {([
          { key: 'channels', label: 'Canales' },
          { key: 'guide',    label: 'Guías de integración' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'border-purple-600 text-purple-700 dark:text-purple-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'guide' && <IntegrationGuidePage />}

      {/* ── Channel grid ───────────────────────────────────────────────────── */}
      {activeTab === 'channels' && isLoading && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={24} className="animate-spin mr-2" />
          Cargando canales...
        </div>
      )}
      {activeTab === 'channels' && !isLoading && channels.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <svg
            className="w-12 h-12 mx-auto mb-3 opacity-40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
            />
          </svg>
          <p>No hay canales configurados.</p>
          <button
            onClick={openCreate}
            className="mt-3 inline-block px-4 py-2 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            + Agregar Canal
          </button>
        </div>
      )}
      {activeTab === 'channels' && !isLoading && channels.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {channels.map((channel) => {
            const cfg = getChannelConfig(channel.type)
            return (
              <div
                key={channel.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <ChannelCircle type={channel.type} size={10} />
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{channel.name}</p>
                      <p className="text-xs text-gray-500">{cfg.label}</p>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      channel.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : channel.status === 'error'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {channel.status === 'active'
                      ? 'Activo'
                      : channel.status === 'error'
                      ? 'Error'
                      : 'Inactivo'}
                  </span>
                </div>

                {channel.description && (
                  <p className="text-xs text-gray-500 mb-3">{channel.description}</p>
                )}

                <p className="text-xs text-gray-400 mb-1">
                  Departamento:{' '}
                  <span className="text-gray-600">{channel.department_name ?? '—'}</span>
                </p>
                <p className="text-xs text-gray-400 mb-3">
                  Identificador:{' '}
                  <span className="font-mono text-gray-600">{channel.identifier ?? '—'}</span>
                </p>

                {/* Webhook URL */}
                {channel.webhook_url && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3">
                    <p className="text-xs text-gray-500 mb-1">URL del Webhook:</p>
                    <p className="text-xs font-mono text-gray-700 break-all">
                      {channel.webhook_url}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCopyWebhook(channel.webhook_url!, channel.id)}
                      className="mt-1 text-xs font-medium hover:underline flex items-center gap-1"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {copiedId === channel.id ? (
                        <span className="text-green-600 font-semibold">Copiado!</span>
                      ) : (
                        <span>Copiar URL</span>
                      )}
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => openEdit(channel)}
                    className="flex-1 text-center py-2 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() =>
                      toggleMutation.mutate({ id: channel.id, is_active: !channel.is_active })
                    }
                    disabled={toggleMutation.isPending}
                    className={`flex-1 py-2 border rounded-xl text-xs ${
                      channel.is_active
                        ? 'border-red-200 text-red-600 hover:bg-red-50'
                        : 'border-green-200 text-green-600 hover:bg-green-50'
                    }`}
                  >
                    {channel.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => handleDelete(channel)}
                    disabled={deleteMutation.isPending}
                    className="py-2 px-3 border border-red-200 rounded-xl text-xs text-red-500 hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>

                {/* Simulate */}
                <button
                  onClick={() => handleSimulate(channel.id)}
                  disabled={simulatingId === channel.id}
                  className="w-full py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50 transition-colors flex items-center justify-center gap-1.5"
                >
                  {simulatingId === channel.id ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Enviando...
                    </>
                  ) : simulatedId === channel.id ? (
                    '✓ Mensaje enviado — revisá la bandeja de entrada'
                  ) : (
                    '⚡ Simular mensaje entrante'
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Create / Edit Slide-in panel ────────────────────────────────────── */}
      {formOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end">
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl flex flex-col">
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0 sticky top-0 bg-white z-10">
              <h2 className="text-base font-semibold text-gray-900">
                {editingChannel ? 'Editar canal' : 'Nuevo canal'}
              </h2>
              <button
                onClick={closeForm}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Webhook success screen (after creation) */}
            {createdWebhookUrl ? (
              <div className="px-6 py-6 space-y-5 flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Canal creado correctamente</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Copiá estos valores en el panel de la red social
                    </p>
                  </div>
                </div>

                {/* Webhook URL */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    URL del Webhook
                  </label>
                  <p className="text-xs text-gray-400 mb-1.5">
                    {['whatsapp', 'messenger', 'instagram'].includes(form.type)
                      ? 'Pegá esta URL en Meta → Tu App → Configuración → URL de devolución de llamada'
                      : 'Esta URL fue registrada automáticamente en Telegram al guardar el canal'}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 font-mono text-gray-700 break-all select-all">
                      {createdWebhookUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(createdWebhookUrl).then(() => {
                          setCopiedCreatedWebhook(true)
                          setTimeout(() => setCopiedCreatedWebhook(false), 2000)
                        })
                      }}
                      className={`flex-shrink-0 px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                        copiedCreatedWebhook
                          ? 'bg-green-50 border-green-200 text-green-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {copiedCreatedWebhook ? '✓ Copiado' : 'Copiar'}
                    </button>
                  </div>
                </div>

                {/* Verify token (Meta only) */}
                {createdVerifyToken &&
                  ['whatsapp', 'messenger', 'instagram'].includes(form.type) && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Token de Verificación{' '}
                      <span className="font-normal text-gray-400">(Verify Token)</span>
                    </label>
                    <p className="text-xs text-gray-400 mb-1.5">
                      Pegá este valor exacto en Meta → Webhook → Token de verificación
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <code
                          className={`block text-xs bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 font-mono text-amber-800 break-all transition-all ${
                            showVerifyToken ? '' : 'blur-sm select-none'
                          }`}
                        >
                          {createdVerifyToken}
                        </code>
                        <button
                          type="button"
                          onClick={() => setShowVerifyToken((v) => !v)}
                          className="absolute inset-y-0 right-3 flex items-center text-amber-500 hover:text-amber-700 transition-colors"
                        >
                          {showVerifyToken ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(createdVerifyToken).then(() => {
                            setCopiedVerifyToken(true)
                            setTimeout(() => setCopiedVerifyToken(false), 2000)
                          })
                        }}
                        className={`flex-shrink-0 px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                          copiedVerifyToken
                            ? 'bg-green-50 border-green-200 text-green-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {copiedVerifyToken ? '✓ Copiado' : 'Copiar'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠️ Este token es único por canal. No lo compartas. Meta lo usa solo una vez para verificar que el webhook es tuyo.
                    </p>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={closeForm}
                    className="px-5 py-2.5 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    Entendido, cerrar
                  </button>
                </div>
              </div>
            ) : (
              /* ── Form ─────────────────────────────────────────────────────── */
              <form onSubmit={handleSubmit} className="flex flex-col flex-1" autoComplete="off">
                {/* Hidden honeypot to block autofill */}
                <input type="text" name="prevent_autofill" style={{ display: 'none' }} autoComplete="username" readOnly />
                <input type="password" name="prevent_autofill_pw" style={{ display: 'none' }} autoComplete="new-password" readOnly />

                <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">

                  {/* ── Section 1: General config ──────────────────────────── */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: 'var(--color-primary)' }}
                      >
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">Configuración general</p>
                        <p className="text-xs text-gray-400">Departamento, tipo y nombre del canal</p>
                      </div>
                    </div>

                    <div className="px-6 py-5 space-y-5">
                      {/* Department */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          Departamento *
                        </label>
                        <select
                          name="department_id"
                          value={form.department_id}
                          onChange={handleFormChange}
                          className="w-full border border-gray-300 rounded-xl pl-4 pr-8 py-2.5 text-sm focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                        >
                          <option value="">Seleccionar departamento...</option>
                          {departments.map((d) => (
                            <option key={d.id} value={String(d.id)}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                        {formErrors.department_id && (
                          <p className="mt-1 text-xs text-red-500">{formErrors.department_id}</p>
                        )}
                      </div>

                      {/* Channel type visual selector */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Tipo de canal *
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          {CHANNEL_TYPES.map((ch) => {
                            const isSelected = form.type === ch.value
                            return (
                              <button
                                key={ch.value}
                                type="button"
                                onClick={() => handleTypeSelect(ch.value)}
                                disabled={!!editingChannel}
                                className={`relative flex flex-col items-center gap-2 px-3 py-3.5 rounded-xl border-2 transition-all duration-150 ${
                                  isSelected
                                    ? 'border-transparent shadow-md scale-[1.02]'
                                    : 'border-gray-200 hover:border-gray-300 bg-white hover:shadow-sm'
                                } disabled:opacity-60 disabled:cursor-not-allowed`}
                                style={
                                  isSelected
                                    ? {
                                        borderColor: ch.color,
                                        background: (ch.gradient ?? ch.color) + '18',
                                      }
                                    : undefined
                                }
                              >
                                <span
                                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                                  style={{ background: ch.gradient ?? ch.color }}
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="w-5 h-5 fill-white"
                                    dangerouslySetInnerHTML={{ __html: ch.svg }}
                                  />
                                </span>
                                <span
                                  className="text-xs font-medium leading-tight text-center"
                                  style={{ color: isSelected ? ch.color : '#374151' }}
                                >
                                  {ch.label}
                                </span>
                                <span className="text-[10px] text-gray-400 leading-tight text-center">
                                  {ch.sub}
                                </span>
                                {isSelected && (
                                  <span
                                    className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                                    style={{ background: ch.color }}
                                  >
                                    <svg className="w-2.5 h-2.5 fill-white" viewBox="0 0 20 20">
                                      <path
                                        fillRule="evenodd"
                                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          Nombre del canal *
                        </label>
                        <input
                          name="name"
                          value={form.name}
                          onChange={handleFormChange}
                          placeholder="Ej: Soporte WhatsApp CR"
                          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                        />
                        {formErrors.name && (
                          <p className="mt-1 text-xs text-red-500">{formErrors.name}</p>
                        )}
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          Descripción
                        </label>
                        <input
                          name="description"
                          value={form.description}
                          onChange={handleFormChange}
                          placeholder="Para qué se usa este canal"
                          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                        />
                      </div>

                      {/* Identifier */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          {form.type === 'whatsapp' && (
                            <>Número de teléfono <span className="text-gray-400 font-normal">(formato internacional, ej: +50688881234)</span></>
                          )}
                          {form.type === 'messenger' && 'ID de página de Facebook'}
                          {form.type === 'instagram' && 'ID de cuenta de Instagram'}
                          {form.type === 'telegram' && (
                            <>Username del bot <span className="text-gray-400 font-normal">(@username sin el @)</span></>
                          )}
                        </label>
                        <input
                          name="identifier"
                          value={form.identifier}
                          onChange={handleFormChange}
                          placeholder={
                            form.type === 'whatsapp'
                              ? '+50688881234'
                              : form.type === 'telegram'
                              ? 'mi_bot'
                              : ''
                          }
                          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                        />
                        {formErrors.identifier && (
                          <p className="mt-1 text-xs text-red-500">{formErrors.identifier}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Section 2: Credentials ─────────────────────────────── */}
                  <div
                    className="rounded-2xl border-2 overflow-hidden shadow-sm"
                    style={{ borderColor: currentCfg.color }}
                  >
                    {/* Credentials header with brand color */}
                    <div
                      className="flex items-center gap-3 px-5 py-4"
                      style={{ background: currentCfg.gradient ?? currentCfg.color }}
                    >
                      <div className="w-10 h-10 bg-white/25 rounded-xl flex items-center justify-center flex-shrink-0">
                        <svg
                          viewBox="0 0 24 24"
                          className="w-5 h-5 fill-white"
                          dangerouslySetInnerHTML={{ __html: currentCfg.svg }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-sm">{currentCfg.label}</p>
                        <p className="text-white/70 text-xs">{currentCfg.sub} · Credenciales de acceso</p>
                      </div>
                      <span className="flex items-center gap-1.5 text-xs text-white/80 bg-black/20 rounded-full px-3 py-1.5 flex-shrink-0">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        Encriptadas en BD
                      </span>
                    </div>

                    {/* Credential fields */}
                    <div
                      className="px-5 py-5 space-y-4"
                      style={{ background: CRED_BG[form.type] }}
                    >
                      {form.type === 'whatsapp' && (
                        <>
                          <PasswordField
                            label="Phone Number ID"
                            hint="ID numérico del número de teléfono en Meta"
                            name="phone_number_id"
                            value={form.phone_number_id}
                            onChange={handleFormChange}
                            isConfigured={editingChannel?.credential_flags?.phone_number_id}
                            type={form.type}
                          />
                          <PasswordField
                            label="WhatsApp Business Account ID"
                            hint="WABA ID de tu cuenta Business"
                            name="waba_id"
                            value={form.waba_id}
                            onChange={handleFormChange}
                            isConfigured={editingChannel?.credential_flags?.waba_id}
                            type={form.type}
                          />
                          <PasswordField
                            label="Access Token permanente"
                            hint="Token de acceso de la app Meta (nunca caduca)"
                            name="access_token"
                            value={form.access_token}
                            onChange={handleFormChange}
                            isConfigured={editingChannel?.credential_flags?.access_token}
                            type={form.type}
                          />
                        </>
                      )}

                      {form.type === 'messenger' && (
                        <>
                          <PasswordField
                            label="Page ID"
                            hint="ID numérico de tu página de Facebook"
                            name="page_id"
                            value={form.page_id}
                            onChange={handleFormChange}
                            isConfigured={editingChannel?.credential_flags?.page_id}
                            type={form.type}
                          />
                          <PasswordField
                            label="Page Access Token"
                            hint="Token de acceso de la página (de larga duración)"
                            name="access_token"
                            value={form.access_token}
                            onChange={handleFormChange}
                            isConfigured={editingChannel?.credential_flags?.access_token}
                            type={form.type}
                          />
                        </>
                      )}

                      {form.type === 'instagram' && (
                        <>
                          <PasswordField
                            label="Instagram Account ID"
                            hint="ID de la cuenta profesional de Instagram"
                            name="page_id"
                            value={form.page_id}
                            onChange={handleFormChange}
                            isConfigured={editingChannel?.credential_flags?.page_id}
                            type={form.type}
                          />
                          <PasswordField
                            label="Page Access Token"
                            hint="Token de acceso con permiso instagram_manage_messages"
                            name="access_token"
                            value={form.access_token}
                            onChange={handleFormChange}
                            isConfigured={editingChannel?.credential_flags?.access_token}
                            type={form.type}
                          />
                        </>
                      )}

                      {form.type === 'telegram' && (
                        <>
                          <PasswordField
                            label="Bot Token"
                            hint="Obtenido de @BotFather en Telegram. Formato: 123456789:ABCdef..."
                            placeholder="123456789:ABCdefGHI..."
                            name="bot_token"
                            value={form.bot_token}
                            onChange={handleFormChange}
                            isConfigured={editingChannel?.credential_flags?.bot_token}
                            type={form.type}
                          />
                          <div className="flex items-start gap-2 mt-1 px-3 py-2.5 rounded-xl bg-sky-100 border border-sky-200">
                            <svg className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-xs text-sky-700">
                              Al guardar, Harmony registrará automáticamente el webhook en Telegram.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── Section 3: Webhook data (edit only) ───────────────── */}
                  {editingChannel && editingChannel.webhook_url && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-indigo-100">
                          <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">Datos del Webhook</p>
                          <p className="text-xs text-gray-400">Copiá estos valores en el panel de la red social</p>
                        </div>
                      </div>
                      <div className="px-6 py-5 space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">URL del Webhook</label>
                          <p className="text-xs text-gray-400 mb-1.5">
                            {['whatsapp', 'messenger', 'instagram'].includes(editingChannel.type)
                              ? 'Pegá esta URL en Meta → Tu App → Configuración → URL de devolución de llamada'
                              : 'Esta URL fue registrada automáticamente en Telegram al guardar el canal'}
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 font-mono text-gray-700 break-all select-all">
                              {editingChannel.webhook_url}
                            </code>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(editingChannel.webhook_url!).then(() => {
                                  setCopiedId(editingChannel.id)
                                  setTimeout(() => setCopiedId(null), 2000)
                                })
                              }}
                              className={`flex-shrink-0 px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                                copiedId === editingChannel.id
                                  ? 'bg-green-50 border-green-200 text-green-700'
                                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              {copiedId === editingChannel.id ? '✓ Copiado' : 'Copiar'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Section 4: Status toggle ───────────────────────────── */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <div className="relative">
                        <input
                          type="checkbox"
                          name="is_active"
                          checked={form.is_active}
                          onChange={handleFormChange}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-6 bg-gray-200 rounded-full peer-checked:bg-green-500 transition-colors" />
                        <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4 pointer-events-none" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Canal activo</p>
                        <p className="text-xs text-gray-400">
                          Los canales inactivos no recibirán ni enviarán mensajes
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Form footer */}
                <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    {isSaving && <Loader2 size={14} className="animate-spin" />}
                    {isSaving ? 'Guardando...' : 'Guardar Canal'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
