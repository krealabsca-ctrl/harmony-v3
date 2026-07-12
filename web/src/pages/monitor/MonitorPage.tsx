import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Radio,
  Search,
  RefreshCw,
  Loader2,
  Lock,
  User,
  Phone,
  Hash,
  Clock,
  ChevronLeft,
  MessageSquare,
  Paperclip,
} from 'lucide-react'
import api from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { ChannelIcon, CHANNEL_BG } from '@/components/ChannelIcon'

// ─── Types ────────────────────────────────────────────────────────────────────

type ConvStatus = 'open' | 'pending'
type ChannelType = 'whatsapp' | 'messenger' | 'instagram' | 'telegram' | 'sms' | 'email'

interface Tag {
  id: number
  name: string
  color: string
}

interface MonitorConv {
  id: number
  case_number: string
  status: ConvStatus
  last_message_at: string | null
  unread_count: number
  window_expires_at: string | null
  created_at: string
  contact_id: number
  contact_name: string
  contact_phone: string
  contact_avatar_url: string
  channel_id: number
  channel_name: string
  channel_type: ChannelType
  agent_id: number | null
  agent_name: string
  department_id: number
  department_name: string
  tags: Tag[]
}

interface MonitorCounts {
  all: number
  open: number
  pending: number
}

interface MonitorResponse {
  data: MonitorConv[]
  total: number
  meta: { total: number; per_page: number; current_page: number; last_page: number }
  counts: MonitorCounts
}

interface Message {
  id: number
  conversation_id: number
  body: string
  type: string
  direction: 'inbound' | 'outbound'
  status: string
  created_at: string
  attachments: { id: number; azure_path: string; original_name: string; mime_type: string }[]
}

interface Agent {
  id: number
  name: string
  is_online: boolean
}

interface Department {
  id: number
  name: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit' })
}

function formatMsgTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })
}

