// WhatsAppPricingPage — Página de administración de tarifas de WhatsApp.
//
// Permite ver, editar e importar las tarifas de WhatsApp Business API por país.
// Los precios están expresados en USD por conversación de 24 horas según las
// categorías de Meta: marketing, utilidad, autenticación y servicio.
//
// Funcionalidades:
//   - Buscar países por nombre o código
//   - Editar precios manualmente por país (modal de edición)
//   - Importar precios desde CSV (formato Meta)
//   - Las celdas de servicio=0 muestran "Gratis" en verde (igual que v2)

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, X, ExternalLink, FileText, CheckCircle2 } from 'lucide-react'
import api from '@/api/client'
import { toast } from 'react-hot-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WhatsAppPricing {
  id: number
  country_code: string
  country_name: string
  marketing: number
  utility: number
  authentication: number
  service: number
  updated_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Formatea un precio USD con 4 decimales (ej: "$0.0274"). */
function fmtUSD(v: number): string {
  return `$${v.toFixed(4)}`
}

/** Formatea una fecha ISO a dd/mm/yyyy. */
function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
  } catch { return '—' }
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function WhatsAppPricingPage() {
  const qc = useQueryClient()

  // Estado del buscador de países
  const [search, setSearch] = useState('')

  // Estado del modal de edición manual
  const [editRow, setEditRow] = useState<WhatsAppPricing | null>(null)
  const [editFields, setEditFields] = useState({ marketing: '', utility: '', authentication: '', service: '' })

  // Estado del modal de importación CSV
  const [showCsv, setShowCsv] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Queries ──────────────────────────────────────────────────────────────

  /** Carga la lista completa de tarifas desde el backend. */
  const { data, isLoading, isError } = useQuery<{ data: WhatsAppPricing[] }>({
    queryKey: ['whatsapp-pricing'],
    queryFn: () => api.get('/admin/whatsapp-pricing').then(r => r.data),
  })

  // Lista filtrada por el buscador (búsqueda en nombre o código de país)
  const rows = (data?.data ?? []).filter(r =>
    r.country_name.toLowerCase().includes(search.toLowerCase()) ||
    r.country_code.toLowerCase().includes(search.toLowerCase())
  )

  // ─── Mutations ────────────────────────────────────────────────────────────

  /** Guarda los precios editados para un país. */
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      api.put(`/admin/whatsapp-pricing/${id}`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-pricing'] })
      setEditRow(null)
      toast.success('Precios actualizados')
    },
    onError: () => toast.error('Error al guardar los precios'),
  })

  /** Importa precios desde el archivo CSV seleccionado. */
  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post('/admin/whatsapp-pricing/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['whatsapp-pricing'] })
      setShowCsv(false)
      setCsvFile(null)
      const msg = res.skipped > 0
        ? `${res.imported} países importados (${res.skipped} filas ignoradas)`
        : `${res.imported} países importados correctamente`
      toast.success(msg)
    },
    onError: () => toast.error('Error al importar el CSV'),
  })

  // ─── Handlers ─────────────────────────────────────────────────────────────

  /** Abre el modal de edición con los valores actuales del país seleccionado. */
  function openEdit(row: WhatsAppPricing) {
    setEditRow(row)
    setEditFields({
      marketing:      row.marketing.toString(),
      utility:        row.utility.toString(),
      authentication: row.authentication.toString(),
      service:        row.service.toString(),
    })
  }

  /** Guarda los nuevos precios del modal de edición. */
  function handleSave() {
    if (!editRow) return
    updateMutation.mutate({
      id: editRow.id,
      body: {
        marketing:      parseFloat(editFields.marketing)      || 0,
        utility:        parseFloat(editFields.utility)        || 0,
        authentication: parseFloat(editFields.authentication) || 0,
        service:        parseFloat(editFields.service)        || 0,
      },
    })
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">

      {/* Header con buscador y botones de acción */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Buscador de países */}
        <input
          type="text"
          placeholder="Buscar país..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2 text-sm w-64 focus:outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />

        {/* Botón de importación CSV */}
        <button
          onClick={() => setShowCsv(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <Upload size={15} />
          Importar CSV
        </button>

        {/* Enlace a documentación de Meta (abre en nueva pestaña) */}
        <a
          href="https://developers.facebook.com/docs/whatsapp/pricing"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 transition-colors"
        >
          Fuente: Meta WhatsApp Pricing
          <ExternalLink size={11} />
        </a>
      </div>

      {/* Tabla de tarifas */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/60 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">País</th>
                <th className="px-5 py-3 text-right">Marketing</th>
                <th className="px-5 py-3 text-right">Utilidad</th>
                <th className="px-5 py-3 text-right">Autenticación</th>
                <th className="px-5 py-3 text-right">Servicio</th>
                <th className="px-5 py-3 text-right">Actualizado</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                    Cargando tarifas...
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-red-400 text-sm">
                    Error al cargar las tarifas. Intenta recargar la página.
                  </td>
                </tr>
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                    No hay países registrados.
                  </td>
                </tr>
              )}
              {!isLoading && !isError && rows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                  {/* País: badge con código + nombre */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                        {row.country_code}
                      </span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">{row.country_name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-gray-700 dark:text-gray-300 text-xs">
                    {fmtUSD(row.marketing)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-gray-700 dark:text-gray-300 text-xs">
                    {fmtUSD(row.utility)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-gray-700 dark:text-gray-300 text-xs">
                    {fmtUSD(row.authentication)}
                  </td>
                  {/* Servicio: "Gratis" cuando el precio es 0 (igual que v2) */}
                  <td className="px-5 py-3 text-right font-mono text-xs">
                    {row.service === 0
                      ? <span className="text-green-600 dark:text-green-400 font-semibold">Gratis</span>
                      : <span className="text-gray-700 dark:text-gray-300">{fmtUSD(row.service)}</span>
                    }
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400 dark:text-gray-500">
                    {fmtDate(row.updated_at)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => openEdit(row)}
                      className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pie de tabla con count */}
        {!isLoading && !isError && rows.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
            Precios en USD por conversación de 24 horas · {rows.length} {rows.length === 1 ? 'país' : 'países'}
          </div>
        )}
      </div>

      {/* ── Modal de edición de precios ──────────────────────────────────────── */}
      {editRow && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6">
            {/* Encabezado del modal */}
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100">
                  Editar precios — {editRow.country_name}
                </h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  Precios en USD por conversación de 24h. Fuente:{' '}
                  <a
                    href="https://developers.facebook.com/docs/whatsapp/pricing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-blue-500 hover:text-blue-700"
                  >
                    Meta Pricing
                  </a>
                </p>
              </div>
              <button onClick={() => setEditRow(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
                <X size={18} />
              </button>
            </div>

            {/* Campos de precio */}
            <div className="space-y-3 mt-4">
              {([
                { key: 'marketing',      label: 'Marketing' },
                { key: 'utility',        label: 'Utilidad' },
                { key: 'authentication', label: 'Autenticación' },
                { key: 'service',        label: 'Servicio' },
              ] as const).map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      step="0.000001"
                      min="0"
                      value={editFields[key]}
                      onChange={e => setEditFields(prev => ({ ...prev, [key]: e.target.value }))}
                      className="flex-1 border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      style={{ ['--tw-ring-color' as string]: 'var(--color-primary)' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Nota informativa */}
            <p className="mt-4 text-xs text-gray-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2">
              Consultá los precios actualizados en{' '}
              <a
                href="https://developers.facebook.com/docs/whatsapp/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline"
              >
                developers.facebook.com/docs/whatsapp/pricing
              </a>
            </p>

            {/* Botones del modal */}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setEditRow(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {updateMutation.isPending ? 'Guardando...' : 'Guardar precios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de importación CSV ─────────────────────────────────────────── */}
      {showCsv && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-6">
            {/* Encabezado */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100">Importar precios desde CSV</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Descarga la tabla de{' '}
                  <a
                    href="https://developers.facebook.com/docs/whatsapp/pricing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 underline hover:text-blue-700"
                  >
                    Meta WhatsApp Pricing
                  </a>
                  {' '}y súbela aquí.
                </p>
              </div>
              <button
                onClick={() => { setShowCsv(false); setCsvFile(null) }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
              >
                <X size={18} />
              </button>
            </div>

            {/* Formato esperado */}
            <div className="bg-gray-50 dark:bg-gray-700/60 rounded-xl px-4 py-2.5 mb-4 text-xs text-gray-500 dark:text-gray-400 font-mono leading-relaxed">
              <span className="text-gray-400"># Formato esperado (encabezado obligatorio):</span><br />
              country_code,country_name,marketing,utility,authentication,service<br />
              CR,Costa Rica,0.0750,0.0330,0.0370,0.0000<br />
              US,United States,0.0250,0.0100,0.0100,0.0000
            </div>

            {/* Zona de drag & drop */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setCsvFile(f) }}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => {
                e.preventDefault()
                setIsDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) setCsvFile(f)
              }}
              className={`cursor-pointer rounded-2xl border-2 border-dashed transition-colors p-8 flex flex-col items-center gap-3 ${
                isDragging
                  ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                  : csvFile
                  ? 'border-green-400 bg-green-50 dark:bg-green-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 bg-gray-50 dark:bg-gray-700/40'
              }`}
            >
              {csvFile ? (
                <>
                  <CheckCircle2 size={32} className="text-green-500" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{csvFile.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {(csvFile.size / 1024).toFixed(1)} KB · Clic para cambiar
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <FileText size={32} className="text-gray-300 dark:text-gray-500" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                      Arrastra el archivo CSV aquí
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      o haz clic para seleccionar · Solo archivos .csv
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Botones */}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setShowCsv(false); setCsvFile(null) }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => csvFile && importMutation.mutate(csvFile)}
                disabled={importMutation.isPending || !csvFile}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {importMutation.isPending ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Upload size={15} />
                    Importar precios
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
