import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertCircle, FlaskConical } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '@/api/client'
import { useAuth } from '@/hooks/useAuth'

// ─── Descripción ───────────────────────────────────────────────────────────────
/*
 * DashboardPage — Panel de métricas de Harmony v3
 *
 * Propósito:
 *   Muestra KPIs y tablas de rendimiento adaptados al rol del usuario:
 *   - Vista "team"  (admin / supervisor / superadmin): métricas agregadas del equipo
 *     con desglose por agente y filtros de rango de fecha y agente específico.
 *   - Vista "agent" (agente regular): métricas personales del usuario autenticado
 *     con listado de sus conversaciones del período.
 *
 *   El backend decide qué vista devolver según el token JWT de la sesión.
 *
 * Sub-componentes principales:
 *   - FiltersBar      : barra de filtros de fecha + selector de agente (team) + atajos rápidos
 *   - TeamDashboard   : cuatro KPI cards + tabla de rendimiento por agente
 *   - AgentDashboard  : cinco KPI cards + listado de conversaciones del período
 *
 * Flujo de datos:
 *   1. El componente lee el rol del usuario con useAuth() para determinar isTeam.
 *   2. useQuery(['dashboard', filters]) llama GET /dashboard con los parámetros
 *      de fecha y (opcionalmente) agent_id; se refresca cada 30 s.
 *   3. El API responde con { view: 'team' | 'agent', ...metricas }.
 *   4. FiltersBar emite onChange que actualiza el estado `filters`, lo que cambia
 *      la queryKey y dispara un nuevo fetch.
 *   5. seedMutation permite a los admins cargar datos de demostración (POST /admin/seed).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentRow {
  id: number
  name: string
  role: string
  is_online: boolean
  stat_open: number
  stat_closed: number
  stat_total: number
}

interface AllAgent {
  id: number
  name: string
  is_online: boolean
}

interface AllDept {
  id: number
  name: string
}

interface TeamData {
  view: 'team'
  total_open: number
  total_closed: number
  total_closed_today: number
  agents: AgentRow[]
  all_agents: AllAgent[]
  all_departments: AllDept[]
  date_from: string
  date_to: string
}

interface ConvItem {
  id: number
  contact_name: string
  case_number: string
  status: string
  last_message_at: string
}

interface AgentData {
  view: 'agent'
  open_cases: number
  closed_total: number
  closed_today: number
  closed_week: number
  conversations: ConvItem[]
  date_from: string
  date_to: string
}

/* Unión discriminada: el campo `view` permite distinguir ambas respuestas del API */
type DashboardData = TeamData | AgentData

// ─── Helpers ──────────────────────────────────────────────────────────────────

/* Retorna la fecha de hoy en formato YYYY-MM-DD (zona local del navegador) */
function todayStr() {
  return new Date().toISOString().split('T')[0]
}

/* Retorna el primer día del mes actual en formato YYYY-MM-DD */
function monthStartStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/* Retorna el lunes de la semana actual en formato YYYY-MM-DD.
   Si hoy es domingo (day === 0), retrocede 6 días para llegar al lunes. */
function weekStartStr() {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(d)
  mon.setDate(d.getDate() + diff)
  return mon.toISOString().split('T')[0]
}

/* Formatea una fecha ISO (YYYY-MM-DD) al formato local DD/MM/YYYY para mostrar en UI */
function fmtDate(iso: string) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// ─── Filters bar ──────────────────────────────────────────────────────────────

interface FiltersProps {
  dateFrom: string
  dateTo: string
  agentId: string
  deptId: string
  allAgents?: AllAgent[]
  allDepts?: AllDept[]
  isTeam: boolean
  isAdmin: boolean
  onChange: (f: { dateFrom: string; dateTo: string; agentId: string; deptId: string }) => void
}

/**
 * FiltersBar
 *
 * Barra de filtros de fecha y agente del dashboard. Renderiza:
 *   - Selector de agente (solo en vista team, requiere allAgents)
 *   - Campos de fecha "Desde" y "Hasta"
 *   - Botones de acceso rápido: Hoy, Semana y Mes
 *   - Botón "Limpiar" (solo en vista team) que resetea al rango mes actual y quita el agente
 *
 * Cada cambio llama a `onChange` con el objeto de filtros completo actualizado.
 * La función interna `set` permite aplicar cambios parciales con spread.
 *
 * @param dateFrom   - Fecha inicio actual del filtro (YYYY-MM-DD)
 * @param dateTo     - Fecha fin actual del filtro (YYYY-MM-DD)
 * @param agentId    - ID del agente seleccionado como string, '' = todos
 * @param allAgents  - Lista de agentes para el selector (solo en vista team)
 * @param isTeam     - true si el usuario tiene rol de admin/supervisor/superadmin
 * @param onChange   - Callback con los nuevos filtros al cambiar cualquier campo
 */
