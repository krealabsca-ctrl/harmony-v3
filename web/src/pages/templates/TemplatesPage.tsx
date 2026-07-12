import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Loader2, Send, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import DOMPurify from 'dompurify'
import api from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type TemplateCategory = 'marketing' | 'utility' | 'authentication'
type MetaStatus = 'draft' | 'pending' | 'approved' | 'rejected'
type HeaderFormat = 'none' | 'text' | 'image' | 'video' | 'document'
type ButtonType = 'url' | 'phone' | 'quick_reply'

interface TemplateButton {
  type: ButtonType
  text: string
  value: string // url, phone number, or empty for quick_reply
}

interface Department {
  id: number
  name: string
}

interface Channel {
  id: number
  name: string
  phone_number: string
  department_id?: number
}

interface Template {
  id: number
  name: string
  category: TemplateCategory
  channel_id: number
  channel_name: string
  department_id: number | null
  department_name: string | null
  meta_status: MetaStatus
  rejection_reason: string | null
  header_format: HeaderFormat | null
  header_content: string | null
  header_sample_url: string | null
  body: string
  footer: string | null
  buttons: TemplateButton[]
  agent_visible: boolean
  created_at: string
}

interface PaginationLink {
  url: string | null
  label: string
  active: boolean
}

interface TemplatesResponse {
  data: Template[]
  current_page: number
  last_page: number
  per_page: number
  total: number
  links: PaginationLink[]
}

interface TemplateFormData {
  department_id: string
  name: string
  category: TemplateCategory
  channel_id: string
  header_format: HeaderFormat
  header_content: string
  header_sample_url: string
  body: string
  footer: string
  buttons: TemplateButton[]
  agent_visible: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_BADGE: Record<TemplateCategory, string> = {
  marketing: 'bg-orange-100 text-orange-700',
  utility: 'bg-blue-100 text-blue-700',
  authentication: 'bg-green-100 text-green-700',
}

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  marketing: 'Marketing',
  utility: 'Utilidad',
  authentication: 'Autenticación',
}

const STATUS_BADGE: Record<MetaStatus, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<MetaStatus, string> = {
  draft: 'Borrador',
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
}

const HEADER_FORMAT_OPTIONS: { value: HeaderFormat; label: string; icon?: React.ReactNode }[] = [
  { value: 'none', label: 'Sin encabezado' },
  {
    value: 'text',
    label: 'Texto',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
      </svg>
    ),
  },
  {
    value: 'image',
    label: 'Imagen',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    value: 'video',
    label: 'Video',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    value: 'document',
    label: 'Documento',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
]

const emptyForm: TemplateFormData = {
  department_id: '',
  name: '',
  category: 'marketing',
  channel_id: '',
  header_format: 'none',
  header_content: '',
  header_sample_url: '',
  body: '',
  footer: '',
  buttons: [],
  agent_visible: true,
}

function renderBodyPreview(body: string): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => `[Variable ${n}]`)
}

// ─── Component ────────────────────────────────────────────────────────────────

// For role-based UI: assume the API returns the current user's role
// We read it from a global or context; fallback to 'admin' (non-agent) so features are visible
function useCurrentUser() {
  const { data } = useQuery<{ role: string; department_id?: number }>({
    queryKey: ['current-user'],
    queryFn: async () => {
      const res = await api.get('/me')
      return res.data
    },
    staleTime: Infinity,
  })
  return data
}

