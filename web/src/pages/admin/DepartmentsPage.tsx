import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, X, Users } from 'lucide-react'
import api from '@/api/client'
import { useAuth } from '@/hooks/useAuth'

// ── Types ──────────────────────────────────────────────────────────────────

interface Company {
  id: number
  name: string
}

interface Department {
  id: number
  name: string
  description: string | null
  auto_assign: boolean
  users_count: number
  company?: Company | null
}

interface DepartmentPayload {
  name: string
  description: string
  auto_assign: boolean
  company_id?: string
}

// ── API helpers ────────────────────────────────────────────────────────────

const fetchDepartments = async (companyFilter?: string): Promise<Department[]> => {
  const params: Record<string, string> = {}
  if (companyFilter) params.company_id = companyFilter
  const res = await api.get('/admin/departments', { params })
  return res.data.data ?? res.data
}

const fetchCompanies = async (): Promise<Company[]> => {
  const res = await api.get('/admin/companies', { params: { per_page: 100 } })
  return res.data.data ?? res.data
}

const createDepartment = async (payload: DepartmentPayload): Promise<Department> => {
  const res = await api.post<Department>('/admin/departments', payload)
  return res.data
}

const updateDepartment = async ({
  id,
  payload,
}: {
  id: number
  payload: Partial<DepartmentPayload>
}): Promise<Department> => {
  const res = await api.put<Department>(`/admin/departments/${id}`, payload)
  return res.data
}

const deleteDepartment = async (id: number): Promise<void> => {
  await api.delete(`/admin/departments/${id}`)
}

// ── Empty form state ───────────────────────────────────────────────────────

const emptyForm = (): DepartmentPayload => ({
  name: '',
  description: '',
  auto_assign: false,
  company_id: '',
})

// ── Component ──────────────────────────────────────────────────────────────

export default function DepartmentsPage() {
  const queryClient = useQueryClient()
  const { isSuperAdmin } = useAuth()

  const [companyFilter, setCompanyFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [form, setForm] = useState<DepartmentPayload>(emptyForm())
  const [deletingDept, setDeletingDept] = useState<Department | null>(null)

  // ── Queries / Mutations ──────────────────────────────────────────────────

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['admin', 'departments', companyFilter],
    queryFn: () => fetchDepartments(companyFilter),
  })

  const { data: companies = [] } = useQuery({
    queryKey: ['admin', 'companies'],
    queryFn: fetchCompanies,
    enabled: isSuperAdmin,
  })

  const createMutation = useMutation({
    mutationFn: createDepartment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] })
      toast.success('Departamento creado')
      closeModal()
    },
    onError: () => toast.error('Error al crear departamento'),
  })

  const updateMutation = useMutation({
    mutationFn: updateDepartment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] })
      toast.success('Departamento actualizado')
      closeModal()
    },
    onError: () => toast.error('Error al actualizar departamento'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDepartment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] })
      toast.success('Departamento eliminado')
      setDeletingDept(null)
    },
    onError: () => toast.error('Error al eliminar departamento'),
  })

  const toggleAutoAssign = (dept: Department) => {
    updateMutation.mutate({ id: dept.id, payload: { auto_assign: !dept.auto_assign } })
  }

  // ── Modal helpers ────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingDept(null)
    setForm(emptyForm())
    setShowModal(true)
  }

  const openEdit = (dept: Department) => {
    setEditingDept(dept)
    setForm({
      name: dept.name,
      description: dept.description ?? '',
      auto_assign: dept.auto_assign,
      company_id: dept.company?.id ? String(dept.company.id) : '',
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingDept(null)
    setForm(emptyForm())
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('El nombre es obligatorio'); return }
    if (editingDept) {
      updateMutation.mutate({ id: editingDept.id, payload: form })
    } else {
      createMutation.mutate(form)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Departamentos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Administra los departamentos de tu empresa</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        {isSuperAdmin && (
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="border border-gray-200 rounded-xl pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
          >
            <option value="">Todas las empresas</option>
            {companies.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={openCreate}
          className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-opacity"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus className="w-4 h-4" />
          Nuevo departamento
        </button>
      </div>

      {/* Table card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 dark:text-gray-500 text-sm">
            Cargando departamentos…
          </div>
        ) : departments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500 gap-2">
            <Users className="w-10 h-10 opacity-30" />
            <p className="text-sm">No hay departamentos registrados</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Nombre</th>
                {isSuperAdmin && <th className="px-5 py-3 text-left">Empresa</th>}
                <th className="px-5 py-3 text-left">Descripción</th>
                <th className="px-5 py-3 text-center">Asign. Auto</th>
                <th className="px-5 py-3 text-center">Usuarios</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {departments.map((dept) => (
                <tr key={dept.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">{dept.name}</td>
                  {isSuperAdmin && (
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{dept.company?.name ?? '—'}</td>
                  )}
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {dept.description || <span className="italic text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button
                      onClick={() => toggleAutoAssign(dept)}
                      disabled={updateMutation.isPending}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${dept.auto_assign ? 'bg-green-500' : 'bg-gray-200'}`}
                      role="switch"
                      aria-checked={dept.auto_assign}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${dept.auto_assign ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-center text-gray-600 dark:text-gray-400">{dept.users_count}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(dept)}
                        className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setDeletingDept(dept)}
                        className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2.5 py-1 hover:bg-red-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create / Edit modal ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-900 dark:text-gray-100">
                {editingDept ? 'Editar Departamento' : 'Nuevo Departamento'}
              </h3>
              <button onClick={closeModal} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none"
                  placeholder="Ej. Ventas"
                  required
                />
              </div>
              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none resize-none"
                  rows={2}
                  placeholder="Descripción opcional…"
                />
              </div>
              {/* Company (superadmin only) */}
              {isSuperAdmin && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Empresa <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.company_id}
                    onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2.5 text-sm bg-white dark:bg-gray-800"
                  >
                    <option value="">Seleccionar empresa</option>
                    {companies.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Auto-assign toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.auto_assign}
                  onChange={(e) => setForm((f) => ({ ...f, auto_assign: e.target.checked }))}
                  className="rounded border-gray-300"
                  style={{ accentColor: 'var(--color-primary)' }}
                />
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Asignación automática</span>
                  <p className="text-xs text-gray-400">Asigna casos al último agente que atendió al contacto</p>
                </div>
              </label>
              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {isSaving ? 'Guardando…' : editingDept ? 'Guardar cambios' : 'Crear departamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirm modal ─────────────────────────────────────────────── */}
      {deletingDept && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-2">¿Eliminar departamento?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Se desasignarán los usuarios. Los canales y conversaciones del departamento se mantendrán.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingDept(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate(deletingDept.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 rounded-xl text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
