import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, X, Pencil, Trash2, Zap, Loader2 } from 'lucide-react'
import api from '@/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

type AgentType = 'content' | 'lead' | 'reply'

interface PubAgent {
  id: number
  name: string
  type: AgentType
  model: string
  instructions: string
  enabled: boolean
  platforms: string[]
  config: Record<string, unknown>
}

interface AgentForm {
  name: string
  type: AgentType
  model: string
  instructions: string
  enabled: boolean
  platforms: string[]
  // content
  topic: string
  imageStyle: string
  postsPerWeek: number
  postTime: string
  autoPublish: boolean
  // lead
  notifyOnLead: boolean
  // reply
  replyTemplate: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MODELS: Record<string, string> = {
  'claude-sonnet-4-6':        'Claude Sonnet 4.6 (Recomendado)',
  'claude-haiku-4-5-20251001':'Claude Haiku 4.5 (Rápido/Económico)',
  'claude-opus-4-8':          'Claude Opus 4.8 (Máxima calidad)',
}

const ALL_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'x', 'tiktok']

const TYPE_LABELS: Record<AgentType, string> = {
  content: 'Contenido',
  lead:    'Leads',
  reply:   'Respuestas',
}
const TYPE_COLORS: Record<AgentType, string> = {
  content: 'bg-indigo-100 text-indigo-700',
  lead:    'bg-orange-100 text-orange-700',
  reply:   'bg-green-100 text-green-700',
}

const TYPE_GUIDE = [
  { type: 'content', icon: '✍️', label: 'Agente de Contenido', desc: 'Genera publicaciones periódicas según el Brand Kit y la frecuencia configurada.' },
  { type: 'lead',    icon: '🎯', label: 'Agente de Leads',     desc: 'Analiza comentarios y notifica cuando detecta un lead con score alto.' },
  { type: 'reply',   icon: '💬', label: 'Agente de Respuestas',desc: 'Genera respuestas automáticas a comentarios en tus publicaciones.' },
]

const IMAGE_STYLES = [
  { value: 'realistic',   label: 'Fotorrealista' },
  { value: 'illustrated', label: 'Ilustrado'     },
  { value: 'minimalist',  label: 'Minimalista'   },
  { value: '3d',          label: '3D Render'     },
]

const EMPTY_FORM: AgentForm = {
  name: '', type: 'content', model: 'claude-sonnet-4-6',
  instructions: '', enabled: true, platforms: [],
  topic: '', imageStyle: '',
  postsPerWeek: 3, postTime: '10:00', autoPublish: false,
  notifyOnLead: true, replyTemplate: '',
}

function agentToForm(a: PubAgent): AgentForm {
  const cfg = a.config ?? {}
  return {
    name: a.name, type: a.type, model: a.model,
    instructions: a.instructions ?? '', enabled: a.enabled,
    platforms: a.platforms ?? [],
    topic:         (cfg.topic as string)            ?? '',
    imageStyle:    (cfg.image_style as string)      ?? '',
    postsPerWeek:  (cfg.posts_per_week as number)   ?? 3,
    postTime:      (cfg.post_time as string)        ?? '10:00',
    autoPublish:   (cfg.auto_publish as boolean)    ?? false,
    notifyOnLead:  (cfg.notify_on_lead as boolean)  ?? true,
    replyTemplate: (cfg.reply_template as string)   ?? '',
  }
}

