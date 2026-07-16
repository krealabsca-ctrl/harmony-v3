import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Plus,
  Eye,
  X,
  Loader2,
  Pencil,
  TrendingUp,
  DollarSign,
  BarChart2,
  ImageIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import api from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled'

type PlatformKey = 'facebook' | 'instagram' | 'google' | 'tiktok' | 'linkedin' | 'twitter'

interface Post {
  id: number
  title: string
  platform: PlatformKey
  status: string
  impressions: number
  clicks: number
  published_at: string | null
}

interface PubCampaign {
  id: number
  name: string
  type: string
  platforms: PlatformKey[]
  budget: number
  spent: number
  start_date: string
  end_date: string
  status: CampaignStatus
  posts_count: number
  impressions: number
  clicks: number
  conversions: number
  created_at: string
}

interface PubCampaignDetail {
  campaign: PubCampaign
  posts: Post[]
}

interface PaginationLink {
  url: string | null
  label: string
  active: boolean
}

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

interface CreateCampaignPayload {
  name: string
  type: string
  budget: number | ''
  start_date: string
  end_date: string
  platforms: PlatformKey[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<CampaignStatus, { cls: string; label: string }> = {
  draft:     { cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500',     label: 'Borrador'   },
  active:    { cls: 'bg-green-100 text-green-700',   label: 'Activa'     },
  paused:    { cls: 'bg-yellow-100 text-yellow-700', label: 'Pausada'    },
  completed: { cls: 'bg-blue-100 text-blue-700',     label: 'Completada' },
  cancelled: { cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 dark:text-gray-500',     label: 'Cancelada'  },
}

const POST_STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  draft:     { cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500',   label: 'Borrador'   },
  scheduled: { cls: 'bg-blue-100 text-blue-700',   label: 'Programado' },
  published: { cls: 'bg-green-100 text-green-700', label: 'Publicado'  },
  failed:    { cls: 'bg-red-100 text-red-700',     label: 'Fallido'    },
}

const CAMPAIGN_TYPES = [
  { value: 'awareness',    label: 'Reconocimiento de marca' },
  { value: 'traffic',      label: 'Tráfico al sitio web'   },
  { value: 'leads',        label: 'Generación de leads'    },
  { value: 'conversions',  label: 'Conversiones'           },
  { value: 'engagement',   label: 'Interacción'            },
  { value: 'app_installs', label: 'Instalaciones de app'   },
]

const PLATFORMS: { key: PlatformKey; label: string; color: string }[] = [
  { key: 'facebook',  label: 'Facebook',  color: 'bg-blue-100 text-blue-700'    },
  { key: 'instagram', label: 'Instagram', color: 'bg-pink-100 text-pink-700'    },
  { key: 'google',    label: 'Google',    color: 'bg-red-100 text-red-600'      },
  { key: 'tiktok',    label: 'TikTok',    color: 'bg-gray-900 text-white'       },
  { key: 'linkedin',  label: 'LinkedIn',  color: 'bg-sky-100 text-sky-700'      },
  { key: 'twitter',   label: 'Twitter/X', color: 'bg-slate-100 text-slate-700'  },
]

const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map(p => [p.key, p])) as Record<
  PlatformKey,
  { key: PlatformKey; label: string; color: string }
>

const EMPTY_FORM: CreateCampaignPayload = {
  name: '',
  type: '',
  budget: '',
  start_date: '',
  end_date: '',
  platforms: [],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-CR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('es-CR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('es-CR')
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CampaignStatus }) {
  const { cls, label } = STATUS_BADGE[status] ?? STATUS_BADGE.draft
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

function PlatformChip({ platform }: { platform: PlatformKey }) {
  const p = PLATFORM_MAP[platform]
  if (!p) return null
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${p.color}`}>
      {p.label}
    </span>
  )
}

function BudgetBar({ budget, spent }: { budget: number; spent: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  const color = pct >= 90 ? 'bg-red-400' : pct >= 70 ? 'bg-yellow-400' : 'bg-green-400'
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PubCampaignsPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<CreateCampaignPayload>(EMPTY_FORM)
  const [editForm, setEditForm] = useState<Partial<CreateCampaignPayload>>({})

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: campaignsData, isLoading } = useQuery<PaginatedResponse<PubCampaign>>({
    queryKey: ['pub-campaigns', page],
    queryFn: () => api.get(`/pub/campaigns?page=${page}`).then(r => r.data),
  })

  const { data: detailData, isLoading: detailLoading } = useQuery<{ data: PubCampaignDetail }>({
    queryKey: ['pub-campaign-detail', detailId],
    queryFn: () => api.get(`/pub/campaigns/${detailId}`).then(r => r.data),
    enabled: detailId !== null,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (payload: CreateCampaignPayload) => api.post('/pub/campaigns', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pub-campaigns'] })
      toast.success('Campaña creada correctamente')
      closeCreate()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al crear la campaña')
    },
  })

  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CreateCampaignPayload> }) =>
      api.put(`/pub/campaigns/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pub-campaigns'] })
      qc.invalidateQueries({ queryKey: ['pub-campaign-detail', editId] })
      toast.success('Campaña actualizada')
      setEditId(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al actualizar la campaña')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function closeCreate() {
    setShowCreate(false)
    setForm(EMPTY_FORM)
  }

  function togglePlatform(key: PlatformKey, current: PlatformKey[], setter: (v: PlatformKey[]) => void) {
    setter(current.includes(key) ? current.filter(p => p !== key) : [...current, key])
  }

  function handleCreate() {
    if (!form.name || !form.type || !form.budget || !form.start_date || !form.end_date || form.platforms.length === 0) {
      toast.error('Completa todos los campos requeridos')
      return
    }
    createMutation.mutate({ ...form, budget: Number(form.budget) })
  }

  function openEdit(c: PubCampaign) {
    setEditId(c.id)
    setEditForm({
      name: c.name,
      type: c.type,
      budget: c.budget,
      start_date: c.start_date?.slice(0, 10) ?? '',
      end_date: c.end_date?.slice(0, 10) ?? '',
      platforms: c.platforms ?? [],
    })
  }

  function handleEdit() {
    if (!editId) return
    editMutation.mutate({ id: editId, payload: editForm })
  }

  // ── Pagination helper ─────────────────────────────────────────────────────────

  function handlePageLink(link: PaginationLink) {
    if (!link.url) return
    const u = new URL(link.url, window.location.origin)
    const p = u.searchParams.get('page')
    if (p) setPage(Number(p))
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  const detail = detailData?.data

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Campañas de Publicidad</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-0.5">
            Gestiona campañas de pauta en redes sociales y buscadores.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-xl shadow-sm hover:opacity-90 transition-opacity"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={16} />
          Nueva campaña
        </button>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            Cargando campañas...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                  {[
                    'Nombre', 'Plataformas', 'Presupuesto', 'Gastado',
                    'Inicio', 'Fin', 'Estado', 'Posts', 'Acciones',
                  ].map(h => (
                    <th
                      key={h}
                      className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {campaignsData?.data.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400 dark:text-gray-500">
                      No hay campañas todavía. Crea la primera.
                    </td>
                  </tr>
                )}
                {campaignsData?.data.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900/50 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDetailId(c.id)}
                        className="font-medium hover:underline text-left"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        {c.name}
                      </button>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {CAMPAIGN_TYPES.find(t => t.value === c.type)?.label ?? c.type}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(c.platforms ?? []).map(p => <PlatformChip key={p} platform={p} />)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 tabular-nums whitespace-nowrap">
                      {fmtCurrency(c.budget)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="space-y-1">
                        <span className="text-gray-700 dark:text-gray-300 tabular-nums text-sm">{fmtCurrency(c.spent)}</span>
                        <BudgetBar budget={c.budget} spent={c.spent} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmtDate(c.start_date)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 dark:text-gray-500 whitespace-nowrap">{fmtDate(c.end_date)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 tabular-nums text-center">
                      {c.posts_count}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setDetailId(c.id)}
                          title="Ver detalle"
                          className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300 transition-colors"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          title="Editar campaña"
                          className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300 transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {campaignsData && campaignsData.meta.last_page > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
              Mostrando {campaignsData.meta.from}–{campaignsData.meta.to} de {campaignsData.meta.total}
            </p>
            <div className="flex items-center gap-1">
              {campaignsData.links.map((link, i) => {
                const raw = link.label.replace('&laquo;', '').replace('&raquo;', '').trim()
                const isPrev = link.label.includes('laquo')
                const isNext = link.label.includes('raquo')
                return (
                  <button
                    key={i}
                    disabled={!link.url}
                    onClick={() => handlePageLink(link)}
                    className={`flex items-center justify-center min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
                      link.active
                        ? 'text-white shadow-sm'
                        : !link.url
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700'
                    }`}
                    style={link.active ? { backgroundColor: 'var(--color-primary)' } : undefined}
                  >
                    {isPrev ? <ChevronLeft size={14} /> : isNext ? <ChevronRight size={14} /> : raw}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Create Modal ─────────────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">

            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Nueva campaña de publicidad</h2>
              <button
                onClick={closeCreate}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              {/* Nombre */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Nombre de la campaña <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ej. Promo Verano 2026"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                />
              </div>

              {/* Tipo */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Tipo de campaña <span className="text-red-400">*</span>
                </label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                >
                  <option value="">Selecciona un tipo...</option>
                  {CAMPAIGN_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Presupuesto */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Presupuesto (USD) <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.budget}
                    onChange={e => setForm(f => ({ ...f, budget: e.target.value === '' ? '' : Number(e.target.value) }))}
                    placeholder="0.00"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-8 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                  />
                </div>
              </div>

              {/* Fechas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Fecha inicio <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Fecha fin <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.end_date}
                    min={form.start_date}
                    onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                  />
                </div>
              </div>

              {/* Plataformas */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Plataformas <span className="text-red-400">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map(p => {
                    const selected = form.platforms.includes(p.key)
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() =>
                          togglePlatform(p.key, form.platforms, platforms =>
                            setForm(f => ({ ...f, platforms }))
                          )
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          selected
                            ? 'border-transparent shadow-sm ' + p.color
                            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                        }`}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                {form.platforms.length === 0 && (
                  <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">Selecciona al menos una plataforma</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={closeCreate}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Crear campaña
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ───────────────────────────────────────────────────────── */}
      {editId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">

            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Editar campaña</h2>
              <button
                onClick={() => setEditId(null)}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nombre</label>
                <input
                  type="text"
                  value={editForm.name ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Tipo</label>
                <select
                  value={editForm.type ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                >
                  <option value="">Selecciona un tipo...</option>
                  {CAMPAIGN_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Presupuesto (USD)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.budget ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, budget: e.target.value === '' ? '' : Number(e.target.value) }))}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-8 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Fecha inicio</label>
                  <input
                    type="date"
                    value={editForm.start_date ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Fecha fin</label>
                  <input
                    type="date"
                    value={editForm.end_date ?? ''}
                    min={editForm.start_date}
                    onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Plataformas</label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map(p => {
                    const selected = (editForm.platforms ?? []).includes(p.key)
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() =>
                          togglePlatform(p.key, editForm.platforms ?? [], platforms =>
                            setEditForm(f => ({ ...f, platforms }))
                          )
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          selected
                            ? 'border-transparent shadow-sm ' + p.color
                            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                        }`}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => setEditId(null)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleEdit}
                disabled={editMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {editMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ─────────────────────────────────────────────────────── */}
      {detailId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">

            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {detail?.campaign.name ?? 'Detalle de campaña'}
                </h2>
                {detail && <StatusBadge status={detail.campaign.status} />}
              </div>
              <button
                onClick={() => setDetailId(null)}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                <Loader2 size={24} className="animate-spin mr-2" />
                Cargando...
              </div>
            ) : detail ? (
              <>
                {/* Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100 border-b border-gray-100 dark:border-gray-700">
                  {[
                    { icon: DollarSign, label: 'Presupuesto',  value: fmtCurrency(detail.campaign.budget),          sub: `Gastado: ${fmtCurrency(detail.campaign.spent)}` },
                    { icon: TrendingUp, label: 'Impresiones',  value: fmtCompact(detail.campaign.impressions),      sub: null },
                    { icon: BarChart2,  label: 'Clics',        value: fmtCompact(detail.campaign.clicks),           sub: detail.campaign.impressions > 0 ? `CTR ${((detail.campaign.clicks / detail.campaign.impressions) * 100).toFixed(2)}%` : null },
                    { icon: ImageIcon,  label: 'Conversiones', value: fmtCompact(detail.campaign.conversions),      sub: null },
                  ].map(m => (
                    <div key={m.label} className="px-5 py-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 mb-1">
                        <m.icon size={13} className="text-gray-400 dark:text-gray-500" />
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{m.label}</p>
                      </div>
                      <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{m.value}</p>
                      {m.sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{m.sub}</p>}
                    </div>
                  ))}
                </div>

                {/* Budget bar */}
                <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
                    <span>{fmtDate(detail.campaign.start_date)}</span>
                    <span>→</span>
                    <span>{fmtDate(detail.campaign.end_date)}</span>
                  </div>
                  <div className="flex-1">
                    <BudgetBar budget={detail.campaign.budget} spent={detail.campaign.spent} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {detail.campaign.platforms.map(p => <PlatformChip key={p} platform={p} />)}
                  </div>
                </div>

                {/* Posts */}
                <div className="flex-1 overflow-y-auto">
                  <div className="px-6 py-3 border-b border-gray-50 bg-white dark:bg-gray-800">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                      Posts asociados ({detail.posts.length})
                    </p>
                  </div>
                  {detail.posts.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">
                      No hay posts asociados a esta campaña.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                        <tr>
                          {['Título', 'Plataforma', 'Estado', 'Impresiones', 'Clics', 'Publicado'].map(h => (
                            <th key={h} className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-2.5 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {detail.posts.map(post => (
                          <tr key={post.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900/50">
                            <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">{post.title}</td>
                            <td className="px-4 py-2.5">
                              <PlatformChip platform={post.platform} />
                            </td>
                            <td className="px-4 py-2.5">
                              {(() => {
                                const b = POST_STATUS_BADGE[post.status] ?? { cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500', label: post.status }
                                return (
                                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${b.cls}`}>
                                    {b.label}
                                  </span>
                                )
                              })()}
                            </td>
                            <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 tabular-nums">{fmtCompact(post.impressions)}</td>
                            <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 tabular-nums">{fmtCompact(post.clicks)}</td>
                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 dark:text-gray-500 whitespace-nowrap">
                              {post.published_at ? fmtDate(post.published_at) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