export default function TemplatesPage() {
  const qc = useQueryClient()
  const currentUser = useCurrentUser()
  const isAgent = currentUser?.role === 'agent'

  const [page, setPage] = useState(1)
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [form, setForm] = useState<TemplateFormData>(emptyForm)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null)
  const [previewVisible, setPreviewVisible] = useState(true)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: templatesData, isLoading } = useQuery<TemplatesResponse>({
    queryKey: ['templates', page, departmentFilter, statusFilter],
    queryFn: async (): Promise<TemplatesResponse> => {
      const res = await api.get<TemplatesResponse>('/templates', {
        params: {
          page,
          ...(departmentFilter ? { department_id: departmentFilter } : {}),
          ...(statusFilter ? { meta_status: statusFilter } : {}),
        },
      })
      return res.data
    },
    placeholderData: (prev) => prev,
  })

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels-list'],
    queryFn: async (): Promise<Channel[]> => {
      const res = await api.get<{ data: Channel[] } | Channel[]>('/channels')
      const d = res.data as { data?: Channel[] }
      return d.data ?? (res.data as Channel[])
    },
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments-list'],
    queryFn: async (): Promise<Department[]> => {
      const res = await api.get<{ data: Department[] } | Department[]>('/departments')
      const d = res.data as { data?: Department[] }
      return d.data ?? (res.data as Department[])
    },
  })

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['templates'] })

  const createMutation = useMutation({
    mutationFn: (data: TemplateFormData) => api.post('/templates', data),
    onSuccess: () => {
      toast.success('Plantilla creada correctamente')
      closeModal()
      invalidate()
    },
    onError: (err: any) => {
      const errors = err.response?.data?.errors
      if (errors) setFormErrors(errors)
      else toast.error(err.response?.data?.message ?? 'Error al crear plantilla')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<TemplateFormData> }) =>
      api.put(`/templates/${id}`, data),
    onSuccess: () => {
      toast.success('Plantilla actualizada correctamente')
      closeModal()
      invalidate()
    },
    onError: (err: any) => {
      const errors = err.response?.data?.errors
      if (errors) setFormErrors(errors)
      else toast.error(err.response?.data?.message ?? 'Error al actualizar plantilla')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/templates/${id}`),
    onSuccess: () => {
      toast.success('Plantilla eliminada')
      setDeleteModalOpen(false)
      setDeletingTemplate(null)
      invalidate()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al eliminar plantilla')
    },
  })

  const submitMetaMutation = useMutation({
    mutationFn: (id: number) => api.post(`/templates/${id}/submit`),
    onSuccess: () => {
      toast.success('Plantilla enviada a Meta para revisión')
      invalidate()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al enviar a Meta')
    },
  })

  const toggleAgentVisibleMutation = useMutation({
    mutationFn: (id: number) => api.post(`/templates/${id}/toggle-agent-visible`),
    onSuccess: () => {
      invalidate()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al cambiar visibilidad')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setEditingTemplate(null)
    setForm(emptyForm)
    setFormErrors({})
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((t: Template) => {
    setEditingTemplate(t)
    setForm({
      department_id: t.department_id ? String(t.department_id) : '',
      name: t.name,
      category: t.category,
      channel_id: String(t.channel_id),
      header_format: t.header_format ?? 'none',
      header_content: t.header_content ?? '',
      header_sample_url: t.header_sample_url ?? '',
      body: t.body,
      footer: t.footer ?? '',
      buttons: t.buttons ?? [],
      agent_visible: t.agent_visible,
    })
    setFormErrors({})
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingTemplate(null)
    setForm(emptyForm)
    setFormErrors({})
  }, [])

  const handleFieldChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
    setFormErrors((prev) => ({ ...prev, [name]: '' }))
  }

  // Button helpers
  const addButton = () => {
    setForm((prev) => ({
      ...prev,
      buttons: [...prev.buttons, { type: 'quick_reply', text: '', value: '' }],
    }))
  }

  const updateButton = (index: number, field: keyof TemplateButton, value: string) => {
    setForm((prev) => {
      const buttons = [...prev.buttons]
      buttons[index] = { ...buttons[index], [field]: value }
      return { ...prev, buttons }
    })
  }

  const removeButton = (index: number) => {
    setForm((prev) => ({ ...prev, buttons: prev.buttons.filter((_, i) => i !== index) }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: form })
    } else {
      createMutation.mutate(form)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending
  const isMultimedia = ['image', 'video', 'document'].includes(form.header_format)

  useEffect(() => { setPage(1) }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Plantillas HSM</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Gestiona las plantillas de mensajes de WhatsApp
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-xl shadow-sm hover:opacity-90 transition-opacity"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={16} />
          Nueva plantilla
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {!isAgent && (
          <select
            value={departmentFilter}
            onChange={(e) => { setDepartmentFilter(e.target.value); setPage(1) }}
            className="border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">Todos los departamentos</option>
            {departments.map((dept) => (
              <option key={dept.id} value={String(dept.id)}>{dept.name}</option>
            ))}
          </select>
        )}
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="pending">Pendiente</option>
          <option value="approved">Aprobada</option>
          <option value="rejected">Rechazada</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            Cargando plantillas...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-5 py-3">
                    Nombre
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-5 py-3">
                    Departamento
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-5 py-3">
                    Canal
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-5 py-3">
                    Categoría
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-5 py-3">
                    Estado Meta
                  </th>
                  <th className="text-right text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-semibold px-5 py-3">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {templatesData?.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-gray-400 dark:text-gray-500">
                      <svg className="w-14 h-14 mx-auto mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <p className="font-medium">No hay plantillas creadas</p>
                      <p className="text-sm mt-1">Creá plantillas de WhatsApp para campañas y respuestas rápidas.</p>
                    </td>
                  </tr>
                )}
                {templatesData?.data?.map((tpl) => (
                  <tr key={tpl.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">{tpl.name}</td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{tpl.department_name ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{tpl.channel_name ?? 'Sin canal'}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          CATEGORY_BADGE[tpl.category] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {CATEGORY_LABELS[tpl.category] ?? tpl.category}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_BADGE[tpl.meta_status] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {STATUS_LABELS[tpl.meta_status] ?? tpl.meta_status}
                      </span>
                      {tpl.meta_status === 'rejected' && tpl.rejection_reason && (
                        <p className="mt-1 text-xs text-red-500">{tpl.rejection_reason}</p>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {/* Toggle agent visibility — non-agents only */}
                        {!isAgent && (
                          <button
                            onClick={() => toggleAgentVisibleMutation.mutate(tpl.id)}
                            title={tpl.agent_visible ? 'Visible a agentes — clic para ocultar' : 'Oculto a agentes — clic para mostrar'}
                            className={`flex items-center gap-1 text-xs hover:opacity-75 transition-opacity ${
                              tpl.agent_visible ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'
                            }`}
                          >
                            {tpl.agent_visible ? (
                              <>
                                <Eye size={14} />
                                <span>Agentes</span>
                              </>
                            ) : (
                              <>
                                <EyeOff size={14} />
                                <span>Oculto</span>
                              </>
                            )}
                          </button>
                        )}

                        {/* Enviar a Meta — draft o rejected */}
                        {(tpl.meta_status === 'draft' || tpl.meta_status === 'rejected') && (
                          <button
                            onClick={() => submitMetaMutation.mutate(tpl.id)}
                            disabled={submitMetaMutation.isPending}
                            className="text-xs font-medium hover:underline disabled:opacity-50"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            {submitMetaMutation.isPending ? 'Enviando...' : 'Enviar a Meta'}
                          </button>
                        )}

                        <button
                          onClick={() => openEdit(tpl)}
                          className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Editar"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => { setDeletingTemplate(tpl); setDeleteModalOpen(true) }}
                          className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={15} />
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
        {templatesData && templatesData.last_page > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Mostrando {templatesData.data.length} de {templatesData.total} plantillas
            </p>
            <div className="flex items-center gap-1">
              {templatesData.links.map((link, i) => {
                const isDisabled = !link.url
                const isCurrent = link.active
                const label = link.label
                  .replace('&laquo;', '«')
                  .replace('&raquo;', '»')
                return (
                  <button
                    key={i}
                    disabled={isDisabled}
                    onClick={() => {
                      if (!link.url) return
                      const url = new URL(link.url, window.location.origin)
                      const p = url.searchParams.get('page')
                      if (p) setPage(Number(p))
                    }}
                    className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
                      isCurrent
                        ? 'text-white shadow-sm'
                        : isDisabled
                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    style={isCurrent ? { backgroundColor: 'var(--color-primary)' } : undefined}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(label) }}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Create / Edit Modal ───────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {editingTemplate ? 'Editar plantilla' : 'Nueva plantilla'}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewVisible((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <Eye size={14} />
                  {previewVisible ? 'Ocultar preview' : 'Mostrar preview'}
                </button>
                <button
                  onClick={closeModal}
                  className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="flex flex-1 overflow-hidden">
              {/* Form */}
              <form
                onSubmit={handleSubmit}
                className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
              >
                {/* Departamento — primer campo, requerido */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Departamento <span className="text-red-500">*</span>
                    </label>
                    {isAgent ? (
                      <input
                        type="text"
                        disabled
                        value={departments[0]?.name ?? '—'}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                      />
                    ) : (
                      <select
                        name="department_id"
                        value={form.department_id}
                        onChange={handleFieldChange}
                        required
                        className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-white dark:bg-gray-700 dark:text-gray-100 ${
                          formErrors.department_id ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                        }`}
                      >
                        <option value="">Seleccionar departamento...</option>
                        {departments.map((dept) => (
                          <option key={dept.id} value={String(dept.id)}>{dept.name}</option>
                        ))}
                      </select>
                    )}
                    {formErrors.department_id && (
                      <p className="text-xs text-red-500 mt-1">{formErrors.department_id}</p>
                    )}
                  </div>

                  {/* Categoría */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Categoría <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="category"
                      value={form.category}
                      onChange={handleFieldChange}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-white dark:bg-gray-700 dark:text-gray-100"
                    >
                      {(Object.keys(CATEGORY_LABELS) as TemplateCategory[]).map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Nombre */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Nombre <span className="text-gray-400 dark:text-gray-500 font-normal">(solo minúsculas, sin espacios)</span> <span className="text-red-500">*</span>
                  </label>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleFieldChange}
                    placeholder="mi_plantilla_01"
                    className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                      formErrors.name ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {formErrors.name && (
                    <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>
                  )}
                </div>

                {/* Canal WhatsApp */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Canal WhatsApp{' '}
                    {!form.department_id && (
                      <span className="text-gray-400 dark:text-gray-500 font-normal">(seleccioná primero un departamento)</span>
                    )}
                  </label>
                  <select
                    name="channel_id"
                    value={form.channel_id}
                    onChange={handleFieldChange}
                    disabled={!form.department_id}
                    className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-white dark:bg-gray-700 dark:text-gray-100 disabled:opacity-60 disabled:cursor-not-allowed ${
                      formErrors.channel_id ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    <option value="">Sin canal específico</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={String(ch.id)}>
                        {ch.name} — {ch.phone_number}
                      </option>
                    ))}
                  </select>
                  {formErrors.channel_id && (
                    <p className="text-xs text-red-500 mt-1">{formErrors.channel_id}</p>
                  )}
                </div>

                {/* Encabezado */}
                <div className="border border-gray-200 dark:border-gray-600 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Encabezado <span className="text-gray-400 dark:text-gray-500 font-normal text-xs">(opcional)</span></p>

                  {/* Header type — radio chips */}
                  <div className="flex flex-wrap gap-2">
                    {HEADER_FORMAT_OPTIONS.map(({ value, label, icon }) => (
                      <label
                        key={value}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors ${
                          form.header_format === value
                            ? 'border-2 border-purple-400 bg-purple-50 text-purple-700 font-medium'
                            : 'border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="header_format"
                          value={value}
                          checked={form.header_format === value}
                          onChange={handleFieldChange}
                          className="hidden"
                        />
                        {icon ?? <span>—</span>}
                        {label}
                      </label>
                    ))}
                  </div>

                  {/* Text header input */}
                  {form.header_format === 'text' && (
                    <div>
                      <input
                        name="header_content"
                        value={form.header_content}
                        onChange={handleFieldChange}
                        maxLength={60}
                        placeholder="Texto del encabezado (máx. 60 caracteres)"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                      />
                      {formErrors.header_content && (
                        <p className="text-xs text-red-500 mt-1">{formErrors.header_content}</p>
                      )}
                    </div>
                  )}

                  {/* Multimedia info box + sample URL */}
                  {isMultimedia && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-3 space-y-3">
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="text-xs text-blue-700 dark:text-blue-300">
                          <p className="font-medium mb-1">¿Cómo funciona?</p>
                          <ul className="space-y-1 text-blue-600 dark:text-blue-400">
                            <li>• Meta requiere una <strong>URL de ejemplo</strong> al crear la plantilla (para revisión). Puede ser cualquier imagen/video/documento público de muestra.</li>
                            <li>• Al <strong>enviar</strong> la plantilla en un chat, el agente sube o pega la URL real del archivo que quiere enviar.</li>
                          </ul>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">
                          URL de ejemplo para Meta <span className="text-red-500">*</span>{' '}
                          <span className="font-normal text-blue-600 dark:text-blue-400">(imagen/video/documento público de muestra)</span>
                        </label>
                        <input
                          name="header_sample_url"
                          value={form.header_sample_url}
                          onChange={handleFieldChange}
                          type="url"
                          placeholder="https://ejemplo.com/imagen-muestra.jpg"
                          className="w-full border border-blue-200 dark:border-blue-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none"
                        />
                        {formErrors.header_sample_url && (
                          <p className="text-xs text-red-500 mt-1">{formErrors.header_sample_url}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Body */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Cuerpo del mensaje <span className="text-red-500">*</span>
                    <span className="ml-2 text-gray-400 dark:text-gray-500 font-normal">
                      Usa {'{{1}}'}, {'{{2}}'} para variables
                    </span>
                  </label>
                  <textarea
                    name="body"
                    value={form.body}
                    onChange={handleFieldChange}
                    rows={5}
                    maxLength={1024}
                    placeholder="Hola {{1}}, gracias por contactarnos. Tu número de caso es {{2}}."
                    className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] resize-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                      formErrors.body ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {formErrors.body && (
                    <p className="text-xs text-red-500 mt-1">{formErrors.body}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    Usá <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-xs">{'{{1}}'}</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-xs">{'{{2}}'}</code> para variables dinámicas.
                  </p>
                </div>

                {/* Footer */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Pie de página <span className="text-gray-400 dark:text-gray-500 font-normal">(opcional, máx. 60 caracteres)</span>
                  </label>
                  <input
                    name="footer"
                    value={form.footer}
                    onChange={handleFieldChange}
                    maxLength={60}
                    placeholder="Ej. No responder a este mensaje"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                  />
                </div>

                {/* Buttons */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      Botones <span className="text-gray-400 dark:text-gray-500 font-normal">(opcional, máx. 3)</span>
                    </label>
                    {form.buttons.length < 3 && (
                      <button
                        type="button"
                        onClick={addButton}
                        className="text-xs font-medium hover:underline"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        + Agregar botón
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {form.buttons.map((btn, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={btn.type}
                          onChange={(e) => updateButton(i, 'type', e.target.value)}
                          className="border border-gray-200 dark:border-gray-600 rounded-lg pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 w-full sm:w-44"
                        >
                          <option value="quick_reply">Respuesta rápida</option>
                          <option value="url">URL</option>
                          <option value="phone">Teléfono</option>
                        </select>
                        <input
                          value={btn.text}
                          onChange={(e) => updateButton(i, 'text', e.target.value)}
                          placeholder="Texto del botón"
                          className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                        />
                        {(btn.type === 'url' || btn.type === 'phone') && (
                          <input
                            value={btn.value}
                            onChange={(e) => updateButton(i, 'value', e.target.value)}
                            placeholder={btn.type === 'url' ? 'https://...' : '+506...'}
                            className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => removeButton(i)}
                          className="text-red-400 hover:text-red-600 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Visible para agentes */}
                {!isAgent && (
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        name="agent_visible"
                        checked={form.agent_visible}
                        onChange={handleFieldChange}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-[var(--color-primary)] transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                    </label>
                    <span className="text-sm text-gray-700 dark:text-gray-300">Visible para agentes</span>
                  </div>
                )}

                {/* Footer buttons */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
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
                    {editingTemplate ? 'Guardar cambios' : 'Crear plantilla'}
                  </button>

                  {/* Enviar a Meta — solo cuando editando */}
                  {editingTemplate && (
                    <button
                      type="button"
                      onClick={() => submitMetaMutation.mutate(editingTemplate.id)}
                      disabled={submitMetaMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-green-300 text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50 ml-auto"
                    >
                      {submitMetaMutation.isPending ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Enviando a Meta...
                        </>
                      ) : (
                        <>
                          <Send size={14} />
                          Enviar a Meta para aprobación
                        </>
                      )}
                    </button>
                  )}
                </div>
              </form>

              {/* Preview Panel */}
              {previewVisible && (
                <div className="w-72 border-l border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex-shrink-0 overflow-y-auto p-5">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
                    Vista previa
                  </p>
                  {/* WhatsApp bubble */}
                  <div className="max-w-xs mx-auto">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                      {/* Header preview */}
                      {form.header_format === 'image' && (
                        <div className="bg-gray-100 dark:bg-gray-700 h-32 flex items-center justify-center text-gray-400">
                          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      {form.header_format === 'video' && (
                        <div className="bg-gray-900 h-32 flex items-center justify-center text-white">
                          <svg className="w-8 h-8 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                      )}
                      {form.header_format === 'document' && (
                        <div className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 px-4 py-3 flex items-center gap-2 text-gray-500">
                          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="text-xs">documento.pdf</span>
                        </div>
                      )}
                      {form.header_format === 'text' && form.header_content && (
                        <div className="px-4 pt-3 pb-1">
                          <p className="font-bold text-sm text-gray-900 dark:text-gray-100">{form.header_content}</p>
                        </div>
                      )}

                      {/* Body preview */}
                      <div className="px-4 py-3 space-y-2">
                        <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                          {form.body
                            ? renderBodyPreview(form.body)
                            : <span className="text-gray-300 dark:text-gray-600 italic">El cuerpo del mensaje aparecerá aquí...</span>
                          }
                        </p>
                        {form.footer && (
                          <p className="text-xs text-gray-400 dark:text-gray-500">{form.footer}</p>
                        )}
                      </div>

                      {/* Buttons preview */}
                      {form.buttons.length > 0 && (
                        <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                          {form.buttons.map((btn, i) => (
                            <div key={i} className="px-4 py-2 text-center text-sm font-medium text-blue-600">
                              {btn.text || <span className="text-gray-300 dark:text-gray-600 italic">Botón {i + 1}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Meta info */}
                  <div className="mt-4 space-y-1.5">
                    {form.category && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 dark:text-gray-500">Categoría:</span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            CATEGORY_BADGE[form.category]
                          }`}
                        >
                          {CATEGORY_LABELS[form.category]}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ─────────────────────────────────────────────── */}
      {deleteModalOpen && deletingTemplate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Eliminar plantilla</h2>
              <button
                onClick={() => { setDeleteModalOpen(false); setDeletingTemplate(null) }}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                ¿Estás seguro de que deseas eliminar la plantilla{' '}
                <span className="font-semibold">{deletingTemplate.name}</span>?
                Esta acción no se puede deshacer.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setDeleteModalOpen(false); setDeletingTemplate(null) }}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(deletingTemplate.id)}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors disabled:opacity-60"
                >
                  {deleteMutation.isPending && <Loader2 size={14} className="animate-spin" />}
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
