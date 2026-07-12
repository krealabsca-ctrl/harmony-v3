import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { MessageSquare, Reply, EyeOff, AlertTriangle, Search, RefreshCw } from 'lucide-react'
import api from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Comment {
  id: number
  platform: 'instagram' | 'facebook' | string
  author_name: string
  author_avatar: string
  body: string
  sentiment: 'positive' | 'neutral' | 'negative'
  status: 'pending' | 'replied' | 'hidden' | 'spam'
  replied_at: string | null
  reply_body: string
  created_at: string
}

interface CommentsResponse {
  data: Comment[]
  meta: { current_page: number; last_page: number; per_page: number; total: number }
  counts: { all: number; pending: number; replied: number; hidden: number }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_STYLES: Record<string, string> = {
  instagram: 'bg-pink-50 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  facebook:  'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
}

const SENTIMENT_STYLES: Record<string, { label: string; cls: string }> = {
  positive: { label: 'Positivo', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  neutral:  { label: 'Neutral',  cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' },
  negative: { label: 'Negativo', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

const STATUS_TABS = [
  { key: '',        label: 'Todos' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'replied', label: 'Respondidos' },
  { key: 'hidden',  label: 'Ocultos' },
]

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `hace ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  return `hace ${Math.floor(hrs / 24)}d`
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

// ─── Reply Modal ──────────────────────────────────────────────────────────────

function ReplyModal({ comment, onClose }: { comment: Comment; onClose: () => void }) {
  const [text, setText] = useState('')
  const qc = useQueryClient()

  const reply = useMutation({
    mutationFn: (body: string) =>
      api.post(`/pub/comments/${comment.id}/reply`, { reply_body: body }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pub-comments'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Responder comentario</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          {/* original */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-sm text-gray-700 dark:text-gray-300">
            <span className="font-medium text-gray-900 dark:text-gray-100 mr-1">{comment.author_name}:</span>
            {comment.body}
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={4}
            placeholder="Escribe tu respuesta..."
            className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>
        <div className="px-6 pb-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            disabled={!text.trim() || reply.isPending}
            onClick={() => reply.mutate(text.trim())}
            className="px-4 py-2 rounded-lg text-sm text-white font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {reply.isPending ? 'Enviando...' : 'Responder'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PubCommentsPage() {
  const [urlParams, setUrlParams] = useSearchParams()
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null)
  const qc = useQueryClient()

  const status   = urlParams.get('status') ?? ''
  const platform = urlParams.get('platform') ?? ''
  const q        = urlParams.get('q') ?? ''
  const page     = Number(urlParams.get('page') ?? '1')

  const { data, isLoading } = useQuery<CommentsResponse>({
    queryKey: ['pub-comments', status, platform, q, page],
    queryFn: () =>
      api.get('/pub/comments', { params: { status: status || undefined, platform: platform || undefined, q: q || undefined, page } }).then(r => r.data),
  })

  const updateStatus = useMutation({
    mutationFn: ({ id, s }: { id: number; s: string }) =>
      api.put(`/pub/comments/${id}/status`, { status: s }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pub-comments'] }),
  })

  const setParam = (key: string, val: string) => {
    const next = new URLSearchParams(urlParams)
    if (val) next.set(key, val); else next.delete(key)
    next.delete('page')
    setUrlParams(next, { replace: true })
  }

  const counts = data?.counts
  const comments = data?.data ?? []

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Comentarios</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Monitoreo y respuesta de comentarios en redes sociales</p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['pub-comments'] })}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <RefreshCw size={15} />
          Actualizar
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100 dark:border-gray-700">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setParam('status', tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              status === tab.key
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.key === 'pending' && (counts?.pending ?? 0) > 0 && (
              <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">
                {counts!.pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            defaultValue={q}
            placeholder="Buscar comentarios..."
            onKeyDown={e => { if (e.key === 'Enter') setParam('q', (e.target as HTMLInputElement).value) }}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={platform}
          onChange={e => setParam('platform', e.target.value)}
          className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Todas las plataformas</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 dark:text-gray-500 text-sm">
            <RefreshCw size={16} className="animate-spin mr-2" /> Cargando comentarios...
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 dark:text-gray-500">
            <MessageSquare size={36} strokeWidth={1.5} />
            <p className="text-sm">No hay comentarios en esta categoría</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {comments.map(comment => (
              <div key={comment.id} className="p-5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div
                    className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    {comment.author_avatar
                      ? <img src={comment.author_avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
                      : initials(comment.author_name)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{comment.author_name}</span>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PLATFORM_STYLES[comment.platform] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                        {comment.platform}
                      </span>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${SENTIMENT_STYLES[comment.sentiment]?.cls ?? ''}`}>
                        {SENTIMENT_STYLES[comment.sentiment]?.label ?? comment.sentiment}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{relativeTime(comment.created_at)}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{comment.body}</p>

                    {/* Reply preview */}
                    {comment.reply_body && (
                      <div className="mt-2 pl-3 border-l-2 border-indigo-300 dark:border-indigo-600 text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium text-indigo-600 dark:text-indigo-400">Tu respuesta: </span>
                        {comment.reply_body}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-3 flex items-center gap-2">
                      {comment.status === 'pending' && (
                        <button
                          onClick={() => setReplyTarget(comment)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
                        >
                          <Reply size={13} /> Responder
                        </button>
                      )}
                      {comment.status !== 'hidden' && (
                        <button
                          onClick={() => updateStatus.mutate({ id: comment.id, s: 'hidden' })}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          <EyeOff size={13} /> Ocultar
                        </button>
                      )}
                      {comment.status !== 'spam' && (
                        <button
                          onClick={() => updateStatus.mutate({ id: comment.id, s: 'spam' })}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        >
                          <AlertTriangle size={13} /> Spam
                        </button>
                      )}
                      {(comment.status === 'hidden' || comment.status === 'spam') && (
                        <button
                          onClick={() => updateStatus.mutate({ id: comment.id, s: 'pending' })}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          Restaurar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {(data?.meta?.last_page ?? 1) > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: data!.meta.last_page }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              onClick={() => { const n = new URLSearchParams(urlParams); n.set('page', String(p)); setUrlParams(n) }}
              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                p === page
                  ? 'text-white'
                  : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              style={p === page ? { backgroundColor: 'var(--color-primary)' } : undefined}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {replyTarget && <ReplyModal comment={replyTarget} onClose={() => setReplyTarget(null)} />}
    </div>
  )
}
