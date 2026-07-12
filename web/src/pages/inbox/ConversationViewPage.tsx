import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Bot } from 'lucide-react'
import api from '@/api/client'

interface Attachment {
  id: number
  azure_path: string
  original_name: string
  mime_type: string
}

interface Message {
  id: number
  body: string
  type: string
  direction: 'inbound' | 'outbound'
  status: string
  created_at: string
  attachments?: Attachment[]
}

interface Agent {
  id: number
  name: string
  is_bot?: boolean
}

interface Channel {
  id: number
  name: string
  type: string
}

interface Contact {
  id: number
  name: string
  phone?: string
}

interface Conversation {
  id: number
  case_number: string
  status: string
  created_at: string
  updated_at: string
  last_message_at?: string
  agent?: Agent
  channel?: Channel
  contact?: Contact
}

function fmt(iso: string) {
  return new Intl.DateTimeFormat('es-CR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
}

export default function ConversationViewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: conv, isLoading: loadingConv } = useQuery<Conversation>({
    queryKey: ['conversation', id],
    queryFn: () => api.get(`/conversations/${id}`).then(r => r.data?.data ?? r.data),
    enabled: !!id,
  })

  const { data: messagesData, isLoading: loadingMsgs } = useQuery<{ data: Message[] }>({
    queryKey: ['conversation-messages', id],
    queryFn: () => api.get(`/conversations/${id}/messages`).then(r => r.data),
    enabled: !!id,
  })

  const messages = messagesData?.data ?? []
  const isLoading = loadingConv || loadingMsgs

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {conv ? `Caso ${conv.case_number}` : 'Conversación'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Vista de solo lectura</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={24} className="animate-spin mr-2" />
          <span className="text-sm">Cargando conversación...</span>
        </div>
      )}

      {conv && (
        <>
          {/* Info del caso */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Contacto</p>
                <p className="font-medium text-gray-900 dark:text-gray-100">{conv.contact?.name ?? '—'}</p>
                {conv.contact?.phone && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{conv.contact.phone}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Agente</p>
                {conv.agent?.is_bot ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                    <Bot size={11} /> Bot IA
                  </span>
                ) : (
                  <p className="font-medium text-gray-900 dark:text-gray-100">{conv.agent?.name ?? '—'}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Canal</p>
                <p className="font-medium text-gray-900 dark:text-gray-100">{conv.channel?.name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Cerrado</p>
                <p className="font-medium text-gray-900 dark:text-gray-100">{fmt(conv.updated_at)}</p>
              </div>
            </div>
          </div>

          {/* Mensajes */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Mensajes ({messages.length})
              </p>
            </div>
            <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
              {messages.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                  Sin mensajes registrados
                </p>
              )}
              {messages.map(msg => {
                const isOut = msg.direction === 'outbound'
                return (
                  <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                    {!isOut && conv.contact && (
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mr-2 mt-1"
                        style={{ backgroundColor: 'var(--color-primary)' }}
                      >
                        {initials(conv.contact.name)}
                      </div>
                    )}
                    <div
                      className={`max-w-xs md:max-w-md lg:max-w-lg px-3.5 py-2.5 rounded-2xl text-sm ${
                        isOut
                          ? 'text-white rounded-br-sm'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-bl-sm'
                      }`}
                      style={isOut ? { backgroundColor: 'var(--color-primary)' } : {}}
                    >
                      {msg.body ? (
                        <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                      ) : (
                        <p className="italic opacity-60 text-xs">
                          {msg.type === 'image' ? '📷 Imagen' :
                           msg.type === 'audio' ? '🎵 Audio' :
                           msg.type === 'video' ? '🎬 Video' :
                           msg.type === 'document' ? '📄 Documento' :
                           msg.type === 'sticker' ? '🎭 Sticker' : `[${msg.type}]`}
                        </p>
                      )}
                      <p className={`text-[10px] mt-1 ${isOut ? 'text-white/60' : 'text-gray-400 dark:text-gray-500'}`}>
                        {fmt(msg.created_at)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
