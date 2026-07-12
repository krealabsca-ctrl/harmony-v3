import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  MessageCircle,
  Globe,
  Clock,
  Calendar,
  Pencil,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react'
import api from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'paused'
type Platform =
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'youtube'
  | 'tiktok'
  | 'whatsapp'
  | 'web'

interface PubPost {
  id: number
  title: string
  body: string
  platform: Platform
  status: PostStatus
  scheduled_at: string // ISO datetime
  thumbnail_url: string | null
  campaign_name: string | null
}

interface PostsResponse {
  data: PubPost[]
}

interface PostFormData {
  title: string
  body: string
  platform: Platform
  status: PostStatus
  scheduled_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<PostStatus, string> = {
  draft: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500',
  scheduled: 'bg-blue-100 text-blue-700',
  published: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-600',
  paused: 'bg-orange-100 text-orange-700',
}

const STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Borrador',
  scheduled: 'Programado',
  published: 'Publicado',
  failed: 'Fallido',
  paused: 'Pausado',
}

const STATUS_DOT: Record<PostStatus, string> = {
  draft: 'bg-gray-400',
  scheduled: 'bg-blue-500',
  published: 'bg-green-500',
  failed: 'bg-red-500',
  paused: 'bg-orange-500',
}

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'Twitter / X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  web: 'Web / Blog',
}

const PLATFORM_COLOR: Record<Platform, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  twitter: '#1DA1F2',
  youtube: '#FF0000',
  tiktok: '#010101',
  whatsapp: '#25D366',
  web: '#6366F1',
}

function PlatformIcon({
  platform,
  size = 12,
}: {
  platform: Platform
  size?: number
}) {
  const props = { size, strokeWidth: 2 }
  switch (platform) {
    case 'instagram':
      return <Globe {...props} />
    case 'facebook':
      return <Globe {...props} />
    case 'twitter':
      return <Globe {...props} />
    case 'youtube':
      return <Globe {...props} />
    case 'tiktok':
      return <MessageCircle {...props} />
    case 'whatsapp':
      return <MessageCircle {...props} />
    case 'web':
      return <Globe {...props} />
  }
}

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

function toYYYYMM(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr)
  return d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })
}

