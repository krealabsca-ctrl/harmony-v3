import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Search, Pencil, Trash2, X, Loader2 } from 'lucide-react'
import DOMPurify from 'dompurify'
import api from '@/api/client'
import { useAuth } from '@/hooks/useAuth'
import { useCompanies } from '@/api/companies'

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'superadmin' | 'admin' | 'supervisor' | 'agent' | 'mercadeo'

interface Department {
  id: number
  name: string
}

interface User {
  id: number
  name: string
  email: string
  role: Role
  company_name: string | null
  department_id: number | null
  department_name: string | null
  is_online: boolean
  can_campaigns: boolean
  can_advertising: boolean
  open_conversations_count: number
}

interface PaginationLink {
  url: string | null
  label: string
  active: boolean
}

interface UsersResponse {
  data: User[]
  current_page: number
  last_page: number
  per_page: number
  total: number
  links: PaginationLink[]
}

interface UserFormData {
  name: string
  email: string
  password: string
  role: Role
  department_id: string
  company_id: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_BADGE: Record<Role, string> = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  supervisor: 'bg-orange-100 text-orange-700',
  agent: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500',
  mercadeo: 'bg-pink-100 text-pink-700',
}

const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  supervisor: 'Supervisor',
  agent: 'Agente',
  mercadeo: 'Mercadeo',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ─── Empty form ───────────────────────────────────────────────────────────────