function formToPayload(f: AgentForm) {
  const config =
    f.type === 'content' ? {
      topic:          f.topic,
      image_style:    f.imageStyle,
      posts_per_week: f.postsPerWeek,
      post_time:      f.postTime,
      auto_publish:   f.autoPublish,
    } :
    f.type === 'lead'    ? { notify_on_lead: f.notifyOnLead } :
    f.type === 'reply'   ? { reply_template: f.replyTemplate } :
    {}
  return {
    name: f.name, type: f.type, model: f.model,
    instructions: f.instructions || null,
    enabled: f.enabled, platforms: f.platforms, config,
  }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PubAgentsPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm]       = useState(false)
  const [editingId, setEditingId]     = useState<number | null>(null)
  const [form, setForm]               = useState<AgentForm>(EMPTY_FORM)
  const [deleteId, setDeleteId]       = useState<number | null>(null)
  const [generatingId, setGeneratingId] = useState<number | null>(null)
  const [showGenerateModal, setShowGenerateModal] = useState<{ agent: PubAgent } | null>(null)
  const [generateTopic, setGenerateTopic] = useState('')

  const patch = (values: Partial<AgentForm>) => setForm(f => ({ ...f, ...values }))

  const togglePlatform = (p: string) =>
    patch({ platforms: form.platforms.includes(p)
      ? form.platforms.filter(x => x !== p)
      : [...form.platforms, p] })

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: agents = [], isLoading } = useQuery<PubAgent[]>({
    queryKey: ['pub-agents'],
    queryFn: () => api.get('/pub/agents').then(r => r.data.data ?? r.data),
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof formToPayload>) =>
      editingId
        ? api.put(`/pub/agents/${editingId}`, payload)
        : api.post('/pub/agents', payload),
    onSuccess: () => {
      toast.success('Agente guardado correctamente.')
      queryClient.invalidateQueries({ queryKey: ['pub-agents'] })
      setShowForm(false)
    },
    onError: () => toast.error('Error al guardar el agente'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api.put(`/pub/agents/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pub-agents'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/pub/agents/${id}`),
    onSuccess: () => {
      toast.success('Agente eliminado.')
      queryClient.invalidateQueries({ queryKey: ['pub-agents'] })
      setDeleteId(null)
    },
  })

  const generateMutation = useMutation({
    mutationFn: ({ agentId, topic }: { agentId: number; topic: string }) =>
      api.post('/pub/generate', { agent_id: agentId, topic }),
    onSuccess: () => {
      toast.success('Generación iniciada. El post aparecerá en la lista cuando esté listo.')
      setShowGenerateModal(null)
      setGenerateTopic('')
      setGeneratingId(null)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Error al iniciar la generación')
      setGeneratingId(null)
    },
  })

  // ── Helpers ────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (agent: PubAgent) => {
    setEditingId(agent.id)
    setForm(agentToForm(agent))
    setShowForm(true)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Agentes IA</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Configura los agentes de inteligencia artificial de publicidad</p>
        </div>
        <button onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition">
          <Plus className="w-4 h-4" />
          Nuevo agente
        </button>
      </div>

      {/* Type guide */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TYPE_GUIDE.map(g => (
          <div key={g.type} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
            <div className="text-2xl mb-2">{g.icon}</div>
            <div className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{g.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{g.desc}</div>
          </div>
        ))}
      </div>

      {/* Agents list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <span className="h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
          <div className="text-5xl mb-4">🤖</div>
          <p className="font-medium">Sin agentes configurados</p>
          <p className="text-sm mt-1">Crea tu primer agente para automatizar tu publicidad.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map(agent => (
            <div key={agent.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{agent.name}</span>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${TYPE_COLORS[agent.type]}`}>
                    {TYPE_LABELS[agent.type]}
                  </span>
                  <span className="text-xs text-gray-400">{agent.model}</span>
                  {(agent.platforms ?? []).map(p => (
                    <span key={p} className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full capitalize">{p}</span>
                  ))}
                </div>
                {agent.instructions && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 truncate">{agent.instructions}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Toggle enabled */}
                <button
                  onClick={() => toggleMutation.mutate({ id: agent.id, enabled: !agent.enabled })}
                  style={{ background: agent.enabled ? '#9333ea' : '#D1D5DB' }}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors">
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${agent.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                {/* Generate now — only for content agents */}
                {agent.type === 'content' && (
                  <button
                    onClick={() => {
                      setGeneratingId(agent.id)
                      setGenerateTopic((agent.config?.topic as string) ?? '')
                      setShowGenerateModal({ agent })
                    }}
                    title="Generar post ahora"
                    className="p-1.5 text-gray-400 hover:text-yellow-500 dark:hover:text-yellow-400 transition">
                    {generatingId === agent.id && generateMutation.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Zap className="w-4 h-4" />}
                  </button>
                )}
                {/* Edit */}
                <button onClick={() => openEdit(agent)}
                  className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                  <Pencil className="w-4 h-4" />
                </button>
                {/* Delete */}
                <button onClick={() => setDeleteId(agent.id)}
                  className="p-1.5 text-gray-400 hover:text-red-600 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {editingId ? 'Editar agente' : 'Nuevo agente'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={e => { e.preventDefault(); saveMutation.mutate(formToPayload(form)) }}
              className="p-6 space-y-5">

              {/* Nombre */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input type="text" value={form.name} onChange={e => patch({ name: e.target.value })}
                  placeholder="ej. Generador de contenido" required
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>

              {/* Tipo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Tipo <span className="text-red-500">*</span>
                </label>
                <select value={form.type} onChange={e => patch({ type: e.target.value as AgentType })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <option value="content">✍️ Contenido — genera publicaciones periódicas</option>
                  <option value="lead">🎯 Leads — detecta y notifica leads</option>
                  <option value="reply">💬 Respuestas — responde comentarios automáticamente</option>
                </select>
              </div>

              {/* Modelo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modelo de IA</label>
                <select value={form.model} onChange={e => patch({ model: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                  {Object.entries(MODELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>

              {/* Instrucciones */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Instrucciones adicionales</label>
                <textarea rows={3} value={form.instructions}
                  onChange={e => patch({ instructions: e.target.value })}
                  placeholder="Instrucciones específicas para este agente..."
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" />
              </div>

              {/* Plataformas */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Plataformas</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_PLATFORMS.map(p => {
                    const selected = form.platforms.includes(p)
                    return (
                      <button key={p} type="button" onClick={() => togglePlatform(p)}
                        className={`px-3 py-1 text-sm rounded-full border transition ${selected ? 'bg-purple-600 border-purple-600 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-purple-400'}`}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Config por tipo */}
              {form.type === 'content' && (
                <div className="space-y-3 bg-indigo-50 dark:bg-indigo-950 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">Configuración de contenido</h3>

                  {/* Topic */}
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Tema por defecto</label>
                    <input type="text" value={form.topic}
                      onChange={e => patch({ topic: e.target.value })}
                      placeholder="ej. Propiedades en venta en Costa Rica"
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm" />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Se usará cuando el agente genere posts automáticamente.</p>
                  </div>

                  {/* Image style */}
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Estilo de imagen</label>
                    <div className="flex flex-wrap gap-2">
                      {IMAGE_STYLES.map(s => (
                        <button key={s.value} type="button"
                          onClick={() => patch({ imageStyle: s.value })}
                          className={`px-3 py-1 text-xs rounded-full border transition ${form.imageStyle === s.value ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-indigo-400'}`}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Publicaciones por semana</label>
                      <input type="number" min={1} max={21} value={form.postsPerWeek}
                        onChange={e => patch({ postsPerWeek: Number(e.target.value) })}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Hora de publicación</label>
                      <input type="time" value={form.postTime}
                        onChange={e => patch({ postTime: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.autoPublish}
                      onChange={e => patch({ autoPublish: e.target.checked })}
                      className="w-4 h-4 rounded text-indigo-600" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Publicar automáticamente sin aprobación</span>
                  </label>
                </div>
              )}

              {form.type === 'lead' && (
                <div className="bg-orange-50 dark:bg-orange-950 rounded-xl p-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.notifyOnLead}
                      onChange={e => patch({ notifyOnLead: e.target.checked })}
                      className="w-4 h-4 rounded text-orange-600" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Notificar por WhatsApp cuando se detecte un lead</span>
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Los números de notificación se configuran en Configuración → Detección de Leads.
                  </p>
                </div>
              )}

              {form.type === 'reply' && (
                <div className="bg-green-50 dark:bg-green-950 rounded-xl p-4 space-y-2">
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Plantilla de respuesta</label>
                  <textarea rows={3} value={form.replyTemplate}
                    onChange={e => patch({ replyTemplate: e.target.value })}
                    placeholder="Usa {nombre} y {comentario} como variables..."
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm resize-none" />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Si está vacío, la IA generará respuestas únicas basadas en el Brand Kit.
                  </p>
                </div>
              )}

              {/* Agente activo */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.enabled}
                  onChange={e => patch({ enabled: e.target.checked })}
                  className="w-4 h-4 rounded text-purple-600" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Agente activo</span>
              </label>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                  Cancelar
                </button>
                <button type="submit" disabled={saveMutation.isPending || !form.name.trim()}
                  className="flex-1 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition disabled:opacity-60 flex items-center justify-center gap-2">
                  {saveMutation.isPending && <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {editingId ? 'Guardar cambios' : 'Crear agente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generate topic modal */}
      {showGenerateModal !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) { setShowGenerateModal(null); setGeneratingId(null) } }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-500" />
                Generar post ahora
              </h2>
              <button onClick={() => { setShowGenerateModal(null); setGeneratingId(null) }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Agente: <span className="font-medium text-gray-700 dark:text-gray-200">{showGenerateModal.agent.name}</span>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Tema del post <span className="text-red-500">*</span>
              </label>
              <input type="text" value={generateTopic}
                onChange={e => setGenerateTopic(e.target.value)}
                placeholder="ej. Consejos para comprar tu primera vivienda"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                autoFocus />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => { setShowGenerateModal(null); setGeneratingId(null) }}
                className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Cancelar
              </button>
              <button
                disabled={!generateTopic.trim() || generateMutation.isPending}
                onClick={() => generateMutation.mutate({ agentId: showGenerateModal.agent.id, topic: generateTopic.trim() })}
                className="flex-1 px-4 py-2 text-sm bg-yellow-500 hover:bg-yellow-600 text-white font-medium rounded-lg transition disabled:opacity-60 flex items-center justify-center gap-2">
                {generateMutation.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando...</>
                  : <><Zap className="w-3.5 h-3.5" /> Generar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 text-center space-y-4">
            <div className="text-4xl">🗑️</div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">¿Eliminar agente?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)}
                className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Cancelar
              </button>
              <button onClick={() => deleteMutation.mutate(deleteId!)}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition disabled:opacity-60">
                {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
