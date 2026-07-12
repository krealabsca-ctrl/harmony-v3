import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Search, Building2, X } from 'lucide-react'
import api from '@/api/client'

interface Company {
  id: number
  name: string
  slug: string
  primary_color: string
  secondary_color: string
  omnichannel_enabled: boolean
  advertising_enabled: boolean
  is_active: boolean
  logo_url?: string
  departments_count?: number
  users_count?: number
}

interface PaginatedResponse {
  data: Company[]
  links: {
    first: string | null
    last: string | null
    prev: string | null
    next: string | null
  }
  meta: {
    current_page: number
    from: number
    last_page: number
    per_page: number
    to: number
    total: number
  }
}

interface CompanyForm {
  name: string
  slug: string
  primary_color: string
  secondary_color: string
  omnichannel_enabled: boolean
  advertising_enabled: boolean
  is_active: boolean
}

const defaultForm: CompanyForm = {
  name: '',
  slug: '',
  primary_color: '#6D28D9',
  secondary_color: '#4C1D95',
  omnichannel_enabled: false,
  advertising_enabled: false,
  is_active: true,
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[Ã¡Ã Ã¤Ã¢]/g, 'a')
    .replace(/[Ã©Ã¨Ã«Ãª]/g, 'e')
    .replace(/[Ã­Ã¬Ã¯Ã®]/g, 'i')
    .replace(/[Ã³Ã²Ã¶Ã´]/g, 'o')
    .replace(/[ÃºÃ¹Ã¼Ã»]/g, 'u')
    .replace(/Ã±/g, 'n')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export default function CompaniesPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // Modal crear
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState<CompanyForm>(defaultForm)
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)

  // Modal editar
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<CompanyForm>(defaultForm)

  // Modal eliminar
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deletingName, setDeletingName] = useState('')

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['companies', search, page],
    queryFn: async () => {
      const res = await api.get('/admin/companies', {
        params: { search: search || undefined, page },
      })
      return res.data
    },
    placeholderData: (prev) => prev,
  })

  const createMutation = useMutation({
    mutationFn: (body: CompanyForm) => api.post('/admin/companies', body),
    onSuccess: () => {
      toast.success('Empresa creada y base de datos provisionada.')
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      setShowCreateModal(false)
      setCreateForm(defaultForm)
      setSlugManuallyEdited(false)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Error al crear la empresa.'
      toast.error(msg)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: CompanyForm & { id: number }) =>
      api.put(`/admin/companies/${id}`, body),
    onSuccess: () => {
      toast.success('Empresa actualizada.')
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      setEditingId(null)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Error al actualizar la empresa.'
      toast.error(msg)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/companies/${id}`),
    onSuccess: () => {
      toast.success('Empresa eliminada.')
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      setDeletingId(null)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Error al eliminar la empresa.'
      toast.error(msg)
    },
  })

  const toggleOmnichannelMutation = useMutation({
    mutationFn: ({ id, omnichannel_enabled }: { id: number; omnichannel_enabled: boolean }) =>
      api.put(`/admin/companies/${id}`, { omnichannel_enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
    onError: () => toast.error('Error al cambiar mÃ³dulo Omnicanal.'),
  })

  const toggleAdvertisingMutation = useMutation({
    mutationFn: ({ id, advertising_enabled }: { id: number; advertising_enabled: boolean }) =>
      api.put(`/admin/companies/${id}`, { advertising_enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
    onError: () => toast.error('Error al cambiar mÃ³dulo Publicidad.'),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      api.put(`/admin/companies/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['companies'] }),
    onError: () => toast.error('Error al actualizar el estado.'),
  })

  // Auto-slug para crear
  useEffect(() => {
    if (!slugManuallyEdited) {
      setCreateForm((f) => ({ ...f, slug: slugify(f.name) }))
    }
  }, [createForm.name, slugManuallyEdited])

  const openCreate = () => {
    setCreateForm(defaultForm)
    setSlugManuallyEdited(false)
    setShowCreateModal(true)
  }

  const openEdit = (company: Company) => {
    setEditForm({
      name: company.name,
      slug: company.slug,
      primary_color: company.primary_color,
      secondary_color: company.secondary_color,
      omnichannel_enabled: company.omnichannel_enabled,
      advertising_enabled: company.advertising_enabled,
      is_active: company.is_active,
    })
    setEditingId(company.id)
  }

  const openDelete = (company: Company) => {
    setDeletingId(company.id)
    setDeletingName(company.name)
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!createForm.name.trim() || !createForm.slug.trim()) {
      toast.error('Nombre y slug son requeridos.')
      return
    }
    createMutation.mutate(createForm)
  }

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editForm.name.trim() || !editForm.slug.trim()) {
      toast.error('Nombre y slug son requeridos.')
      return
    }
    updateMutation.mutate({ id: editingId!, ...editForm })
  }

  const companies = data?.data ?? []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Empresas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">GestiÃ³n de empresas del sistema</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-xl shadow-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus className="w-4 h-4" />
          Nueva empresa
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          placeholder="Buscar empresa..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px] divide-y divide-gray-100">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Empresa
                </th>
                <th className="px-5 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Departamentos
                </th>
                <th className="px-5 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Usuarios
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Estado
                </th>
                <th className="px-5 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  MÃ³dulos
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-32" />
                          <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-20" />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center"><div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-8 mx-auto" /></td>
                    <td className="px-5 py-3 text-center"><div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-8 mx-auto" /></td>
                    <td className="px-5 py-3"><div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-16" /></td>
                    <td className="px-5 py-3"><div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-24 mx-auto" /></td>
                    <td className="px-5 py-3" />
                  </tr>
                ))
              ) : companies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-sm text-gray-400 dark:text-gray-500">No hay empresas.</p>
                  </td>
                </tr>
              ) : (
                companies.map((company) => (
                  <tr
                    key={company.id}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                      !company.is_active ? 'opacity-60' : ''
                    }`}
                  >
                    {/* Empresa */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {company.logo_url ? (
                          <img
                            src={company.logo_url}
                            alt={company.name}
                            className="w-8 h-8 rounded-lg object-cover border border-gray-100 dark:border-gray-700"
                          />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-lg flex-shrink-0"
                            style={{ backgroundColor: company.primary_color || 'var(--color-primary)' }}
                          />
                        )}
                        <div>
                          <p className="font-medium text-gray-900 dark:text-gray-100">{company.name}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{company.slug}</p>
                        </div>
                      </div>
                    </td>

                    {/* Departamentos */}
                    <td className="px-5 py-3 text-center text-sm text-gray-700 dark:text-gray-300">
                      {company.departments_count ?? 0}
                    </td>

                    {/* Usuarios */}
                    <td className="px-5 py-3 text-center text-sm text-gray-700 dark:text-gray-300">
                      {company.users_count ?? 0}
                    </td>

                    {/* Estado */}
                    <td className="px-5 py-3">
                      <button
                        onClick={() =>
                          toggleActiveMutation.mutate({ id: company.id, is_active: !company.is_active })
                        }
                        disabled={toggleActiveMutation.isPending}
                        className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-colors disabled:opacity-50 ${
                          company.is_active
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            company.is_active ? 'bg-green-500' : 'bg-gray-400'
                          }`}
                        />
                        {company.is_active ? 'Activa' : 'Deshabilitada'}
                      </button>
                    </td>

                    {/* MÃ³dulos */}
                    <td className="px-5 py-3">
                      <div className="flex flex-col items-center gap-1">
                        <button
                          onClick={() =>
                            toggleOmnichannelMutation.mutate({
                              id: company.id,
                              omnichannel_enabled: !company.omnichannel_enabled,
                            })
                          }
                          disabled={toggleOmnichannelMutation.isPending}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium transition-colors disabled:opacity-50 ${
                            company.omnichannel_enabled
                              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              company.omnichannel_enabled ? 'bg-blue-500' : 'bg-gray-400'
                            }`}
                          />
                          Omnicanal
                        </button>
                        <button
                          onClick={() =>
                            toggleAdvertisingMutation.mutate({
                              id: company.id,
                              advertising_enabled: !company.advertising_enabled,
                            })
                          }
                          disabled={toggleAdvertisingMutation.isPending}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium transition-colors disabled:opacity-50 ${
                            company.advertising_enabled
                              ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              company.advertising_enabled ? 'bg-purple-500' : 'bg-gray-400'
                            }`}
                          />
                          Publicidad
                        </button>
                      </div>
                    </td>

                    {/* Acciones */}
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(company)}
                          className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => openDelete(company)}
                          className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2.5 py-1 hover:bg-red-50 transition-colors"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* PaginaciÃ³n */}
        {data && data.meta && data.meta.last_page > 1 && (
          <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Mostrando {data.meta.from ?? 0}â€“{data.meta.to ?? 0} de {data.meta.total} empresas
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!data.links.prev}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Anterior
              </button>
              {Array.from({ length: data.meta.last_page }, (_, i) => i + 1)
                .filter((p) => Math.abs(p - page) <= 2)
                .map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      p === page
                        ? 'text-white border-transparent'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                    style={p === page ? { backgroundColor: 'var(--color-primary)' } : undefined}
                  >
                    {p}
                  </button>
                ))}
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!data.links.next}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* â”€â”€â”€ Modal: Crear empresa â”€â”€â”€ */}
      {showCreateModal && (
        <CompanyFormModal
          title="Nueva Empresa"
          form={createForm}
          setForm={setCreateForm}
          onSubmit={handleCreateSubmit}
          onClose={() => setShowCreateModal(false)}
          isPending={createMutation.isPending}
          submitLabel="Crear empresa"
          onSlugChange={(val) => {
            setSlugManuallyEdited(true)
            setCreateForm((f) => ({ ...f, slug: val }))
          }}
        />
      )}

      {/* â”€â”€â”€ Modal: Editar empresa â”€â”€â”€ */}
      {editingId !== null && (
        <CompanyFormModal
          title="Editar Empresa"
          form={editForm}
          setForm={setEditForm}
          onSubmit={handleEditSubmit}
          onClose={() => setEditingId(null)}
          isPending={updateMutation.isPending}
          submitLabel="Guardar cambios"
        />
      )}

      {/* â”€â”€â”€ Modal: Confirmar eliminaciÃ³n â”€â”€â”€ */}
      {deletingId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-2">Â¿Eliminar empresa?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Esta acciÃ³n no se puede deshacer. Se eliminarÃ¡n todos los datos de{' '}
              <span className="font-medium text-gray-800 dark:text-gray-200">{deletingName}</span>.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate(deletingId)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 rounded-xl text-white text-sm font-medium disabled:opacity-60 transition-colors"
              >
                {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// â”€â”€â”€ Componente compartido para modal crear/editar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CompanyFormModalProps {
  title: string
  form: CompanyForm
  setForm: React.Dispatch<React.SetStateAction<CompanyForm>>
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
  isPending: boolean
  submitLabel: string
  onSlugChange?: (val: string) => void
}

interface CompanyForm {
  name: string
  slug: string
  primary_color: string
  secondary_color: string
  omnichannel_enabled: boolean
  advertising_enabled: boolean
  is_active: boolean
}

function CompanyFormModal({
  title,
  form,
  setForm,
  onSubmit,
  onClose,
  isPending,
  submitLabel,
  onSlugChange,
}: CompanyFormModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={onSubmit} className="px-6 py-5 space-y-4">
          {/* Nombre */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej: Acme Corp"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              required
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Slug (identificador Ãºnico) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) =>
                onSlugChange
                  ? onSlugChange(e.target.value)
                  : setForm((f) => ({ ...f, slug: e.target.value }))
              }
              placeholder="acme-corp"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
              required
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Identificador Ãºnico. Se genera automÃ¡ticamente del nombre.
            </p>
          </div>

          {/* Colores */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Color Primario
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={form.primary_color}
                  onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                  className="w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer p-1"
                />
                <input
                  type="text"
                  value={form.primary_color}
                  onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                  className="flex-1 border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Color Secundario
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={form.secondary_color}
                  onChange={(e) => setForm((f) => ({ ...f, secondary_color: e.target.value }))}
                  className="w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer p-1"
                />
                <input
                  type="text"
                  value={form.secondary_color}
                  onChange={(e) => setForm((f) => ({ ...f, secondary_color: e.target.value }))}
                  className="flex-1 border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* MÃ³dulos */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">MÃ³dulos habilitados</p>

            {/* Omnicanal */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700">
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Omnicanal</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">WhatsApp, Messenger, Instagram, Telegram</p>
              </div>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, omnichannel_enabled: !f.omnichannel_enabled }))}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                style={{ backgroundColor: form.omnichannel_enabled ? 'var(--color-primary)' : '#d1d5db' }}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    form.omnichannel_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Publicidad */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700">
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Publicidad</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">CampaÃ±as, leads, contenido, calendario</p>
              </div>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, advertising_enabled: !f.advertising_enabled }))}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                style={{ backgroundColor: form.advertising_enabled ? '#7c3aed' : '#d1d5db' }}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    form.advertising_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Empresa activa */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="rounded"
              style={{ accentColor: 'var(--color-primary)' }}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Empresa activa</span>
          </label>

          {/* Footer */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 py-2.5 text-sm font-medium text-white rounded-xl shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {isPending ? (
                <>
                  <svg
                    className="animate-spin w-4 h-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Guardando...
                </>
              ) : (
                submitLabel
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