const emptyForm: UserFormData = {
  name: '',
  email: '',
  password: '',
  role: 'agent',
  department_id: '',
  company_id: '',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const qc = useQueryClient()
  const currentUser = useAuth()

  // Toolbar state
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search, 300)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form, setForm] = useState<UserFormData>(emptyForm)
  const [formErrors, setFormErrors] = useState<Partial<UserFormData>>({})

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletingUser, setDeletingUser] = useState<User | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: usersData, isLoading } = useQuery<UsersResponse>({
    queryKey: ['admin-users', debouncedSearch, roleFilter, page],
    queryFn: async () => {
      const res = await api.get('/admin/users', {
        params: { search: debouncedSearch, role: roleFilter, page },
      })
      return res.data
    },
    placeholderData: (prev) => prev,
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin-departments'],
    queryFn: async () => {
      const res = await api.get('/admin/departments')
      return res.data.data ?? res.data
    },
  })

  const { data: companies = [] } = useCompanies()

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-users'] })

  const createMutation = useMutation({
    mutationFn: (data: UserFormData) => api.post('/admin/users', data),
    onSuccess: () => {
      toast.success('Usuario creado correctamente')
      closeModal()
      invalidate()
    },
    onError: (err: any) => {
      const errors = err.response?.data?.errors
      if (errors) setFormErrors(errors)
      else toast.error(err.response?.data?.message ?? 'Error al crear usuario')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<UserFormData> }) =>
      api.put(`/admin/users/${id}`, data),
    onSuccess: () => {
      toast.success('Usuario actualizado correctamente')
      closeModal()
      invalidate()
    },
    onError: (err: any) => {
      const errors = err.response?.data?.errors
      if (errors) setFormErrors(errors)
      else toast.error(err.response?.data?.message ?? 'Error al actualizar usuario')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/users/${id}`),
    onSuccess: () => {
      toast.success('Usuario eliminado')
      setDeleteModalOpen(false)
      setDeletingUser(null)
      invalidate()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al eliminar usuario')
    },
  })

  const toggleCampaignsMutation = useMutation({
    mutationFn: (id: number) => api.post(`/admin/users/${id}/toggle-campaigns`),
    onSuccess: () => { toast.success('Permiso de campañas actualizado'); invalidate() },
    onError: () => toast.error('Error al cambiar permiso'),
  })

  const toggleAdvertisingMutation = useMutation({
    mutationFn: (id: number) => api.post(`/admin/users/${id}/toggle-advertising`),
    onSuccess: () => { toast.success('Permiso de publicidad actualizado'); invalidate() },
    onError: () => toast.error('Error al cambiar permiso'),
  })

  // ── Handlers ───────────────────────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setEditingUser(null)
    setForm(emptyForm)
    setFormErrors({})
    setModalOpen(true)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = useCallback((user: User) => {
    setEditingUser(user)
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      department_id: user.department_id ? String(user.department_id) : '',
      company_id: '',
    })
    setFormErrors({})
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingUser(null)
    setForm(emptyForm)
    setFormErrors({})
  }, [])

  const openDelete = useCallback((user: User) => {
    setDeletingUser(user)
    setDeleteModalOpen(true)
  }, [])

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setFormErrors((prev) => ({ ...prev, [name]: undefined }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingUser) {
      const payload: Partial<UserFormData> = { ...form }
      if (!payload.password) delete payload.password
      updateMutation.mutate({ id: editingUser.id, data: payload })
    } else {
      createMutation.mutate(form)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [debouncedSearch, roleFilter])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Usuarios</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Gestiona los usuarios de la plataforma
        </p>
      </div>

      {/* Toolbar — búsqueda, filtro rol y botón "Nuevo usuario" en el mismo row */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder="Buscar usuario..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-200 dark:border-gray-600 rounded-xl pl-9 pr-4 py-2 text-sm w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
        >
          <option value="">Todos los roles</option>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <button
          onClick={openCreate}
          className="ml-auto flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-opacity"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={16} />
          Nuevo usuario
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-3"><div className="flex items-center gap-3"><div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700" /><div className="space-y-1"><div className="h-3 w-28 rounded bg-gray-200 dark:bg-gray-700" /><div className="h-2.5 w-40 rounded bg-gray-100 dark:bg-gray-600" /></div></div></td>
                    <td className="px-4 py-3"><div className="h-5 w-20 rounded-full bg-gray-200 dark:bg-gray-700" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 rounded-full bg-gray-200 dark:bg-gray-700" /></td>
                    <td className="px-4 py-3"><div className="h-7 w-16 rounded-lg bg-gray-200 dark:bg-gray-700" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-6 py-3">
                    Usuario
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3">
                    Rol
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3">
                    Empresa
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3">
                    Departamento
                  </th>
                  <th className="text-left text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-4 py-3">
                    Estado
                  </th>
                  <th className="text-right text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold px-6 py-3">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {usersData?.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400 dark:text-gray-500">
                      No se encontraron usuarios
                    </td>
                  </tr>
                )}
                {usersData?.data?.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900/50 transition-colors">
                    {/* Avatar + Name + Email */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                            style={{ backgroundColor: 'var(--color-primary)' }}
                          >
                            {getInitials(user.name)}
                          </div>
                          <span
                            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${
                              user.is_online ? 'bg-green-400' : 'bg-gray-300'
                            }`}
                          />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight">{user.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 leading-tight">{user.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Role badge */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          ROLE_BADGE[user.role] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {ROLE_LABELS[user.role] ?? user.role}
                      </span>
                    </td>

                    {/* Company */}
                    <td className="px-4 py-4 text-gray-700 dark:text-gray-300">
                      {user.company_name ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Department */}
                    <td className="px-4 py-4 text-gray-700 dark:text-gray-300">
                      {user.department_name ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Online status */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                          user.is_online ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            user.is_online ? 'bg-green-500' : 'bg-gray-300'
                          }`}
                        />
                        {user.is_online ? 'En línea' : 'Desconectado'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {/* Toggle publicidad: solo visible para supervisores */}
                        {user.role === 'supervisor' && (
                          <button
                            onClick={() => toggleAdvertisingMutation.mutate(user.id)}
                            disabled={toggleAdvertisingMutation.isPending}
                            title={user.can_advertising ? 'Acceso Publicidad activo — clic para revocar' : 'Sin acceso Publicidad — clic para habilitar'}
                            className={`inline-flex items-center gap-1 text-xs rounded-lg px-2 py-1 border transition-colors ${
                              user.can_advertising
                                ? 'border-pink-200 text-pink-700 bg-pink-50 hover:bg-pink-100'
                                : 'border-gray-200 text-gray-400 bg-white dark:bg-gray-800 hover:bg-gray-50'
                            }`}
                          >
                            Pub
                          </button>
                        )}

                        {/* Agent toggle: Campañas */}
                        {user.role === 'agent' && (
                          <button
                            onClick={() => toggleCampaignsMutation.mutate(user.id)}
                            disabled={toggleCampaignsMutation.isPending}
                            title={user.can_campaigns ? 'Quitar acceso campañas' : 'Dar acceso campañas'}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                              user.can_campaigns
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            Campañas
                          </button>
                        )}

                        <button
                          onClick={() => openEdit(user)}
                          className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Editar"
                        >
                          <Pencil size={15} />
                        </button>

                        {user.id !== currentUser.user?.id && (
                          <button
                            onClick={() => openDelete(user)}
                            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {usersData && usersData.last_page > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
              Mostrando {usersData.data.length} de {usersData.total} usuarios
            </p>
            <div className="flex items-center gap-1">
              {usersData.links.map((link, i) => {
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

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {editingUser ? 'Editar usuario' : 'Nuevo usuario'}
              </h2>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Nombre completo
                </label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  placeholder="Ej. Juan Pérez"
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] ${
                    formErrors.name ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {formErrors.name && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Correo electrónico
                </label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleFormChange}
                  placeholder="usuario@empresa.com"
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] ${
                    formErrors.email ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {formErrors.email && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.email}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Contraseña{editingUser && (
                    <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">(dejar en blanco para no cambiar)</span>
                  )}
                </label>
                <input
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={handleFormChange}
                  placeholder={editingUser ? '••••••••' : 'Mínimo 8 caracteres'}
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] ${
                    formErrors.password ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {formErrors.password && (
                  <p className="text-xs text-red-500 mt-1">{formErrors.password}</p>
                )}
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Rol</label>
                <select
                  name="role"
                  value={form.role}
                  onChange={handleFormChange}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-white dark:bg-gray-800"
                >
                  {currentUser.isSuperAdmin && (
                    <>
                      <option value="superadmin">Super Admin</option>
                      <option value="admin">Admin</option>
                    </>
                  )}
                  <option value="supervisor">Supervisor</option>
                  <option value="agent">Agente</option>
                  <option value="mercadeo">Mercadeo</option>
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Departamento
                </label>
                <select
                  name="department_id"
                  value={form.department_id}
                  onChange={handleFormChange}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-white dark:bg-gray-800"
                >
                  <option value="">Sin departamento</option>
                  {departments.map((d) => (
                    <option key={d.id} value={String(d.id)}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Empresa — solo superadmin */}
              {currentUser.isSuperAdmin && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Empresa
                  </label>
                  <select
                    name="company_id"
                    value={form.company_id}
                    onChange={handleFormChange}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-white dark:bg-gray-800"
                  >
                    <option value="">Sin empresa</option>
                    {companies.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

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
                  {editingUser ? 'Guardar cambios' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ────────────────────────────────────────────── */}
      {deleteModalOpen && deletingUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Eliminar usuario</h2>
              <button
                onClick={() => { setDeleteModalOpen(false); setDeletingUser(null) }}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                ¿Estás seguro de que deseas eliminar a{' '}
                <span className="font-semibold">{deletingUser.name}</span>?
              </p>
              {deletingUser.open_conversations_count > 0 && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <span className="text-amber-500 text-base leading-none mt-0.5">⚠️</span>
                  <p className="text-xs text-amber-700">
                    Este usuario tiene{' '}
                    <span className="font-semibold">
                      {deletingUser.open_conversations_count} conversación
                      {deletingUser.open_conversations_count !== 1 ? 'es' : ''} abierta
                      {deletingUser.open_conversations_count !== 1 ? 's' : ''}
                    </span>
                    . Al eliminarlo, esas conversaciones quedarán sin agente asignado.
                  </p>
                </div>
              )}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setDeleteModalOpen(false); setDeletingUser(null) }}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(deletingUser.id)}
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
