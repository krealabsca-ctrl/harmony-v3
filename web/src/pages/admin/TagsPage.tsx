import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Tag } from 'lucide-react'
import api from '@/api/client'

// ── Types ──────────────────────────────────────────────────────────────────

interface Department {
  id: number
  name: string
}

interface TagItem {
  id: number
  name: string
  color: string
  department: Department | null
}

interface TagForm {
  name: string
  color: string
  department_id: string
}

// ── API helpers ────────────────────────────────────────────────────────────

const fetchTags = async (departmentFilter?: string): Promise<TagItem[]> => {
  const params: Record<string, string> = { per_page: '200' }
  if (departmentFilter) params.department_id = departmentFilter
  const { data } = await api.get('/admin/tags', { params })
  return data.data ?? data
}

const fetchDepartments = async (): Promise<Department[]> => {
  const { data } = await api.get('/admin/departments', { params: { per_page: 100 } })
  return data.data ?? data
}

const createTag = async (body: TagForm) => {
  const { data } = await api.post('/admin/tags', {
    name: body.name,
    color: body.color,
    department_id: body.department_id ? Number(body.department_id) : null,
  })
  return data
}

const updateTag = async ({ id, body }: { id: number; body: TagForm }) => {
  const { data } = await api.put(`/admin/tags/${id}`, {
    name: body.name,
    color: body.color,
    department_id: body.department_id ? Number(body.department_id) : null,
  })
  return data
}

const deleteTag = async (id: number) => {
  await api.delete(`/admin/tags/${id}`)
}

// ── Empty form ─────────────────────────────────────────────────────────────

const emptyForm = (): TagForm => ({ name: '', color: '#6366f1', department_id: '' })

// ── Main page ──────────────────────────────────────────────────────────────

export default function TagsPage() {
  const queryClient = useQueryClient()

  const [departmentFilter, setDepartmentFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingTag, setEditingTag] = useState<TagItem | null>(null)
  const [form, setForm] = useState<TagForm>(emptyForm())

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tags', departmentFilter],
    queryFn: () => fetchTags(departmentFilter),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments-list'],
    queryFn: fetchDepartments,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: editingTag
      ? (body: TagForm) => updateTag({ id: editingTag.id, body })
      : createTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      toast.success(editingTag ? 'Tag actualizado' : 'Tag creado')
      closeForm()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Error al guardar'
      toast.error(msg)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      toast.success('Tag eliminado')
    },
    onError: () => toast.error('Error al eliminar tag'),
  })

  // ── Form helpers ──────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingTag(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  const openEdit = (tag: TagItem) => {
    setEditingTag(tag)
    setForm({
      name: tag.name,
      color: tag.color,
      department_id: tag.department?.id ? String(tag.department.id) : '',
    })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingTag(null)
    setForm(emptyForm())
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('El nombre es obligatorio'); return }
    if (!form.department_id) { toast.error('El departamento es obligatorio'); return }
    saveMutation.mutate(form)
  }

  const handleDelete = (tag: TagItem) => {
    if (!window.confirm('¿Eliminar este tag? Se quitará de todas las conversaciones.')) return
    deleteMutation.mutate(tag.id)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tags</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Gestiona los tags para clasificar conversaciones
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-opacity"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus className="w-4 h-4" />
          Nuevo tag
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="border border-gray-200 rounded-xl pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
        >
          <option value="">Todos los departamentos</option>
          {departments.map((d) => (
            <option key={d.id} value={String(d.id)}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 mb-6">
          <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">
            {editingTag ? 'Editar tag' : 'Nuevo tag'}
          </h3>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Nombre */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Urgente"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none bg-white dark:bg-gray-800"
                />
              </div>
              {/* Color */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer p-1"
                  />
                  <input
                    type="text"
                    value={form.color}
                    maxLength={7}
                    placeholder="#6366f1"
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="flex-1 border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none bg-white dark:bg-gray-800"
                  />
                </div>
              </div>
              {/* Departamento */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Departamento <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.department_id}
                  onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm bg-white dark:bg-gray-800"
                >
                  <option value="">Seleccionar</option>
                  {departments.map((d) => (
                    <option key={d.id} value={String(d.id)}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
            {/* Preview + actions */}
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
              <span className="text-sm text-gray-500">Vista previa:</span>
              <span
                className="text-xs px-3 py-1 rounded-full text-white font-medium"
                style={{ backgroundColor: form.color }}
              >
                {form.name || 'Tag'}
              </span>
              <div className="flex gap-2 ml-auto">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="px-4 py-2 text-sm text-white rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {saveMutation.isPending ? 'Guardando…' : editingTag ? 'Guardar cambios' : 'Crear tag'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Tag list */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 dark:text-gray-500 text-sm">
            Cargando tags…
          </div>
        ) : tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
            <Tag className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No hay tags en este departamento</p>
            <button
              onClick={openCreate}
              className="mt-3 text-sm underline"
              style={{ color: 'var(--color-primary)' }}
            >
              Crear la primera
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-4 px-5 py-3">
                <span
                  className="w-4 h-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <div className="flex-1">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{tag.name}</span>
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{tag.department?.name ?? '—'}</span>
                </div>
                <span
                  className="text-xs px-2.5 py-1 rounded-full text-white font-medium"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => openEdit(tag)}
                    className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(tag)}
                    className="text-xs text-red-500 border border-red-200 rounded-lg px-2.5 py-1 hover:text-red-700 hover:bg-red-50 transition-colors"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
