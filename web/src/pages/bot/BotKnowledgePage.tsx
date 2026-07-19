import { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Upload, Trash2, X, Loader2, FileText, RefreshCw } from 'lucide-react'
import DOMPurify from 'dompurify'
import api from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type DocType = 'PDF' | 'DOCX' | 'TXT'
type DocStatus = 'processing' | 'ready' | 'failed'

interface Department {
  id: number
  name: string
}

interface BotDocument {
  id: number
  name: string
  file_type: DocType
  file_size: number
  department_id: number | null
  department_name: string | null
  status: DocStatus
  is_active: boolean
  created_at: string
}

interface PaginationLink {
  url: string | null
  label: string
  active: boolean
}

interface DocumentsResponse {
  data: BotDocument[]
  current_page: number
  last_page: number
  per_page: number
  total: number
  links: PaginationLink[]
}

interface UploadFormData {
  name: string
  department_id: string
  file: File | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<DocStatus, string> = {
  processing: 'bg-yellow-100 text-yellow-700',
  ready: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<DocStatus, string> = {
  processing: 'Procesando',
  ready: 'Listo',
  failed: 'Error',
}

const TYPE_BADGE: Record<DocType, string> = {
  PDF: 'bg-red-50 text-red-600',
  DOCX: 'bg-blue-50 text-blue-600',
  TXT: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const emptyForm: UploadFormData = {
  name: '',
  department_id: '',
  file: null,
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BotKnowledgePage() {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [page, setPage] = useState(1)

  // Upload modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<UploadFormData>(emptyForm)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof UploadFormData, string>>>({})

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletingDoc, setDeletingDoc] = useState<BotDocument | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: docsData, isLoading } = useQuery<DocumentsResponse>({
    queryKey: ['bot-documents', page],
    queryFn: async () => {
      const res = await api.get('/bot/documents')
      // El backend devuelve { data: [...] } sin paginación; normalizamos a una sola página.
      const list: BotDocument[] = res.data?.data ?? []
      return { data: list, current_page: 1, last_page: 1, per_page: list.length, total: list.length, links: [] }
    },
    placeholderData: (prev) => prev,
    refetchInterval: (query) => {
      const docs = (query?.state?.data as DocumentsResponse | undefined)?.data
      const hasProcessing = docs?.some((d: { status: string }) => d.status === 'processing')
      return hasProcessing ? 5000 : false
    },
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin-departments'],
    queryFn: async () => {
      const res = await api.get('/admin/departments')
      return res.data.data ?? res.data
    },
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['bot-documents'] })

  const uploadMutation = useMutation({
    mutationFn: (data: UploadFormData) => {
      const fd = new FormData()
      fd.append('name', data.name)
      if (data.department_id) fd.append('department_id', data.department_id)
      if (data.file) fd.append('file', data.file)
      return api.post('/bot/documents', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      toast.success('Documento subido. Procesando...')
      closeModal()
      invalidate()
    },
    onError: (err: any) => {
      const errors = err.response?.data?.errors
      if (errors) setFormErrors(errors)
      else toast.error(err.response?.data?.message ?? 'Error al subir el documento')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/bot/documents/${id}`),
    onSuccess: () => {
      toast.success('Documento eliminado')
      setDeleteModalOpen(false)
      setDeletingDoc(null)
      invalidate()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al eliminar el documento')
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: (id: number) => api.post(`/bot/documents/${id}/toggle-active`),
    onSuccess: () => {
      toast.success('Estado actualizado')
      invalidate()
    },
    onError: () => toast.error('Error al cambiar el estado'),
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const openModal = useCallback(() => {
    setForm(emptyForm)
    setFormErrors({})
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setForm(emptyForm)
    setFormErrors({})
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const openDelete = useCallback((doc: BotDocument) => {
    setDeletingDoc(doc)
    setDeleteModalOpen(true)
  }, [])

  const handleFieldChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setFormErrors((prev) => ({ ...prev, [name]: undefined }))
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setForm((prev) => ({
      ...prev,
      file,
      name: prev.name || (file ? file.name.replace(/\.[^.]+$/, '') : ''),
    }))
    setFormErrors((prev) => ({ ...prev, file: undefined }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errors: Partial<Record<keyof UploadFormData, string>> = {}
    if (!form.name.trim()) errors.name = 'El nombre es requerido'
    if (!form.file) errors.file = 'Selecciona un archivo'
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return }
    uploadMutation.mutate(form)
  }

  const isSaving = uploadMutation.isPending

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Base de conocimiento</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-0.5">
            Documentos que el Bot IA usa para responder consultas
          </p>
        </div>
        <button
          onClick={openModal}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-xl shadow-sm hover:opacity-90 transition-opacity"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Upload size={16} />
          Subir documento
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            Cargando documentos...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-6 py-3">
                    Documento
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3">
                    Tipo
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3">
                    Tamaño
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3">
                    Departamento
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3">
                    Estado
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3">
                    Activo
                  </th>
                  <th className="text-right text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-6 py-3">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {docsData?.data?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-gray-400 dark:text-gray-500">
                      <FileText size={36} className="mx-auto mb-3 opacity-30" />
                      No hay documentos cargados aún
                    </td>
                  </tr>
                )}
                {docsData?.data?.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900/50 transition-colors">
                    {/* Name */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                          <FileText size={15} className="text-gray-500 dark:text-gray-400 dark:text-gray-500" />
                        </div>
                        <span className="font-medium text-gray-900 dark:text-gray-100 leading-tight">{doc.name}</span>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          TYPE_BADGE[doc.file_type] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {doc.file_type}
                      </span>
                    </td>

                    {/* Size */}
                    <td className="px-4 py-4 text-gray-500 dark:text-gray-400 dark:text-gray-500 text-xs">
                      {formatBytes(doc.file_size)}
                    </td>

                    {/* Department */}
                    <td className="px-4 py-4 text-gray-700 dark:text-gray-300">
                      {doc.department_name ?? (
                        <span className="text-xs text-gray-400 dark:text-gray-500 italic">Global</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_BADGE[doc.status]
                        }`}
                      >
                        {doc.status === 'processing' && (
                          <RefreshCw size={10} className="animate-spin" />
                        )}
                        {STATUS_LABELS[doc.status]}
                      </span>
                    </td>

                    {/* Active toggle */}
                    <td className="px-4 py-4">
                      <button
                        onClick={() => toggleActiveMutation.mutate(doc.id)}
                        disabled={toggleActiveMutation.isPending || doc.status !== 'ready'}
                        title={doc.status !== 'ready' ? 'Solo disponible cuando está listo' : undefined}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
                          doc.is_active ? 'bg-green-500' : 'bg-gray-200'
                        }`}
                        style={doc.is_active ? { backgroundColor: 'var(--color-primary)' } : undefined}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-800 shadow ring-0 transition duration-200 ease-in-out ${
                            doc.is_active ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={() => openDelete(doc)}
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
        {docsData && docsData.last_page > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
              Mostrando {docsData.data.length} de {docsData.total} documentos
            </p>
            <div className="flex items-center gap-1">
              {docsData.links.map((link, i) => {
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
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700'
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

      {/* ── Upload Modal ──────────────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Subir documento</h2>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {/* File picker */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Archivo
                </label>
                <div
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors ${
                    formErrors.file ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {form.file ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <FileText size={18} className="text-gray-500 dark:text-gray-400 dark:text-gray-500" />
                      <span className="font-medium truncate max-w-[220px]">{form.file.name}</span>
                      <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0">
                        ({formatBytes(form.file.size)})
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload size={24} className="mx-auto text-gray-300" />
                      <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">
                        Haz clic para seleccionar un archivo
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">PDF, DOCX o TXT</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {formErrors.file && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.file}</p>
                )}
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Nombre descriptivo
                </label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleFieldChange}
                  placeholder="Ej. Manual de productos 2024"
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] ${
                    formErrors.name ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {formErrors.name && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>
                )}
              </div>

              {/* Department */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Departamento
                </label>
                <select
                  name="department_id"
                  value={form.department_id}
                  onChange={handleFieldChange}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-white dark:bg-gray-800"
                >
                  <option value="">Global (todos los departamentos)</option>
                  {departments.map((d) => (
                    <option key={d.id} value={String(d.id)}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
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
                  Subir documento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ───────────────────────────────────────────────── */}
      {deleteModalOpen && deletingDoc && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Eliminar documento</h2>
              <button
                onClick={() => { setDeleteModalOpen(false); setDeletingDoc(null) }}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                ¿Estás seguro de que deseas eliminar{' '}
                <span className="font-semibold">{deletingDoc.name}</span>?
                Esta acción no se puede deshacer.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setDeleteModalOpen(false); setDeletingDoc(null) }}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(deletingDoc.id)}
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