function FiltersBar({ dateFrom, dateTo, agentId, deptId, allAgents, allDepts, isTeam, isAdmin, onChange }: FiltersProps) {
  function set(patch: Partial<{ dateFrom: string; dateTo: string; agentId: string; deptId: string }>) {
    onChange({ dateFrom, dateTo, agentId, deptId, ...patch })
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm px-4 py-3 mb-6 flex flex-wrap gap-3 items-center">
      {/* Filter icon */}
      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
      </svg>

      {/* Selector de departamento — solo admin */}
      {isTeam && isAdmin && allDepts && allDepts.length > 0 && (
        <>
          <select
            value={deptId}
            onChange={e => set({ deptId: e.target.value, agentId: '' })}
            className="border border-gray-200 dark:border-gray-600 rounded-lg pl-3 pr-8 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 hover:bg-white dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent cursor-pointer transition-colors min-w-44"
          >
            <option value="">Todos los departamentos</option>
            {allDepts.map(d => (
              <option key={d.id} value={String(d.id)}>{d.name}</option>
            ))}
          </select>
          <span className="text-gray-300 dark:text-gray-600 text-sm">|</span>
        </>
      )}

      {/* Selector de agente — solo visible en la vista team cuando se tienen datos de agentes */}
      {isTeam && allAgents && (
        <>
          <select
            value={agentId}
            onChange={e => set({ agentId: e.target.value })}
            className="border border-gray-200 dark:border-gray-600 rounded-lg pl-3 pr-8 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 hover:bg-white dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent cursor-pointer transition-colors min-w-44"
          >
            <option value="">Todos los agentes</option>
            {allAgents.map(a => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
          </select>
          <span className="text-gray-300 dark:text-gray-600 text-sm">|</span>
        </>
      )}

      {/* Date from */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 whitespace-nowrap">Desde</span>
        <input type="date" value={dateFrom}
          onChange={e => set({ dateFrom: e.target.value })}
          className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 hover:bg-white dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-colors" />
      </div>

      {/* Date to */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 whitespace-nowrap">Hasta</span>
        <input type="date" value={dateTo}
          onChange={e => set({ dateTo: e.target.value })}
          className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 hover:bg-white dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-colors" />
      </div>

      <span className="text-gray-300 dark:text-gray-600 text-sm">|</span>

      {/* Botones de rango rápido: cada uno llama a `set` con las fechas calculadas */}
      <div className="flex gap-1">
        {[
          { label: 'Hoy', fn: () => set({ dateFrom: todayStr(), dateTo: todayStr() }) },
          { label: 'Semana', fn: () => set({ dateFrom: weekStartStr(), dateTo: todayStr() }) },
          { label: 'Mes', fn: () => set({ dateFrom: monthStartStr(), dateTo: todayStr() }) },
        ].map(btn => (
          <button key={btn.label} onClick={btn.fn}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 hover:bg-white dark:hover:bg-gray-600 hover:border-gray-300 transition-colors">
            {btn.label}
          </button>
        ))}
      </div>

      {/* Botón limpiar — solo en vista team para resetear todos los filtros al estado inicial */}
      {isTeam && (
        <button
          onClick={() => onChange({ dateFrom: monthStartStr(), dateTo: todayStr(), agentId: '', deptId: '' })}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Limpiar
        </button>
      )}
    </div>
  )
}

// ─── Team Dashboard ───────────────────────────────────────────────────────────

/**
 * TeamDashboard
 *
 * Vista de dashboard para roles admin / supervisor / superadmin.
 * Renderiza:
 *   - 4 KPI cards: Casos Abiertos, Pendientes, Cerrados en el período y Total período
 *   - Tabla de rendimiento por agente con columnas: nombre, estado en línea,
 *     abiertos, pendientes, cerrados y total
 *   - Fila de totales al pie de la tabla (si hay más de 1 agente)
 *
 * El campo `total` se calcula localmente sumando las tres categorías del servidor.
 *
 * @param data - Respuesta del API con view === 'team'
 */
function TeamDashboard({ data }: { data: TeamData }) {
  const total = data.total_open + data.total_closed

  return (
    <div>
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Casos Abiertos</p>
          <p className="text-3xl font-bold mt-1" style={{ color: 'var(--color-primary)' }}>{data.total_open}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Cerrados (período)</p>
          <p className="text-3xl font-bold mt-1 text-green-600">{data.total_closed}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{data.total_closed_today} hoy</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total período</p>
          <p className="text-3xl font-bold mt-1 text-gray-800 dark:text-gray-100">{total}</p>
        </div>
      </div>

      {/* Tabla de rendimiento por agente */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Rendimiento por Agente</h3>
          {/* Rango de fechas del período activo */}
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {fmtDate(data.date_from)} al {fmtDate(data.date_to)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Agente</th>
                <th className="px-5 py-3 text-center">Estado</th>
                <th className="px-5 py-3 text-center">Abiertos</th>
                <th className="px-5 py-3 text-center">Cerrados</th>
                <th className="px-5 py-3 text-center">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {data.agents.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    Sin agentes para mostrar
                  </td>
                </tr>
              )}
              {data.agents.map(agent => (
                <tr key={agent.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: 'var(--color-primary)' }}>
                        {agent.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-gray-100">{agent.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">{agent.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                      <span className={`w-2 h-2 rounded-full ${agent.is_online ? 'bg-green-400' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      {agent.is_online ? 'En línea' : 'Desconectado'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center font-semibold" style={{ color: 'var(--color-primary)' }}>
                    {agent.stat_open}
                  </td>
                  <td className="px-5 py-3 text-center font-semibold text-green-600">
                    {agent.stat_closed}
                  </td>
                  <td className="px-5 py-3 text-center font-bold text-gray-700 dark:text-gray-200">
                    {agent.stat_total}
                  </td>
                </tr>
              ))}
            </tbody>
            {data.agents.length > 1 && (
              <tfoot className="bg-gray-50 dark:bg-gray-900 text-xs font-semibold text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
                <tr>
                  <td className="px-5 py-3" colSpan={2}>Totales</td>
                  <td className="px-5 py-3 text-center" style={{ color: 'var(--color-primary)' }}>
                    {data.agents.reduce((s, a) => s + a.stat_open, 0)}
                  </td>
                  <td className="px-5 py-3 text-center text-green-600">
                    {data.agents.reduce((s, a) => s + a.stat_closed, 0)}
                  </td>
                  <td className="px-5 py-3 text-center text-gray-700 dark:text-gray-200">
                    {data.agents.reduce((s, a) => s + a.stat_total, 0)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Agent Dashboard ──────────────────────────────────────────────────────────

/**
 * AgentDashboard
 *
 * Vista de dashboard personal para agentes regulares.
 * Renderiza:
 *   - 5 KPI cards: Abiertos, Pendientes, Cerrados (período), Cerrados Hoy y Cerrados Semana
 *   - Listado de conversaciones del período con nombre del contacto, número de caso,
 *     estado (color-coded) y fecha/hora del último mensaje
 *
 * @param data - Respuesta del API con view === 'agent'
 */
function AgentDashboard({ data }: { data: AgentData }) {
  // Fecha de hoy formateada en español (Costa Rica) para mostrar en la KPI de "Cerrados Hoy"
  const today = new Date().toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div>
      {/* KPIs — 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Abiertos</p>
          <p className="text-3xl font-bold mt-1" style={{ color: 'var(--color-primary)' }}>{data.open_cases}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">en el período</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Cerrados (período)</p>
          <p className="text-3xl font-bold mt-1 text-green-600">{data.closed_total}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">total seleccionado</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Cerrados Hoy</p>
          <p className="text-3xl font-bold mt-1 text-green-500">{data.closed_today}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{today}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Cerrados Semana</p>
          <p className="text-3xl font-bold mt-1 text-blue-600">{data.closed_week}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">lun–dom</p>
        </div>
      </div>

      {/* Listado de conversaciones del período */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Conversaciones del período</h3>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {fmtDate(data.date_from)} al {fmtDate(data.date_to)}
          </span>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {data.conversations.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
              Sin conversaciones en el período seleccionado
            </p>
          )}
          {data.conversations.map(conv => (
            <div key={conv.id} className="flex items-center gap-4 px-5 py-3">
              {/* Avatar con las 2 primeras letras del nombre del contacto */}
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {(conv.contact_name || 'U').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {conv.contact_name || 'Desconocido'}
                </p>
                <p className="text-xs text-gray-400 font-mono">{conv.case_number}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <span className={`text-xs px-2 py-1 rounded-full block ${
                  conv.status === 'open'    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                  conv.status === 'closed'  ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' :
                                              'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                }`}>
                  {conv.status === 'closed' ? 'Cerrado' : 'Abierto'}
                </span>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{conv.last_message_at}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * DashboardPage (export default)
 *
 * Componente raíz del dashboard. Orquesta:
 *   - Determinación del tipo de vista (team vs. agent) según el rol del usuario
 *   - Estado de los filtros de fecha y agente
 *   - Carga de datos del API con react-query (refresco automático cada 30s)
 *   - Renderizado condicional de FiltersBar, TeamDashboard o AgentDashboard
 *   - Mutación de seed de datos demo (solo visible para admins)
 *
 * Sin props — el rol se obtiene de useAuth().
 */
export default function DashboardPage() {
  const { isSuperAdmin, isAdmin, isSupervisor } = useAuth()
  // Los roles con acceso a la vista de equipo son superadmin, admin y supervisor
  const isTeam = isSuperAdmin || isAdmin || isSupervisor
  const qc = useQueryClient()

  /*
   * Mutación de seed: disponible solo para admins en entornos de desarrollo/demo.
   * POST /admin/seed crea conversaciones, mensajes y contactos de prueba.
   * Al completar, invalida todas las queries para refrescar el dashboard.
   */
  const seedMutation = useMutation({
    mutationFn: () => api.post('/admin/seed'),
    onSuccess: (res) => {
      toast.success(res.data.message ?? 'Datos demo cargados')
      // Invalida todas las queries del caché para forzar refetch general
      qc.invalidateQueries()
    },
    onError: () => toast.error('Error al cargar datos demo'),
  })

  const [filters, setFilters] = useState({
    dateFrom: monthStartStr(),
    dateTo: todayStr(),
    agentId: '',
    deptId: '',
  })

  /*
   * Carga de datos del dashboard.
   * La queryKey incluye `filters` para re-ejecutar el fetch cuando cambian los filtros.
   * agent_id se omite del payload si está vacío para no filtrar por agente.
   * Se refresca automáticamente cada 30 segundos para mantener los KPIs actualizados.
   */
  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ['dashboard', filters],
    queryFn: async () => {
      const params: Record<string, string> = {
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      }
      if (filters.agentId) params.agent_id = filters.agentId
      if (filters.deptId) params.dept_id = filters.deptId
      const res = await api.get('/dashboard', { params })
      return res.data
    },
    refetchInterval: 60_000,
  })

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          {/* El título cambia según si el usuario ve la vista de equipo o la personal */}
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {isTeam ? 'Dashboard' : 'Mi Dashboard'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {isTeam ? 'Rendimiento del equipo por período' : 'Tu actividad en el período seleccionado'}
          </p>
        </div>
        {/* Botón "Datos demo": solo visible para admins, muestra spinner durante la mutación */}
        {isAdmin && (
          <button
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            title="Cargar datos de prueba"
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
          >
            {seedMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
            {seedMutation.isPending ? 'Cargando...' : 'Datos demo'}
          </button>
        )}
      </div>

      <FiltersBar
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        agentId={filters.agentId}
        deptId={filters.deptId}
        allAgents={data?.view === 'team' ? data.all_agents : undefined}
        allDepts={data?.view === 'team' ? data.all_departments : undefined}
        isTeam={isTeam}
        isAdmin={isAdmin}
        onChange={setFilters}
      />

      {/* Estado de carga: spinner centrado mientras el API responde */}
      {isLoading && (
        <div className="flex items-center justify-center py-24 text-gray-400 dark:text-gray-500">
          <Loader2 size={28} className="animate-spin mr-3" />
          <span className="text-sm">Cargando dashboard...</span>
        </div>
      )}

      {/* Estado de error: banner rojo con mensaje informativo */}
      {isError && !isLoading && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-6 py-8 flex items-center gap-3">
          <AlertCircle size={20} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">
            No se pudo cargar el dashboard. Intenta recargar la página.
          </p>
        </div>
      )}

      {/* Renderizado condicional según la vista devuelta por el API */}
      {data?.view === 'team' && <TeamDashboard data={data} />}
      {data?.view === 'agent' && <AgentDashboard data={data} />}
    </div>
  )
}
