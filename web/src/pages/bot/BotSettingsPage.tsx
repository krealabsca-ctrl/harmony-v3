import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, CheckCircle, Key } from 'lucide-react'
import api from '@/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

interface BotChannel {
  id: number
  name: string
  type: string
}

interface DeptConfig {
  department_id: number
  department_name: string
  enabled: boolean
  model: string
  instructions: string
  max_context_chars: number
  human_takeover: boolean
  max_daily_responses: number
  channel_ids: number[]
  use_all_docs: boolean
}

interface BotSettings {
  has_api_key: boolean
  departments: DeptConfig[]
  channels: BotChannel[]
}

const MODEL_OPTIONS: Record<string, string> = {
  'claude-haiku-4-5':  'Haiku 4.5 — rápido y económico',
  'claude-sonnet-4-6': 'Sonnet 4.6 — equilibrado',
  'claude-opus-4-8':   'Opus 4.8 — más capaz (recomendado)',
}

// ── Toggle confirm modal ───────────────────────────────────────────────────────

function ConfirmModal({
  deptName, activating, onConfirm, onCancel,
}: { deptName: string; activating: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${activating ? 'bg-green-100' : 'bg-red-100'}`}>
            {activating
              ? <CheckCircle className="w-5 h-5 text-green-600" />
              : <AlertTriangle className="w-5 h-5 text-red-600" />}
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              {activating ? 'Activar bot' : 'Desactivar bot'}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              {activating
                ? `¿Activar el bot para ${deptName}?`
                : '¿Desactivar el bot? Dejará de responder automáticamente.'}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${activating ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'}`}>
            {activating ? 'Activar' : 'Desactivar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Department row ─────────────────────────────────────────────────────────────

function DeptRow({
  dept,
  channels,
  onToggleRequest,
  onSaved,
}: {
  dept: DeptConfig
  channels: BotChannel[]
  onToggleRequest: (dept: DeptConfig) => void
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<DeptConfig>({ ...dept })
  const [savedMsg, setSavedMsg] = useState('')

  const saveMutation = useMutation({
    mutationFn: (payload: DeptConfig) =>
      api.put(`/bot/department/${payload.department_id}`, payload),
    onSuccess: () => {
      setSavedMsg('Configuración guardada.')
      onSaved()
    },
    onError: () => toast.error('Error al guardar la configuración'),
  })

  const toggleOpen = () => {
    if (!open) setForm({ ...dept }) // reset on open
    setSavedMsg('')
    setOpen(o => !o)
  }

  const discard = () => {
    setForm({ ...dept })
    setSavedMsg('')
    setOpen(false)
  }

  const toggleChannel = (id: number) => {
    setForm(f => ({
      ...f,
      channel_ids: f.channel_ids.includes(id)
        ? f.channel_ids.filter(c => c !== id)
        : [...f.channel_ids, id],
    }))
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border transition-all duration-200 ${open ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30' : 'border-gray-200 dark:border-gray-700'}`}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-4">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dept.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-gray-800 dark:text-gray-100">{dept.department_name}</span>
          {dept.enabled
            ? <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Bot activo</span>
            : <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">Bot inactivo</span>}
          {dept.model && <span className="ml-1 text-xs text-gray-400">· {dept.model}</span>}
          {dept.channel_ids.length > 0 && <span className="ml-1 text-xs text-gray-400">· {dept.channel_ids.length} canal(es)</span>}
        </div>

        <button onClick={toggleOpen}
          className={`flex-shrink-0 text-sm px-3 py-1.5 rounded-lg border transition-colors duration-150 ${open ? 'bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
          {open ? 'Cerrar' : 'Configurar'}
        </button>

        {/* Toggle */}
        <button
          onClick={() => onToggleRequest(dept)}
          style={{ background: dept.enabled ? 'var(--color-primary)' : '#D1D5DB' }}
          className="flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200">
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${dept.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Expanded config */}
      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">

          {/* Canales */}
          <div className="px-5 py-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Canales donde el bot responde{' '}
              <span className="font-normal text-gray-400">(deja vacío para todos)</span>
            </label>
            {channels.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No hay canales activos.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {channels.map(ch => {
                  const selected = form.channel_ids.includes(ch.id)
                  return (
                    <label key={ch.id}
                      style={selected ? { borderColor: 'var(--color-primary)' } : {}}
                      className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${selected ? 'bg-[var(--color-primary)]/5' : 'border-gray-200 dark:border-gray-600'}`}>
                      <input type="checkbox" checked={selected} onChange={() => toggleChannel(ch.id)}
                        style={{ accentColor: 'var(--color-primary)' }}
                        className="rounded border-gray-300" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{ch.name}</p>
                        <p className="text-xs text-gray-400 capitalize">{ch.type}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* Modelo */}
          <div className="px-5 py-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Modelo de IA</label>
            <select value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg pl-3 pr-8 py-2 text-sm focus:ring-2 focus:outline-none">
              {Object.entries(MODEL_OPTIONS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          {/* Instrucciones */}
          <div className="px-5 py-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Instrucciones del bot <span className="font-normal text-gray-400">(opcional)</span>
            </label>
            <textarea rows={4} value={form.instructions}
              onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
              maxLength={5000}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none resize-none"
              placeholder="Ej: Eres el asistente de soporte técnico. Responde siempre en español. Si el cliente pide un reembolso, indícale que un agente lo contactará en 24 horas..." />
            <p className={`mt-1 text-xs text-right ${form.instructions.length > 4500 ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              {form.instructions.length} / 5000 caracteres
            </p>
          </div>

          {/* Contexto */}
          <div className="px-5 py-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Contexto de documentos:{' '}
              <strong className="text-gray-900 dark:text-gray-100">{form.max_context_chars.toLocaleString()} caracteres</strong>
            </label>
            <input type="range" min={10000} max={150000} step={5000}
              value={form.max_context_chars}
              onChange={e => setForm(f => ({ ...f, max_context_chars: Number(e.target.value) }))}
              style={{ accentColor: 'var(--color-primary)' }}
              className="w-full" />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>10,000 — más rápido</span><span>150,000 — más contexto</span>
            </div>
          </div>

          {/* Human takeover */}
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Pausar bot si un agente interviene</p>
              <p className="text-xs text-gray-500 mt-0.5">El bot deja de responder cuando un agente humano toma la conversación.</p>
            </div>
            <button onClick={() => setForm(f => ({ ...f, human_takeover: !f.human_takeover }))}
              style={{ background: form.human_takeover ? 'var(--color-primary)' : '#D1D5DB' }}
              className="flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200">
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${form.human_takeover ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 bg-gray-50 dark:bg-gray-900 rounded-b-xl flex items-center justify-between">
            <Link to="/bot/knowledge-base" className="text-sm text-gray-500 hover:underline">
              Base de conocimiento →
            </Link>
            <div className="flex items-center gap-2">
              {savedMsg && (
                <span className="text-sm text-green-600 font-medium">{savedMsg}</span>
              )}
              <button onClick={discard}
                className="px-5 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                Descartar
              </button>
              <button onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                style={{ background: 'var(--color-primary)' }}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2">
                {saveMutation.isPending && <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saveMutation.isPending ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BotSettingsPage() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<BotSettings>({
    queryKey: ['bot-settings'],
    queryFn: () => api.get('/bot/settings').then(r => r.data),
  })

  const [apiKey, setApiKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [confirm, setConfirm] = useState<DeptConfig | null>(null)

  const toggleMutation = useMutation({
    mutationFn: (dept: DeptConfig) => api.post(`/bot/department/${dept.department_id}/toggle`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-settings'] }),
    onError: () => toast.error('Error al cambiar estado del bot'),
  })

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    setSavingKey(true)
    try {
      await api.put('/bot/api-key', { api_key: apiKey })
      toast.success('Clave de API guardada correctamente')
      setApiKey('')
      queryClient.invalidateQueries({ queryKey: ['bot-settings'] })
    } catch {
      toast.error('Error al guardar la clave de API')
    } finally {
      setSavingKey(false)
    }
  }

  const handleToggleConfirm = () => {
    if (confirm) toggleMutation.mutate(confirm)
    setConfirm(null)
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const { has_api_key, departments, channels } = data

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* Confirm modal */}
      {confirm && (
        <ConfirmModal
          deptName={confirm.department_name}
          activating={!confirm.enabled}
          onConfirm={handleToggleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Bot IA</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Configura el asistente Claude: API global, departamentos y canales activos.
        </p>
      </div>

      {/* API Key card */}
      <div className={`bg-white dark:bg-gray-800 rounded-2xl border shadow-sm overflow-hidden ${has_api_key ? 'border-green-200' : 'border-amber-300'}`}>
        <div className={`px-5 py-4 flex items-center gap-3 border-b ${has_api_key ? 'border-green-100 bg-green-50' : 'border-amber-100 bg-amber-50'}`}>
          {has_api_key ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
              <span className="font-semibold text-green-800 flex-1">API de Claude configurada</span>
              <span className="text-xs text-green-600">✓ Lista para usar</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <span className="font-semibold text-amber-800">Configura tu clave de API de Claude (Anthropic)</span>
            </>
          )}
        </div>
        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Anthropic API Key{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer"
                className="ml-2 text-xs underline" style={{ color: 'var(--color-primary)' }}>
                Obtener clave →
              </a>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-9 pr-4 py-2.5 text-sm font-mono focus:outline-none dark:bg-gray-700 dark:text-gray-100" />
              </div>
              <button onClick={handleSaveKey} disabled={savingKey || !apiKey.trim()}
                style={{ backgroundColor: 'var(--color-primary)' }}
                className="px-4 py-2.5 text-sm text-white rounded-xl font-medium whitespace-nowrap disabled:opacity-50">
                {savingKey ? 'Guardando...' : 'Guardar clave'}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">Se almacena cifrada en la base de datos. No se comparte con terceros.</p>
          </div>

          {/* Parámetros globales */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Contexto máximo</p>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">200K tokens</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Respuesta máx.</p>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">4K tokens</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Temperatura</p>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">0.7 (balanceado)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Por departamento */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">
          Configuración por departamento
        </h2>
        <div className="space-y-3">
          {departments.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-6 py-12 text-center text-gray-400">
              <p>No hay departamentos creados.</p>
              <Link to="/admin/departments" className="text-sm underline mt-1 block"
                style={{ color: 'var(--color-primary)' }}>
                Crear departamentos →
              </Link>
            </div>
          ) : (
            departments.map(dept => (
              <DeptRow
                key={dept.department_id}
                dept={dept}
                channels={channels}
                onToggleRequest={setConfirm}
                onSaved={() => queryClient.invalidateQueries({ queryKey: ['bot-settings'] })}
              />
            ))
          )}
        </div>
      </div>

      {/* Base de conocimiento banner */}
      <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-xl px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="font-medium text-indigo-800 dark:text-indigo-200">Base de conocimiento</p>
          <p className="text-sm text-indigo-600 dark:text-indigo-400">
            Sube archivos PDF o Word que el bot usará para responder preguntas.
          </p>
        </div>
        <Link to="/bot/knowledge-base"
          style={{ background: 'var(--color-primary)' }}
          className="text-sm font-medium px-4 py-2 rounded-lg text-white whitespace-nowrap">
          Administrar documentos →
        </Link>
      </div>

    </div>
  )
}