function formatDatetimeLocal(isoStr: string): string {
  // Convert ISO to datetime-local input value (YYYY-MM-DDTHH:mm)
  const d = new Date(isoStr)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const emptyForm: PostFormData = {
  title: '',
  body: '',
  platform: 'instagram',
  status: 'scheduled',
  scheduled_at: '',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PubCalendarPage() {
  const qc = useQueryClient()

  // Calendar nav
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth()) // 0-indexed

  // Modal
  const [selectedPost, setSelectedPost] = useState<PubPost | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [form, setForm] = useState<PostFormData>(emptyForm)
  const [formErrors, setFormErrors] = useState<Partial<PostFormData>>({})

  // ── Query ──────────────────────────────────────────────────────────────────

  const monthKey = toYYYYMM(viewYear, viewMonth)

  const { data, isLoading } = useQuery<PostsResponse>({
    queryKey: ['pub-posts-calendar', monthKey],
    queryFn: async () => {
      const res = await api.get('/pub/posts', { params: { month: monthKey } })
      return res.data
    },
    placeholderData: (prev) => prev,
  })

  const posts: PubPost[] = data?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['pub-posts-calendar'] })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PostFormData> }) =>
      api.put(`/pub/posts/${id}`, data),
    onSuccess: () => {
      toast.success('Post actualizado')
      setEditOpen(false)
      invalidate()
    },
    onError: (err: any) => {
      const errors = err.response?.data?.errors
      if (errors) setFormErrors(errors)
      else toast.error(err.response?.data?.message ?? 'Error al actualizar')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/pub/posts/${id}`),
    onSuccess: () => {
      toast.success('Post eliminado')
      setDeleteConfirmOpen(false)
      setDetailOpen(false)
      setSelectedPost(null)
      invalidate()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al eliminar')
    },
  })

  // ── Navigation ─────────────────────────────────────────────────────────────

  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1)
        return 11
      }
      return m - 1
    })
  }, [])

  const nextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1)
        return 0
      }
      return m + 1
    })
  }, [])

  const goToday = useCallback(() => {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
  }, [])

  // ── Calendar grid ──────────────────────────────────────────────────────────

  const firstDay = new Date(viewYear, viewMonth, 1).getDay() // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7

  // Group posts by day-of-month
  const postsByDay: Record<number, PubPost[]> = {}
  for (const post of posts) {
    const d = new Date(post.scheduled_at)
    if (
      d.getFullYear() === viewYear &&
      d.getMonth() === viewMonth
    ) {
      const day = d.getDate()
      if (!postsByDay[day]) postsByDay[day] = []
      postsByDay[day].push(post)
    }
  }

  // ── Modal handlers ─────────────────────────────────────────────────────────

  const openDetail = (post: PubPost) => {
    setSelectedPost(post)
    setDetailOpen(true)
    setEditOpen(false)
    setDeleteConfirmOpen(false)
  }

  const openEdit = () => {
    if (!selectedPost) return
    setForm({
      title: selectedPost.title,
      body: selectedPost.body,
      platform: selectedPost.platform,
      status: selectedPost.status,
      scheduled_at: formatDatetimeLocal(selectedPost.scheduled_at),
    })
    setFormErrors({})
    setEditOpen(true)
    setDetailOpen(false)
  }

  const closeAll = () => {
    setDetailOpen(false)
    setEditOpen(false)
    setDeleteConfirmOpen(false)
    setSelectedPost(null)
    setFormErrors({})
  }

  const handleFormChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setFormErrors((prev) => ({ ...prev, [name]: undefined }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPost) return
    updateMutation.mutate({ id: selectedPost.id, data: form })
  }

  // ── Legend ─────────────────────────────────────────────────────────────────

  const LEGEND: { status: PostStatus; label: string }[] = [
    { status: 'scheduled', label: 'Programado' },
    { status: 'published', label: 'Publicado' },
    { status: 'draft', label: 'Borrador' },
    { status: 'failed', label: 'Fallido' },
    { status: 'paused', label: 'Pausado' },
  ]

  const isToday = (day: number) =>
    day === today.getDate() &&
    viewMonth === today.getMonth() &&
    viewYear === today.getFullYear()

  const isSaving = updateMutation.isPending

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Calendario Editorial</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-0.5">
            Posts programados por día
          </p>
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Hoy
          </button>
          <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
            <button
              onClick={prevMonth}
              className="p-2 text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors"
              aria-label="Mes anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-4 py-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200 min-w-[160px] text-center">
              {MONTHS_ES[viewMonth]} {viewYear}
            </span>
            <button
              onClick={nextMonth}
              className="p-2 text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors"
              aria-label="Mes siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4">
        {LEGEND.map(({ status, label }) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-700">
          {DAYS_ES.map((d) => (
            <div
              key={d}
              className="py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide bg-gray-50 dark:bg-gray-900"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Loading overlay */}
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-gray-400 dark:text-gray-500">
            <Loader2 size={22} className="animate-spin mr-2" />
            Cargando calendario...
          </div>
        )}

        {/* Cells */}
        {!isLoading && (
          <div className="grid grid-cols-7">
            {Array.from({ length: totalCells }).map((_, idx) => {
              const dayNum = idx - firstDay + 1
              const isValid = dayNum >= 1 && dayNum <= daysInMonth
              const dayPosts = isValid ? (postsByDay[dayNum] ?? []) : []
              const todayCell = isValid && isToday(dayNum)

              return (
                <div
                  key={idx}
                  className={`min-h-[110px] border-b border-r border-gray-100 dark:border-gray-700 p-1.5 last:border-r-0 ${
                    !isValid ? 'bg-gray-50 dark:bg-gray-900/60' : 'bg-white dark:bg-gray-800'
                  }`}
                >
                  {isValid && (
                    <>
                      {/* Day number */}
                      <div className="flex justify-end mb-1">
                        <span
                          className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold ${
                            todayCell
                              ? 'text-white'
                              : 'text-gray-600 dark:text-gray-400 dark:text-gray-500'
                          }`}
                          style={
                            todayCell
                              ? { backgroundColor: 'var(--color-primary)' }
                              : undefined
                          }
                        >
                          {dayNum}
                        </span>
                      </div>

                      {/* Posts */}
                      <div className="space-y-0.5">
                        {dayPosts.slice(0, 3).map((post) => (
                          <button
                            key={post.id}
                            onClick={() => openDetail(post)}
                            className="w-full text-left group"
                          >
                            <div className="flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors">
                              {/* Thumbnail or platform icon */}
                              <div
                                className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-white overflow-hidden"
                                style={{
                                  backgroundColor:
                                    PLATFORM_COLOR[post.platform],
                                }}
                              >
                                {post.thumbnail_url ? (
                                  <img
                                    src={post.thumbnail_url}
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <PlatformIcon platform={post.platform} size={10} />
                                )}
                              </div>

                              {/* Time + title */}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[post.status]}`}
                                  />
                                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tabular-nums flex-shrink-0">
                                    {formatTime(post.scheduled_at)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-gray-700 dark:text-gray-300 font-medium truncate leading-tight">
                                  {post.title}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))}

                        {/* Overflow indicator */}
                        {dayPosts.length > 3 && (
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 px-2 font-medium">
                            +{dayPosts.length - 3} más
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Detail Modal ────────────────────────────────────────────────────── */}
      {detailOpen && selectedPost && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && closeAll()}
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white flex-shrink-0"
                  style={{ backgroundColor: PLATFORM_COLOR[selectedPost.platform] }}
                >
                  <PlatformIcon platform={selectedPost.platform} size={14} />
                </div>
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {PLATFORM_LABELS[selectedPost.platform]}
                </span>
              </div>
              <button
                onClick={closeAll}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Thumbnail */}
              {selectedPost.thumbnail_url ? (
                <img
                  src={selectedPost.thumbnail_url}
                  alt={selectedPost.title}
                  className="w-full h-40 object-cover rounded-xl"
                />
              ) : (
                <div className="w-full h-36 bg-gray-100 dark:bg-gray-700 rounded-xl flex items-center justify-center text-gray-300">
                  <ImageIcon size={32} />
                </div>
              )}

              {/* Title + status */}
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">
                    {selectedPost.title}
                  </h3>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                      STATUS_BADGE[selectedPost.status]
                    }`}
                  >
                    {STATUS_LABELS[selectedPost.status]}
                  </span>
                </div>
                {selectedPost.campaign_name && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Campaña: {selectedPost.campaign_name}
                  </p>
                )}
              </div>

              {/* Body text */}
              {selectedPost.body && (
                <p className="text-sm text-gray-600 dark:text-gray-400 dark:text-gray-500 leading-relaxed whitespace-pre-line line-clamp-4">
                  {selectedPost.body}
                </p>
              )}

              {/* Schedule time */}
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900 rounded-xl px-4 py-3">
                <Calendar size={14} className="text-gray-400 dark:text-gray-500" />
                <span>
                  {new Date(selectedPost.scheduled_at).toLocaleDateString(
                    'es-CR',
                    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
                  )}
                </span>
                <Clock size={14} className="text-gray-400 dark:text-gray-500 ml-2" />
                <span className="font-medium tabular-nums">
                  {formatTime(selectedPost.scheduled_at)}
                </span>
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => {
                  setDeleteConfirmOpen(true)
                  setDetailOpen(false)
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl transition-colors"
              >
                <Trash2 size={14} />
                Eliminar
              </button>
              <button
                onClick={openEdit}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-opacity"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                <Pencil size={14} />
                Editar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ──────────────────────────────────────────────────────── */}
      {editOpen && selectedPost && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && closeAll()}
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Editar post
              </h2>
              <button
                onClick={closeAll}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form
              onSubmit={handleSubmit}
              className="px-6 py-5 space-y-4 overflow-y-auto flex-1"
            >
              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Título
                </label>
                <input
                  name="title"
                  value={form.title}
                  onChange={handleFormChange}
                  placeholder="Título del post"
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] ${
                    formErrors.title ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {formErrors.title && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.title}</p>
                )}
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Contenido
                </label>
                <textarea
                  name="body"
                  value={form.body}
                  onChange={handleFormChange}
                  rows={4}
                  placeholder="Texto del post..."
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] resize-none"
                />
              </div>

              {/* Platform */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Plataforma
                </label>
                <select
                  name="platform"
                  value={form.platform}
                  onChange={handleFormChange}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-white dark:bg-gray-800"
                >
                  {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Estado
                </label>
                <select
                  name="status"
                  value={form.status}
                  onChange={handleFormChange}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-white dark:bg-gray-800"
                >
                  {(Object.keys(STATUS_LABELS) as PostStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Scheduled at */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Fecha y hora programada
                </label>
                <input
                  name="scheduled_at"
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={handleFormChange}
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] ${
                    formErrors.scheduled_at ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {formErrors.scheduled_at && (
                  <p className="text-xs text-red-500 mt-1">
                    {formErrors.scheduled_at}
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditOpen(false)
                    setDetailOpen(true)
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
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
                  Guardar cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ────────────────────────────────────────────── */}
      {deleteConfirmOpen && selectedPost && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && closeAll()}
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Eliminar post
              </h2>
              <button
                onClick={closeAll}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                ¿Estás seguro de que deseas eliminar{' '}
                <span className="font-semibold">"{selectedPost.title}"</span>?
                Esta acción no se puede deshacer.
              </p>
              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirmOpen(false)
                    setDetailOpen(true)
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(selectedPost.id)}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-60"
                >
                  {deleteMutation.isPending && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
