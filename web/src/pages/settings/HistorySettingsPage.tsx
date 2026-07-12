import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { History, Trash2, Eye, AlertTriangle, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '@/api/client'
import { useAuth } from '@/hooks/useAuth'

interface HistorySettings {
  enabled: boolean
  retention_days: number | null
  superadmin_max_days: number | null
}

interface Company {
  id: number
  name: string
  retention_days: number | null
  superadmin_max_days: number | null
}

interface DeletePreview {
  count: number
  from: string
  to: string
}

export default function HistorySettingsPage() {
  const { isSuperAdmin } = useAuth()
  const qc = useQueryClient()

  // Superadmin: límite global por empresa
  const [saCompanyId, setSaCompanyId] = useState<number | null>(null)
  const [saMaxDays, setSaMaxDays] = useState<number>(365)

  // Admin: retención automática
  const [enabled, setEnabled] = useState(false)
  const [retentionDays, setRetentionDays] = useState<number>(90)

  // Eliminación manual
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [preview, setPreview] = useState<DeletePreview | null>(null)

  const { data: settings } = useQuery<HistorySettings>({
    queryKey: ['history-settings'],
    queryFn: () => api.get('/settings/history').then(r => r.data.data),
  })

  // react-query v5 eliminó onSuccess de useQuery; inicializar el formulario vía efecto.
  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled ?? false)
      setRetentionDays(settings.retention_days ?? 90)
    }
  }, [settings])

  const { data: companies } = useQuery<Company[]>({
    queryKey: ['companies-history'],
    queryFn: () => api.get('/admin/companies').then(r => r.data.data ?? r.data),
    enabled: isSuperAdmin,
  })

  const saveSaLimitMutation = useMutation({
    mutationFn: () =>
      api.put(`/admin/companies/${saCompanyId}/retention-limit`, { max_days: saMaxDays }),
    onSuccess: () => {
      toast.success('Límite guardado')
      qc.invalidateQueries({ queryKey: ['companies-history'] })
    },
    onError: () => toast.error('Error al guardar el límite'),
  })

  const saveRetentionMutation = useMutation({
    mutationFn: () =>
      api.put('/settings/history', { enabled, retention_days: enabled ? retentionDays : null }),
    onSuccess: () => toast.success('Configuración guardada'),
    onError: () => toast.error('Error al guardar'),
  })

  const previewMutation = useMutation({
    mutationFn: () =>
      api.get('/settings/history/preview', { params: { from, to } }).then(r => r.data),
    onSuccess: (d) => setPreview(d),
    onError: () => toast.error('Error al obtener la vista previa'),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      api.delete('/settings/history/conversations', { data: { from, to } }),
    onSuccess: (r) => {
      toast.success(`Se eliminaron ${r.data.deleted ?? 0} conversaciones`)
      setPreview(null)
      setFrom('')
      setTo('')
    },
    onError: () => toast.error('Error al eliminar'),
  })

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <History className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Historial</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Configuración de retención y eliminación de conversaciones
          </p>
        </div>
      </div>

      {/* Card 1: Límite por empresa (solo superadmin) */}
      {isSuperAdmin && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              Límite máximo de retención por empresa
            </h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Establece el máximo de días que una empresa puede conservar conversaciones.
            Si el admin ya tenía configurados más días, se reducirá automáticamente al guardar.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Empresa
              </label>
              <select
                value={saCompanyId ?? ''}
                onChange={e => {
                  const id = Number(e.target.value)
                  setSaCompanyId(id || null)
                  const c = companies?.find(c => c.id === id)
                  if (c?.superadmin_max_days) setSaMaxDays(c.superadmin_max_days)
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="">— Seleccionar empresa —</option>
                {companies?.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.superadmin_max_days ? ` — límite: ${c.superadmin_max_days} días` : ' — sin límite'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Máximo de días permitido
              </label>
              <input
                type="number"
                min={1}
                max={3650}
                value={saMaxDays}
                onChange={e => setSaMaxDays(Number(e.target.value))}
                disabled={!saCompanyId}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
              />
            </div>
          </div>

          <button
            onClick={() => saveSaLimitMutation.mutate()}
            disabled={!saCompanyId || saveSaLimitMutation.isPending}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {saveSaLimitMutation.isPending ? 'Guardando...' : 'Guardar límite'}
          </button>

          {/* Tabla de empresas */}
          {companies && companies.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">Empresa</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">Límite máx. (superadmin)</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">Configurado (admin)</th>
                    <th className="text-left py-2 font-medium text-gray-600 dark:text-gray-400">Retención activa</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map(c => (
                    <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{c.name}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                        {c.superadmin_max_days ? `${c.superadmin_max_days} días` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                        {c.retention_days ? `${c.retention_days} días` : '—'}
                      </td>
                      <td className="py-2">
                        {c.retention_days
                          ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">{c.retention_days} días</span>
                          : <span className="text-gray-400 text-xs">Sin límite</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Card 2: Retención automática */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Retención automática</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          La tarea corre diariamente a las 2:00 AM.
        </p>

        {settings?.superadmin_max_days && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              El superadministrador ha establecido un máximo de{' '}
              <strong>{settings.superadmin_max_days} días</strong> para esta empresa.
              No podés configurar un período mayor.
            </span>
          </div>
        )}

        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <div
            onClick={() => setEnabled(v => !v)}
            className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer ${enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-4' : ''}`} />
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {enabled ? 'Retención automática habilitada' : 'Retención automática deshabilitada'}
          </span>
        </label>

        {enabled && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Eliminar conversaciones cerradas con más de
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={settings?.superadmin_max_days ?? 3650}
                value={retentionDays}
                onChange={e => setRetentionDays(Number(e.target.value))}
                className="w-28 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">días</span>
            </div>
          </div>
        )}

        <button
          onClick={() => saveRetentionMutation.mutate()}
          disabled={saveRetentionMutation.isPending}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {saveRetentionMutation.isPending ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>

      {/* Card 3: Eliminación manual */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Trash2 className="w-5 h-5 text-red-500" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Eliminación manual por rango de fechas</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Solo se eliminan conversaciones con estado <strong>cerrado</strong>. Los mensajes, adjuntos,
          etiquetas e historial de asignación también se eliminan permanentemente.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Desde</label>
            <input
              type="date"
              value={from}
              onChange={e => { setFrom(e.target.value); setPreview(null) }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Hasta</label>
            <input
              type="date"
              value={to}
              onChange={e => { setTo(e.target.value); setPreview(null) }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>

        {preview !== null && (
          <div className={`mb-4 p-3 rounded-xl text-sm ${
            preview.count > 0
              ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'
              : 'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
          }`}>
            {preview.count > 0
              ? `Se encontraron ${preview.count} conversación${preview.count !== 1 ? 'es' : ''} cerrada${preview.count !== 1 ? 's' : ''} en ese rango.`
              : 'No hay conversaciones cerradas en ese rango.'
            }
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => previewMutation.mutate()}
            disabled={!from || !to || previewMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <Eye className="w-4 h-4" />
            {previewMutation.isPending ? 'Consultando...' : 'Vista previa'}
          </button>

          {preview && preview.count > 0 && (
            <button
              onClick={() => {
                if (window.confirm(`¿Eliminar ${preview.count} conversación${preview.count !== 1 ? 'es' : ''}? Esta acción no se puede deshacer.`)) {
                  deleteMutation.mutate()
                }
              }}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              {deleteMutation.isPending ? 'Eliminando...' : `Eliminar ${preview.count} conversación${preview.count !== 1 ? 'es' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