function isExpired(windowStr: string | null): boolean {
  if (!windowStr) return false
  return new Date(windowStr).getTime() < Date.now()
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, url, size = 'md' }: { name: string; url?: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'w-7 h-7 text-[10px]' : size === 'lg' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs'
  if (url) return <img src={url} alt={name} className={`${dim} rounded-full object-cover flex-shrink-0`} />
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0`}
      style={{ backgroundColor: 'var(--color-primary)' }}
    >
      {getInitials(name || '?')}
    </div>
  )
}

// ─── ConvRow ──────────────────────────────────────────────────────────────────

function ConvRow({
  conv,
  selected,
  onClick,
}: {
  conv: MonitorConv
  selected: boolean
  onClick: () => void
}) {
  const expired = isExpired(conv.window_expires_at)
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors flex items-start gap-3 ${
        selected ? 'bg-primary-50 border-l-2' : ''
      }`}
      style={selected ? { borderLeftColor: 'var(--color-primary)', backgroundColor: 'var(--color-primary)1a' } : {}}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0 mt-0.5">
        <Avatar name={conv.contact_name} url={conv.contact_avatar_url} />
        {/* Status dot */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
            conv.status === 'open' ? 'bg-green-400' : 'bg-yellow-400'
          }`}
        />
      </div>

      {/* Main content */}
      <div className="min-w-0 flex-1">
        {/* Row 1: name + time */}
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate leading-tight">
            {conv.contact_name}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
            {formatTime(conv.last_message_at)}
          </span>
        </div>

        {/* Row 2: case# + channel badge */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="font-mono text-xs text-gray-400 dark:text-gray-500 tabular-nums">#{conv.case_number}</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0 rounded-full text-[10px] font-medium leading-5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            <span className="inline-flex items-center justify-center w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: CHANNEL_BG[conv.channel_type] ?? '#6b7280' }}>
              <ChannelIcon type={conv.channel_type} size={8} />
            </span>
            {conv.channel_type ? conv.channel_type.charAt(0).toUpperCase() + conv.channel_type.slice(1) : '—'}
          </span>
          {expired && (
            <span className="inline-flex items-center px-1.5 rounded-full text-[10px] font-medium leading-5 bg-red-100 text-red-600">
              <Clock size={8} className="mr-0.5" />
              Expirada
            </span>
          )}
          {conv.unread_count > 0 && (
            <span className="ml-auto inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold text-white rounded-full" style={{ backgroundColor: 'var(--color-primary)' }}>
              {conv.unread_count > 9 ? '9+' : conv.unread_count}
            </span>
          )}
        </div>

        {/* Row 3: agent + tags */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 truncate max-w-[100px]">
            {conv.agent_name ? conv.agent_name : (
              <span className="text-amber-600 font-medium">Bot IA</span>
            )}
          </span>
          {(conv.tags ?? []).slice(0, 2).map((t) => (
            <span
              key={t.id}
              className="inline-block px-1.5 rounded-full text-[10px] leading-[18px] text-white"
              style={{ backgroundColor: t.color || '#6b7280' }}
            >
              {t.name}
            </span>
          ))}
          {(conv.tags?.length ?? 0) > 2 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">+{(conv.tags?.length ?? 0) - 2}</span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const out = msg.direction === 'outbound'
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[72%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
          out
            ? 'rounded-br-sm text-white'
            : 'rounded-bl-sm bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200'
        }`}
        style={out ? { backgroundColor: 'var(--color-primary)' } : {}}
      >
        {msg.type === 'text' || !msg.type ? (
          <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
        ) : (
          <div className="flex items-center gap-2">
            <Paperclip size={13} className={out ? 'text-white/80' : 'text-gray-400 dark:text-gray-500'} />
            <span className="text-xs truncate max-w-[160px]">
              {msg.attachments?.[0]?.original_name ?? msg.body ?? 'Archivo adjunto'}
            </span>
          </div>
        )}
        <p className={`text-[10px] mt-1 text-right tabular-nums ${out ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>
          {formatMsgTime(msg.created_at)}
        </p>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const isSupervisor = user?.role === 'supervisor'
  const { subscribe } = useWebSocket()

  // Filters
  const [tab, setTab] = useState<'' | 'open' | 'pending'>('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  // Selected conversation
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: monitorData, isLoading, isFetching, refetch } = useQuery<MonitorResponse>({
    queryKey: ['monitor', tab, debouncedSearch, agentFilter, deptFilter],
    queryFn: async () => {
      const res = await api.get('/monitor', {
        params: {
          status: tab || undefined,
          q: debouncedSearch || undefined,
          agent_id: agentFilter || undefined,
          department_id: deptFilter || undefined,
        },
      })
      return res.data
    },
    refetchInterval: 30000,
  })

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ['monitor-agents'],
    queryFn: async () => {
      const res = await api.get('/admin/users', { params: { role: 'agent', per_page: 200 } })
      return res.data.data ?? res.data
    },
    staleTime: 60000,
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin-departments'],
    queryFn: async () => {
      const res = await api.get('/admin/departments')
      return res.data.data ?? res.data
    },
    staleTime: 60000,
  })

  // Messages for selected conversation
  const { data: messagesData, isLoading: msgsLoading } = useQuery<{ data: Message[] }>({
    queryKey: ['monitor-messages', selectedId],
    queryFn: async () => {
      const res = await api.get(`/conversations/${selectedId}/messages`, {
        params: { per_page: 100 },
      })
      return res.data
    },
    enabled: selectedId !== null,
    refetchInterval: 10000,
  })

  const messages = messagesData?.data ?? []

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, selectedId])

  // WebSocket invalidate
  const deptIds = departments.map((d) => d.id)
  const deptIdsRef = useRef(deptIds)
  useEffect(() => { deptIdsRef.current = deptIds }, [deptIds])

  useEffect(() => {
    const unsubs: (() => void)[] = []
    const invalidate = () => qc.invalidateQueries({ queryKey: ['monitor'] })
    deptIdsRef.current.forEach((id) => {
      unsubs.push(subscribe(`department.${id}`, 'ConversationUpdated', invalidate))
      unsubs.push(subscribe(`department.${id}`, 'ConversationCreated', invalidate))
      unsubs.push(subscribe(`department.${id}`, 'ConversationClosed', invalidate))
    })
    return () => unsubs.forEach((fn) => fn())
  }, [departments, subscribe, qc])

  // Invalidate messages on WS event for selected conv
  useEffect(() => {
    if (!selectedId) return
    const unsub = subscribe(`conversation.${selectedId}`, 'MessageReceived', () => {
      qc.invalidateQueries({ queryKey: ['monitor-messages', selectedId] })
    })
    return unsub
  }, [selectedId, subscribe, qc])

  const convs = monitorData?.data ?? []
  const counts = monitorData?.counts ?? { all: 0, open: 0, pending: 0 }
  const selectedConv = convs.find((c) => c.id === selectedId) ?? null

  const handleSelect = useCallback((id: number) => {
    setSelectedId((prev) => (prev === id ? null : id))
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl" style={{ backgroundColor: 'var(--color-primary)' }}>
            <Radio className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 leading-tight">Monitor en vivo</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
              {isLoading ? 'Cargando...' : `${counts.all} conversaciones activas`}
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* ── Split pane ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: conversation list ─────────────────────────────────────── */}
        <div className={`${selectedId !== null ? 'hidden sm:flex' : 'flex'} w-full sm:w-[360px] flex-shrink-0 flex-col border-r border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden`}>

          {/* Tabs */}
          <div className="flex-shrink-0 flex border-b border-gray-100 dark:border-gray-700">
            {(
              [
                { key: '', label: 'Todos', count: counts.all },
                { key: 'open', label: 'Abiertos', count: counts.open },
                { key: 'pending', label: 'No leídos', count: counts.pending },
              ] as { key: '' | 'open' | 'pending'; label: string; count: number }[]
            ).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium border-b-2 transition-colors ${
                  tab === key
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'border-transparent text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 dark:text-gray-300'
                }`}
              >
                {label}
                <span
                  className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                    tab === key ? 'text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 dark:text-gray-500'
                  }`}
                  style={tab === key ? { backgroundColor: 'var(--color-primary)' } : {}}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>

          {/* Search + Filters */}
          <div className="flex-shrink-0 px-3 py-2.5 space-y-2 border-b border-gray-100 dark:border-gray-700">
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar caso, nombre o teléfono..."
                className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] bg-gray-50 dark:bg-gray-900"
              />
            </div>

            <div className="flex gap-2">
              {/* Agent filter */}
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="flex-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
              >
                <option value="">Agente</option>
                <option value="unassigned">Sin asignar</option>
                {agents.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.name}
                  </option>
                ))}
              </select>

              {/* Department filter — locked for supervisors */}
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                disabled={isSupervisor}
                className="flex-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">Departamento</option>
                {departments.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500 gap-2">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-xs">Cargando...</span>
              </div>
            ) : convs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500 gap-3">
                <Radio className="w-8 h-8 opacity-30" />
                <p className="text-xs">Sin conversaciones activas</p>
              </div>
            ) : (
              convs.map((conv) => (
                <ConvRow
                  key={conv.id}
                  conv={conv}
                  selected={selectedId === conv.id}
                  onClick={() => handleSelect(conv.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Right: message thread ───────────────────────────────────────── */}
        <div className={`${selectedId !== null ? 'flex' : 'hidden sm:flex'} flex-1 flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden`}>
          {selectedId !== null && (
            <button
              onClick={() => setSelectedId(null)}
              className="sm:hidden flex items-center gap-1.5 px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800"
            >
              <ChevronLeft size={16} /> Volver
            </button>
          )}
          {!selectedConv ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 gap-4">
              <MessageSquare className="w-12 h-12 opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium">Selecciona una conversación</p>
                <p className="text-xs mt-1 opacity-70">Visualiza el hilo de mensajes en modo solo lectura</p>
              </div>
            </div>
          ) : (
            <>
              {/* Contact header */}
              <div className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar name={selectedConv.contact_name} url={selectedConv.contact_avatar_url} size="lg" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-tight">
                        {selectedConv.contact_name}
                      </h2>
                      <span className="inline-flex items-center gap-1 px-2 py-0 rounded-full text-[10px] font-medium leading-5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        <span className="inline-flex items-center justify-center w-3 h-3 rounded-full"
                          style={{ backgroundColor: CHANNEL_BG[selectedConv.channel_type] ?? '#6b7280' }}>
                          <ChannelIcon type={selectedConv.channel_type} size={8} />
                        </span>
                        {selectedConv.channel_type ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {selectedConv.contact_phone && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 tabular-nums">
                          <Phone size={10} />
                          {selectedConv.contact_phone}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 font-mono">
                        <Hash size={10} />
                        {selectedConv.case_number}
                      </span>
                      {selectedConv.department_name && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">{selectedConv.department_name}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedConv.agent_name ? (
                    <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 dark:text-gray-500">
                      <User size={12} />
                      <span>{selectedConv.agent_name}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-amber-600 font-medium">Bot IA</span>
                  )}
                  {isExpired(selectedConv.window_expires_at) && (
                    <span className="flex items-center gap-1 text-[10px] text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                      <Clock size={9} />
                      Ventana 24h expirada
                    </span>
                  )}
                  <div className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2.5 py-1 rounded-full">
                    <Lock size={9} />
                    Solo lectura
                  </div>
                  <button
                    onClick={() => qc.invalidateQueries({ queryKey: ['monitor-messages', selectedId] })}
                    className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:bg-gray-700 transition-colors"
                    title="Actualizar mensajes"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>

              {/* Messages area */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {msgsLoading ? (
                  <div className="flex items-center justify-center py-12 text-gray-400 dark:text-gray-500 gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-xs">Cargando mensajes...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500 gap-2">
                    <MessageSquare className="w-8 h-8 opacity-20" />
                    <p className="text-xs">Sin mensajes</p>
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <MessageBubble key={msg.id} msg={msg} />
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Locked input */}
              <div className="flex-shrink-0 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 px-4 py-3">
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 opacity-60 cursor-not-allowed select-none">
                  <Lock size={13} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                    Vista de solo lectura — no puedes enviar mensajes desde el monitor
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
