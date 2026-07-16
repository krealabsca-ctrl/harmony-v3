import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import api from '@/api/client'
import { useAuthStore } from '@/stores/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AllDept { id: number; name: string }

interface ResumeData {
  total_convs: number
  open_convs: number
  closed_convs: number
  total_messages: number
  inbound_messages: number
  outbound_messages: number
  total_campaign_cost: number
  active_campaigns: number
  convs_by_channel: { channel_name: string; type: string; total: number }[]
  all_departments?: AllDept[]
}

interface ConvsByDayRow { day: string; total: number }
interface ConvsByAgentRow { agent_name: string; total: number }
interface ConvsByDeptRow { dept_name: string; total: number }
interface ConversacionesData {
  convs_by_day: ConvsByDayRow[]
  convs_by_agent: ConvsByAgentRow[]
  convs_by_dept: ConvsByDeptRow[]
}

interface AgentStatRow {
  id: string
  name: string
  is_bot: boolean
  total: number
  open_count: number
  pending_count: number
  closed_count: number
}
interface AgentesData { agent_stats: AgentStatRow[] }

interface CampaignRow {
  id: number
  name: string
  creator_name: string | null
  channel_name: string | null
  status: string
  total_recipients: number
  sent_count: number
  failed_count: number
  cost_per_message: number
  created_at: string
}
interface CampaignsByUserRow { creator_name: string; total_campaigns: number; total_cost: number }
interface CampanasData {
  campaigns: CampaignRow[]
  campaigns_by_user: CampaignsByUserRow[]
}

interface CostByMonthRow { month: string; total_campaigns: number; total_cost: number }
interface CostByChannelRow { channel_name: string; type: string; total_cost: number }
interface IndivCostByAgentRow { agent_name: string; total_msgs: number; total_cost: number }
interface CostosData {
  total_spent: number
  avg_cost_per_campaign: number
  cost_by_month: CostByMonthRow[]
  cost_by_channel: CostByChannelRow[]
  indiv_total_cost: number
  indiv_total_count: number
  indiv_cost_by_agent: IndivCostByAgentRow[]
}

interface AgentListItem { id: number; name: string; is_bot: boolean }
interface AgentConvRow {
  id: number
  contact_name: string | null
  contact_phone: string | null
  channel_name: string | null
  agent_name: string | null
  status: string
  created_at: string
}
interface PorAgentePaginated {
  data: AgentConvRow[]
  current_page: number
  last_page: number
  total: number
}
interface PorAgenteData {
  agent_list: AgentListItem[]
  convs: PorAgentePaginated
  stats: { total: number; open: number; pending: number; closed: number }
}

interface TagStatRow {
  id: number
  tag_name: string
  color: string
  total: number
  open_count: number
  pending_count: number
  closed_count: number
}
interface PorTagsData { tag_stats: TagStatRow[] }

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS = [
  { key: 'resumen',        label: 'Resumen' },
  { key: 'conversaciones', label: 'Conversaciones' },
  { key: 'agentes',        label: 'Agentes' },
  { key: 'campanas',       label: 'Campañas' },
  { key: 'costos',         label: 'Costos' },
  { key: 'por-agente',     label: 'Por Agente' },
  { key: 'por-tags',       label: 'Por Tags' },
] as const

type TabKey = (typeof TABS)[number]['key']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, decimals = 0) {
  if (n == null) return '—'
  return n.toLocaleString('es-CR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtMoney(n: number | undefined | null, decimals = 2) {
  if (n == null) return '$—'
  return '$' + fmt(n, decimals)
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  open:      { label: 'Abierto',    cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  closed:    { label: 'Finalizado', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  draft:     { label: 'Borrador',   cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  scheduled: { label: 'Programada', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  running:   { label: 'Corriendo',  cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  completed: { label: 'Completada', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  failed:    { label: 'Fallida',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  cancelled: { label: 'Cancelada',  cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}

function ResPctBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 70
      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
      : pct >= 40
      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${cls}`}>
      {pct}%
    </span>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
      style={{ backgroundColor: 'var(--color-primary)' }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="p-6 space-y-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      ))}
    </div>
  )
}

function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  return (
    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
      <div
        className="h-2 rounded-full"
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          backgroundColor: color ?? 'var(--color-primary)',
        }}
      />
    </div>
  )
}

// ─── Tab: Resumen ─────────────────────────────────────────────────────────────

function TabResumen({ from, to, deptId }: { from: string; to: string; deptId: string }) {
  const { data, isLoading } = useQuery<ResumeData>({
    queryKey: ['reports-resumen', from, to, deptId],
    queryFn: () =>
      api.get('/reports/resumen', { params: { from, to, dept_id: deptId || undefined } }).then((r) => r.data),
  })

  if (isLoading) return <Skeleton />

  const kpis = [
    { label: 'Total Convs.',    value: fmt(data?.total_convs),              badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', icon: '📊' },
    { label: 'Abiertas',        value: fmt(data?.open_convs),               badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',   icon: '💬' },
    { label: 'Cerradas',        value: fmt(data?.closed_convs),             badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',  icon: '✅' },
    { label: 'Mensajes',        value: fmt(data?.total_messages),           badge: 'bg-indigo-50 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300', icon: '📩' },
    { label: 'Costo campañas',  value: fmtMoney(data?.total_campaign_cost), badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',     icon: '💰' },
  ]

  const maxChannel = Math.max(...(data?.convs_by_channel?.map((c) => c.total) ?? [1]), 1)
  const total = data?.total_messages ?? 0
  const inbound = data?.inbound_messages ?? 0
  const outbound = data?.outbound_messages ?? 0

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{k.label}</span>
              <span className="text-lg">{k.icon}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{k.value}</p>
            <span className={`inline-block self-start text-xs font-medium px-2 py-0.5 rounded-full ${k.badge}`}>
              periodo actual
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversaciones por canal */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Conversaciones por Canal</h3>
          {data?.convs_by_channel.length ? (
            data.convs_by_channel.map((ch) => (
              <div key={ch.channel_name} className="mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1 truncate">{ch.channel_name}</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{ch.total}</span>
                </div>
                <ProgressBar pct={Math.round((ch.total / maxChannel) * 100)} />
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">Sin datos en el periodo</p>
          )}
        </div>

        {/* Resumen de mensajes */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Resumen de Mensajes</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
              <div className="flex items-center gap-3">
                <span className="text-xl">📥</span>
                <div>
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wide">Entrantes</p>
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{fmt(inbound)}</p>
                </div>
              </div>
              {total > 0 && (
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  {Math.round((inbound / total) * 100)}%
                </span>
              )}
            </div>
            <div className="flex items-center justify-between p-3 bg-green-100 dark:bg-green-900/30 rounded-xl">
              <div className="flex items-center gap-3">
                <span className="text-xl">📤</span>
                <div>
                  <p className="text-xs font-medium text-green-700 dark:text-green-300 uppercase tracking-wide">Salientes</p>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">{fmt(outbound)}</p>
                </div>
              </div>
              {total > 0 && (
                <span className="text-sm font-semibold text-green-700 dark:text-green-300">
                  {Math.round((outbound / total) * 100)}%
                </span>
              )}
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
              <div className="flex items-center gap-3">
                <span className="text-xl">📊</span>
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Mensajes</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmt(total)}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400 dark:text-gray-500">Campañas activas</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{data?.active_campaigns ?? '—'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Conversaciones ──────────────────────────────────────────────────────

function TabConversaciones({ from, to, deptId }: { from: string; to: string; deptId: string }) {
  const { data, isLoading } = useQuery<ConversacionesData>({
    queryKey: ['reports-conversaciones', from, to, deptId],
    queryFn: () =>
      api.get('/reports/conversaciones', { params: { from, to, dept_id: deptId || undefined } }).then((r) => r.data),
  })

  if (isLoading) return <Skeleton />

  const days = data?.convs_by_day ?? []
  const maxDay = Math.max(...days.map((d) => d.total), 1)

  return (
    <div className="space-y-6">
      {/* Bar chart */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Conversaciones por Día</h3>
        {days.length ? (
          <div className="flex items-end gap-1 h-32 overflow-x-auto pb-2">
            {days.map((d) => {
              const pct = Math.round((d.total / maxDay) * 100)
              const label = d.day.slice(5) // MM-DD
              return (
                <div
                  key={d.day}
                  className="flex flex-col items-center gap-1 min-w-[28px]"
                  title={`${d.day}: ${d.total}`}
                >
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{d.total}</span>
                  <div
                    className="w-5 rounded-t"
                    style={{
                      height: `${Math.max(4, pct)}%`,
                      minHeight: 4,
                      backgroundColor: 'var(--color-primary)',
                      opacity: 0.85,
                    }}
                  />
                  <span className="text-xs text-gray-400 dark:text-gray-500 rotate-45 origin-left whitespace-nowrap">
                    {label}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Sin datos en el periodo</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Por agente */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Por Agente</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Agente</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data?.convs_by_agent.length ? (
                  data.convs_by_agent.map((row) => (
                    <tr key={row.agent_name} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">{row.agent_name}</td>
                      <td className="px-3 py-3 text-center font-bold text-gray-900 dark:text-gray-100">{row.total}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="px-5 py-6 text-center text-gray-400 dark:text-gray-500">Sin datos</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Por departamento */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Por Departamento</h3>
          </div>
          <div className="p-5 space-y-3">
            {data?.convs_by_dept.length ? (
              (() => {
                const maxDept = Math.max(...(data.convs_by_dept.map((d) => d.total)), 1)
                return data.convs_by_dept.map((dept) => (
                  <div key={dept.dept_name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{dept.dept_name}</span>
                      <span className="font-bold text-gray-900 dark:text-gray-100">{dept.total}</span>
                    </div>
                    <ProgressBar pct={Math.round((dept.total / maxDept) * 100)} />
                  </div>
                ))
              })()
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">Sin datos</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Agentes ─────────────────────────────────────────────────────────────

function TabAgentes({ from, to, deptId }: { from: string; to: string; deptId: string }) {
  const { data, isLoading, isError, error } = useQuery<AgentesData>({
    queryKey: ['reports-agentes', from, to, deptId],
    queryFn: () =>
      api.get('/reports/agentes', { params: { from, to, dept_id: deptId || undefined } }).then((r) => r.data),
  })

  if (isLoading) return <Skeleton />
  if (isError) return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-center">
      <p className="text-sm text-red-600 dark:text-red-400 font-medium">Error al cargar agentes</p>
      <p className="text-xs text-red-400 dark:text-red-500 mt-1">{(error as any)?.response?.data?.message ?? (error as any)?.message ?? 'Error desconocido'}</p>
    </div>
  )

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Rendimiento por Agente</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              {['Agente', 'Total', 'Abiertos', 'Cerrados', '% Resolución'].map((h) => (
                <th
                  key={h}
                  className={`py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide ${
                    h === 'Agente' ? 'text-left px-5' : 'text-center px-3'
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {data?.agent_stats?.length ? (
              (data.agent_stats ?? []).map((agent) => {
                const resPct = agent.total > 0 ? Math.round((agent.closed_count / agent.total) * 100) : 0
                return (
                  <tr key={agent.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={agent.name} />
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{agent.name}</span>
                          {agent.is_bot && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                              🤖 Bot IA
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center font-bold text-gray-900 dark:text-gray-100">{agent.total}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        {agent.open_count}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                        {agent.closed_count}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <ResPctBadge pct={resPct} />
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-400 dark:text-gray-500">
                  Sin agentes con conversaciones en el periodo
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Tab: Campañas ────────────────────────────────────────────────────────────

function TabCampanas({ from, to, deptId }: { from: string; to: string; deptId: string }) {
  const { data, isLoading, isError, error } = useQuery<CampanasData>({
    queryKey: ['reports-campanas', from, to, deptId],
    queryFn: () =>
      api.get('/reports/campanas', { params: { from, to, dept_id: deptId || undefined } }).then((r) => r.data),
  })

  if (isLoading) return <Skeleton />
  if (isError) return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-center">
      <p className="text-sm text-red-600 dark:text-red-400 font-medium">Error al cargar campañas</p>
      <p className="text-xs text-red-400 dark:text-red-500 mt-1">{(error as any)?.response?.data?.message ?? (error as any)?.message ?? 'Error desconocido'}</p>
    </div>
  )

  const camps = data?.campaigns ?? []
  const totalCamps  = camps.length
  const totalRecips = camps.reduce((s, c) => s + c.total_recipients, 0)
  const totalSent   = camps.reduce((s, c) => s + c.sent_count, 0)
  const avgDelivery = totalRecips > 0 ? Math.round((totalSent / totalRecips) * 100) : 0

  const kpis = [
    { label: 'Campañas',         value: totalCamps,            badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', icon: '📢' },
    { label: 'Destinatarios',    value: fmt(totalRecips),      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',   icon: '👥' },
    { label: 'Enviados',         value: fmt(totalSent),        badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',  icon: '✅' },
    { label: '% Entrega Prom.',  value: `${avgDelivery}%`,     badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', icon: '📈' },
  ]

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{k.label}</span>
              <span className="text-lg">{k.icon}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Campaigns table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Detalle de Campañas</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                {['Campaña', 'Enviada por', 'Canal', 'Estado', 'Dest.', 'Enviados', 'Fallidos', '% Entrega', '$/msg', 'Costo Total', 'Fecha'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide first:pl-5 text-left"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {camps.length ? (
                camps.map((camp) => {
                  const delivPct =
                    camp.total_recipients > 0
                      ? Math.round((camp.sent_count / camp.total_recipients) * 100)
                      : 0
                  const campCost = camp.cost_per_message * camp.sent_count
                  const delivCls =
                    delivPct >= 90
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                      : delivPct >= 70
                      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  return (
                    <tr key={camp.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="pl-5 pr-3 py-3 font-medium text-gray-900 dark:text-gray-100 max-w-xs truncate">{camp.name}</td>
                      <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{camp.creator_name ?? '—'}</td>
                      <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{camp.channel_name ?? '—'}</td>
                      <td className="px-3 py-3"><StatusBadge status={camp.status} /></td>
                      <td className="px-3 py-3 text-center text-gray-700 dark:text-gray-300">{fmt(camp.total_recipients)}</td>
                      <td className="px-3 py-3 text-center text-gray-700 dark:text-gray-300">{fmt(camp.sent_count)}</td>
                      <td className="px-3 py-3 text-center text-red-700 dark:text-red-400">{fmt(camp.failed_count)}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${delivCls}`}>
                          {delivPct}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">${camp.cost_per_message.toFixed(4)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(campCost)}</td>
                      <td className="px-3 py-3 text-gray-500 dark:text-gray-400">{camp.created_at.slice(0, 10)}</td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={11} className="px-5 py-10 text-center text-gray-400 dark:text-gray-500">
                    Sin campañas en el periodo
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Campaigns by user */}
      {(data?.campaigns_by_user?.length ?? 0) > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Campañas por Usuario</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Usuario</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Campañas</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Costo Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {(data?.campaigns_by_user ?? []).map((cu) => (
                  <tr key={cu.creator_name} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">{cu.creator_name}</td>
                    <td className="px-3 py-3 text-center text-gray-700 dark:text-gray-300">{cu.total_campaigns}</td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(cu.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Costos ──────────────────────────────────────────────────────────────

function TabCostos({ from, to, deptId }: { from: string; to: string; deptId: string }) {
  const { data, isLoading } = useQuery<CostosData>({
    queryKey: ['reports-costos', from, to, deptId],
    queryFn: () =>
      api.get('/reports/costos', { params: { from, to, dept_id: deptId || undefined } }).then((r) => r.data),
  })

  if (isLoading) return <Skeleton />

  const maxMonthCost = Math.max(...(data?.cost_by_month?.map((m) => m.total_cost) ?? [1]), 1)
  const maxChCost    = Math.max(...(data?.cost_by_channel?.map((c) => c.total_cost) ?? [1]), 1)

  return (
    <div className="space-y-6">
      {/* Big totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Gasto Total Acumulado',   value: fmtMoney(data?.total_spent),           sub: 'Todas las campañas completadas' },
          { label: 'Costo Promedio / Campaña', value: fmtMoney(data?.avg_cost_per_campaign), sub: '' },
          { label: 'Canales con Gasto',        value: data?.cost_by_channel?.length ?? 0,    sub: '' },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex flex-col items-center justify-center text-center"
          >
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">{card.label}</p>
            <p className="text-4xl font-black text-gray-900 dark:text-gray-100">{card.value}</p>
            {card.sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Monthly cost */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Costo Mensual (últimos 12 meses)</h3>
        {data?.cost_by_month?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Mes</th>
                  <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Campañas</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Costo Total</th>
                  <th className="px-4 py-2 w-48" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.cost_by_month.map((m) => (
                  <tr key={m.month} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{m.month}</td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{m.total_campaigns}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{fmtMoney(m.total_cost)}</td>
                    <td className="px-4 py-3">
                      <ProgressBar pct={Math.round((m.total_cost / maxMonthCost) * 100)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Sin datos de costos en los últimos 12 meses</p>
        )}
      </div>

      {/* Cost by channel */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Costo por Canal</h3>
        {data?.cost_by_channel?.length ? (
          (data.cost_by_channel ?? []).map((ch) => (
            <div key={ch.channel_name} className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1">{ch.channel_name}</span>
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmtMoney(ch.total_cost)}</span>
              </div>
              <ProgressBar pct={Math.round((ch.total_cost / maxChCost) * 100)} />
            </div>
          ))
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">Sin datos</p>
        )}
      </div>

      {/* Individual message costs */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
        <div className="flex items-start gap-3 mb-5">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Costo de mensajes individuales</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Plantillas enviadas desde nueva conversación o desde el chat (fuera de campañas). Período seleccionado.
            </p>
          </div>
          <div className="ml-auto text-right flex-shrink-0">
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmtMoney(data?.indiv_total_cost, 4)}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {data?.indiv_total_count ?? 0} mensaje{data?.indiv_total_count !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {(data?.indiv_cost_by_agent?.length ?? 0) > 0 ? (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                <th className="pb-2">Agente</th>
                <th className="pb-2 text-right">Mensajes</th>
                <th className="pb-2 text-right">Costo total</th>
                <th className="pb-2 text-right">Costo / msg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {(data?.indiv_cost_by_agent ?? []).map((row) => (
                <tr key={row.agent_name}>
                  <td className="py-2 font-medium text-gray-800 dark:text-gray-200">{row.agent_name}</td>
                  <td className="py-2 text-right text-gray-600 dark:text-gray-400">{row.total_msgs}</td>
                  <td className="py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(row.total_cost, 4)}</td>
                  <td className="py-2 text-right text-gray-500 dark:text-gray-400">
                    {row.total_msgs > 0 ? `$${(row.total_cost / row.total_msgs).toFixed(6)}` : '$0'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
            No hay mensajes individuales con costo en este período.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Por Agente ──────────────────────────────────────────────────────────

function TabPorAgente({ from, to, deptId }: { from: string; to: string; deptId: string }) {
  const [filterAgentId, setFilterAgentId] = useState('')
  const [filterStatus,  setFilterStatus]  = useState('')
  const [filterSearch,  setFilterSearch]  = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery<PorAgenteData>({
    queryKey: ['reports-por-agente', from, to, filterAgentId, filterStatus, filterSearch, page, deptId],
    queryFn: () =>
      api
        .get('/reports/por-agente', {
          params: { from, to, agent_id: filterAgentId || undefined, status: filterStatus || undefined, search: filterSearch || undefined, page, dept_id: deptId || undefined },
        })
        .then((r) => r.data),
  })

  const hasFilters = filterAgentId || filterStatus || filterSearch

  const clearFilters = () => {
    setFilterAgentId('')
    setFilterStatus('')
    setFilterSearch('')
    setPage(1)
  }

  const filterKpis = [
    { label: 'Total en periodo', value: data?.stats.total ?? '—', bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300' },
    { label: 'Abiertos',         value: data?.stats.open    ?? '—', bg: 'bg-green-100 dark:bg-green-900/40',  text: 'text-green-700 dark:text-green-300' },
    { label: 'Pendientes',       value: data?.stats.pending ?? '—', bg: 'bg-yellow-100 dark:bg-yellow-900/40',text: 'text-yellow-700 dark:text-yellow-300' },
    { label: 'Finalizados',      value: data?.stats.closed  ?? '—', bg: 'bg-blue-100 dark:bg-blue-900/40',    text: 'text-blue-700 dark:text-blue-300' },
  ]

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Agente</label>
            <select
              value={filterAgentId}
              onChange={(e) => { setFilterAgentId(e.target.value); setPage(1) }}
              className="border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none"
            >
              <option value="">Todos los agentes</option>
              {data?.agent_list.map((a) => (
                <option key={a.id} value={a.id}>{a.is_bot ? `🤖 ${a.name}` : a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Estado</label>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
              className="border border-gray-200 dark:border-gray-600 rounded-xl pl-3 pr-8 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none"
            >
              <option value="">Todos los estados</option>
              <option value="open">Abiertos</option>
              <option value="pending">Pendientes</option>
              <option value="closed">Finalizados</option>
            </select>
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Buscar contacto</label>
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => { setFilterSearch(e.target.value); setPage(1) }}
              placeholder="Nombre o teléfono..."
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none"
            />
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {filterKpis.map((k) => (
          <div key={k.label} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-4">
            <div className={`w-10 h-10 ${k.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
              <span className={`text-lg font-bold ${k.text}`}>{k.value}</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-x-auto">
        {isLoading ? (
          <Skeleton />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  {['Contacto', 'Canal', 'Agente', 'Estado', 'Creado'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {data?.convs.data.length ? (
                  data.convs.data.map((conv) => (
                    <tr key={conv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{conv.contact_name ?? 'Sin nombre'}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{conv.contact_phone ?? ''}</p>
                      </td>
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{conv.channel_name ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{conv.agent_name ?? '—'}</td>
                      <td className="px-5 py-3"><StatusBadge status={conv.status} /></td>
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">
                        {conv.created_at.slice(0, 16).replace('T', ' ')}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-gray-400 dark:text-gray-500">
                      No hay conversaciones con los filtros seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {/* Pagination */}
            {(data?.convs.last_page ?? 1) > 1 && (
              <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">
                  Página {data?.convs.current_page} de {data?.convs.last_page} — {fmt(data?.convs.total)} total
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    ← Anterior
                  </button>
                  <button
                    disabled={page >= (data?.convs.last_page ?? 1)}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Siguiente →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Por Tags ────────────────────────────────────────────────────────────

function TabPorTags({ from, to, deptId }: { from: string; to: string; deptId: string }) {
  const { data, isLoading } = useQuery<PorTagsData>({
    queryKey: ['reports-por-tags', from, to, deptId],
    queryFn: () =>
      api.get('/reports/por-tags', { params: { from, to, dept_id: deptId || undefined } }).then((r) => r.data),
  })

  if (isLoading) return <Skeleton />

  const tags       = data?.tag_stats ?? []
  const tagTotal   = tags.reduce((s, t) => s + t.total, 0)
  const tagOpen    = tags.reduce((s, t) => s + t.open_count, 0)
  const tagClosed  = tags.reduce((s, t) => s + t.closed_count, 0)
  const tagResPct  = tagTotal > 0 ? Math.round((tagClosed / tagTotal) * 100) : 0
  const maxTagTotal = Math.max(...tags.map((t) => t.total), 1)

  const kpis = [
    { label: 'Tags activos',   value: tags.length,     bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-700 dark:text-purple-300' },
    { label: 'Conversaciones', value: tagTotal,         bg: 'bg-indigo-100 dark:bg-indigo-900/40', text: 'text-indigo-700 dark:text-indigo-300' },
    { label: 'Abiertas',       value: tagOpen,          bg: 'bg-green-100 dark:bg-green-900/40',   text: 'text-green-700 dark:text-green-300' },
    { label: 'Cerradas',       value: tagClosed,        bg: 'bg-blue-100 dark:bg-blue-900/40',     text: 'text-blue-700 dark:text-blue-300' },
    { label: '% Resolución',   value: `${tagResPct}%`, bg: 'bg-teal-100 dark:bg-teal-900/40',    text: 'text-teal-700 dark:text-teal-300' },
  ]

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 ${k.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
              <span className={`text-sm font-bold ${k.text}`}>{k.value}</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-tight">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Tags table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Conversaciones por Tag</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Período seleccionado. Una conversación puede tener múltiples tags.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                {['Tag', 'Total', 'Abiertas', 'Cerradas', '% Resolución', ''].map((h, i) => (
                  <th
                    key={i}
                    className={`py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide ${
                      i === 0 ? 'text-left px-5' : i === 6 ? 'px-5 w-40' : 'text-center px-4'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {tags.length ? (
                tags.map((tag) => {
                  const resPct = tag.total > 0 ? Math.round((tag.closed_count / tag.total) * 100) : 0
                  return (
                    <tr key={tag.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                          <span className="font-medium text-gray-900 dark:text-gray-100">{tag.tag_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-gray-900 dark:text-gray-100">{tag.total}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                          {tag.open_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          {tag.closed_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ResPctBadge pct={resPct} />
                      </td>
                      <td className="px-5 py-3">
                        {tag.total > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full"
                                style={{ width: `${resPct}%`, backgroundColor: tag.color }}
                              />
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-gray-400 dark:text-gray-500">
                    No hay conversaciones con tags en el período seleccionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Distribución por tag (horizontal bars) */}
      {tags.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Distribución por Tag</h3>
          <div className="space-y-3">
            {tags.map((tag) => (
              <div key={tag.id}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1 truncate">{tag.tag_name}</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">{tag.total}</span>
                </div>
                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2 ml-4">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.round((tag.total / maxTagTotal) * 100)}%`,
                      backgroundColor: tag.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Export CSV helper ────────────────────────────────────────────────────────

function downloadCSV(tab: TabKey, from: string, to: string, setDownloading: (v: boolean) => void) {
  setDownloading(true)
  const url = `/api/reports/export?tab=${tab}&from=${from}&to=${to}`
  const a = document.createElement('a')
  a.href = url
  a.download = `reporte_${tab}_${from}_al_${to}.csv`
  a.click()
  setTimeout(() => setDownloading(false), 1500)
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const today      = new Date().toISOString().slice(0, 10)
  const oneYearAgo = new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().slice(0, 10)
  const user       = useAuthStore(s => s.user)
  const isAdmin    = user?.role === 'admin'

  const [from,        setFrom]        = useState(oneYearAgo)
  const [to,          setTo]          = useState(today)
  const [tab,         setTab]         = useState<TabKey>('resumen')
  const [deptId,      setDeptId]      = useState('')
  const [downloading, setDownloading] = useState(false)
  const dateError = to < from ? 'La fecha "Hasta" debe ser posterior a "Desde".' : ''

  const tabProps = { from, to, deptId }
  const activeTabContent =
    tab === 'resumen'        ? <TabResumen        {...tabProps} /> :
    tab === 'conversaciones' ? <TabConversaciones {...tabProps} /> :
    tab === 'agentes'        ? <TabAgentes        {...tabProps} /> :
    tab === 'campanas'       ? <TabCampanas       {...tabProps} /> :
    tab === 'costos'         ? <TabCostos         {...tabProps} /> :
    tab === 'por-agente'     ? <TabPorAgente      {...tabProps} /> :
    tab === 'por-tags'       ? <TabPorTags        {...tabProps} /> : null

  const { data: depts = [] } = useQuery<AllDept[]>({
    queryKey: ['departments-for-reports'],
    queryFn: () => api.get('/departments').then(r => r.data.data ?? []),
    enabled: isAdmin,
    staleTime: 60000,
  })

  return (
    <div className="p-6 space-y-6">
      {/* Top bar: date range + CSV + tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          {/* Date range + export */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Desde</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
              />
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Hasta</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={`text-sm border rounded-lg px-3 py-1.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 ${dateError ? 'border-red-400' : 'border-gray-200 dark:border-gray-600'}`}
              />
              {isAdmin && depts.length > 0 && (
                <select
                  value={deptId}
                  onChange={e => setDeptId(e.target.value)}
                  className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                >
                  <option value="">Todos los departamentos</option>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              <button
                onClick={() => !dateError && downloadCSV(tab, from, to, setDownloading)}
                disabled={downloading || !!dateError}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 transition-colors disabled:opacity-50"
              >
                {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {downloading ? 'Descargando…' : 'Descargar CSV'}
              </button>
            </div>
            {dateError && <p className="text-xs text-red-500">{dateError}</p>}
          </div>

          {/* Tab pills */}
          <div className="flex gap-1 flex-wrap">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={
                  tab === key
                    ? 'px-4 py-1.5 rounded-full text-sm font-medium transition-colors text-white'
                    : 'px-4 py-1.5 rounded-full text-sm font-medium transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }
                style={tab === key ? { backgroundColor: 'var(--color-primary)' } : undefined}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTabContent}
    </div>
  )
}
