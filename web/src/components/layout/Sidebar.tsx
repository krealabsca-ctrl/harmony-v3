import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import api from '@/api/client'
import {
  MessageSquare, LayoutDashboard, Users, Building2, Megaphone,
  FileText, Settings, BarChart3, Monitor, GitBranch, Bot,
  Tag, DollarSign, Radio, LogOut, BookOpen, MessageCircle, History,
  PieChart, Pencil, Calendar, Flag, Hash
} from 'lucide-react'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
    isActive
      ? 'bg-white/20 text-white font-medium'
      : 'text-white/70 hover:bg-white/10 hover:text-white'
  }`

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, isSuperAdmin, isAdmin, isSupervisor, isMercadeo, canAccessAdvertising } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await api.post('/auth/logout').catch(() => {})
    useAuthStore.getState().logout()
    navigate('/login')
  }

  const avatarInitials = user?.name.slice(0, 2).toUpperCase()

  return (
    <>
      {/* #12: overlay oscuro tras el drawer en móvil. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 flex flex-col h-screen transform transition-transform duration-200 md:static md:translate-x-0 md:flex-shrink-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-secondary) 100%)' }}
      >
        {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/20">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/20 flex-shrink-0">
          <Hash className="w-5 h-5 text-white" strokeWidth={2.5} />
        </div>
        <span className="font-bold text-lg text-white truncate">Harmony</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1" onClick={onClose}>

        {/* SuperAdmin */}
        {isSuperAdmin && (
          <>
            <div className="pt-1">
              <p className="px-3 text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Empresas</p>
              <NavLink to="/admin/companies" className={linkClass}>
                <Building2 className="w-5 h-5" /><span>Gestión de Empresas</span>
              </NavLink>
            </div>
            <div className="pt-3 mt-3 border-t border-white/20">
              <p className="px-3 text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Sistema</p>
              <NavLink to="/admin/system-settings" className={linkClass}>
                <Settings className="w-5 h-5" /><span>Configuración del Sistema</span>
              </NavLink>
            </div>
          </>
        )}

        {/* Admin / Supervisor / Agente */}
        {!isSuperAdmin && !isMercadeo && (
          <>
            <NavLink to="/inbox" className={linkClass}>
              <MessageSquare className="w-5 h-5" /><span>Bandeja de Entrada</span>
            </NavLink>

            <NavLink to="/chat-history" className={linkClass}>
              <MessageSquare className="w-5 h-5" /><span>Historial de Chat</span>
            </NavLink>

            <NavLink to="/dashboard" className={linkClass}>
              <LayoutDashboard className="w-5 h-5" /><span>Dashboard</span>
            </NavLink>

            {isAdmin && (
              <NavLink to="/channels" className={linkClass}>
                <Radio className="w-5 h-5" /><span>Canales</span>
              </NavLink>
            )}

            {(isAdmin || isSupervisor) && (
              <>
                <NavLink to="/templates" className={linkClass}>
                  <FileText className="w-5 h-5" /><span>Plantillas</span>
                </NavLink>
                <NavLink to="/campaigns" className={linkClass}>
                  <Megaphone className="w-5 h-5" /><span>Campañas</span>
                </NavLink>
                <NavLink to="/reports" className={linkClass}>
                  <BarChart3 className="w-5 h-5" /><span>Reportes</span>
                </NavLink>
                <NavLink to="/monitor" className={linkClass}>
                  <Monitor className="w-5 h-5" /><span>Monitoreo</span>
                </NavLink>
              </>
            )}

            {isAdmin && (
              <>
                <div className="pt-3 mt-3 border-t border-white/20">
                  <p className="px-3 text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Administración</p>
                  <NavLink to="/admin/users" className={linkClass}>
                    <Users className="w-5 h-5" /><span>Usuarios</span>
                  </NavLink>
                  <NavLink to="/admin/departments" className={linkClass}>
                    <GitBranch className="w-5 h-5" /><span>Departamentos</span>
                  </NavLink>
                  <NavLink to="/admin/tags" className={linkClass}>
                    <Tag className="w-5 h-5" /><span>Tags</span>
                  </NavLink>
                  <NavLink to="/admin/whatsapp-pricing" className={linkClass}>
                    <DollarSign className="w-5 h-5" /><span>Precios WA</span>
                  </NavLink>
                </div>

                <div className="pt-3 mt-3 border-t border-white/20">
                  <p className="px-3 text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Bot IA</p>
                  <NavLink to="/bot/settings" className={linkClass}>
                    <Bot className="w-5 h-5" /><span>Configuración Bot</span>
                  </NavLink>
                  <NavLink to="/bot/knowledge-base" className={linkClass}>
                    <Bot className="w-5 h-5" /><span>Base de Conocimiento</span>
                  </NavLink>
                </div>
              </>
            )}

            {canAccessAdvertising && (
              <div className="pt-3 mt-3 border-t border-white/20">
                <p className="px-3 text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Publicidad</p>
                <NavLink to="/pub" end className={linkClass}>
                  <PieChart className="w-5 h-5" /><span>Panel</span>
                </NavLink>
                <NavLink to="/pub/content-studio" className={linkClass}>
                  <Pencil className="w-5 h-5" /><span>Estudio de Contenido</span>
                </NavLink>
                <NavLink to="/pub/calendar" className={linkClass}>
                  <Calendar className="w-5 h-5" /><span>Calendario</span>
                </NavLink>
                {isAdmin && (
                  <NavLink to="/pub/agents" className={linkClass}>
                    <Bot className="w-5 h-5" /><span>Agentes IA</span>
                  </NavLink>
                )}
                <NavLink to="/pub/campaigns" className={linkClass}>
                  <Flag className="w-5 h-5" /><span>Campañas Pub</span>
                </NavLink>
                <NavLink to="/pub/leads" className={linkClass}>
                  <Users className="w-5 h-5" /><span>Leads</span>
                </NavLink>
                <NavLink to="/pub/brand-kit" className={linkClass}>
                  <BookOpen className="w-5 h-5" /><span>Brand Kit</span>
                </NavLink>
                <NavLink to="/pub/comments" className={linkClass}>
                  <MessageCircle className="w-5 h-5" /><span>Comentarios</span>
                </NavLink>
                <NavLink to="/pub/analytics" className={linkClass}>
                  <BarChart3 className="w-5 h-5" /><span>Analíticas</span>
                </NavLink>
                <NavLink to="/pub/settings" className={linkClass}>
                  <Settings className="w-5 h-5" /><span>Configuración</span>
                </NavLink>
              </div>
            )}

            {(isAdmin || isSuperAdmin) && (
              <div className="pt-3 mt-3 border-t border-white/20">
                <p className="px-3 text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Configuración</p>
                <NavLink to="/settings/history" className={linkClass}>
                  <History className="w-5 h-5" /><span>Historial</span>
                </NavLink>
              </div>
            )}
          </>
        )}

        {/* Mercadeo: solo Publicidad */}
        {isMercadeo && canAccessAdvertising && (
          <>
            <div className="pt-1">
              <p className="px-3 text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Publicidad</p>
              <NavLink to="/pub" end className={linkClass}>
                <PieChart className="w-5 h-5" /><span>Panel</span>
              </NavLink>
              <NavLink to="/pub/content-studio" className={linkClass}>
                <Pencil className="w-5 h-5" /><span>Estudio de Contenido</span>
              </NavLink>
              <NavLink to="/pub/calendar" className={linkClass}>
                <Calendar className="w-5 h-5" /><span>Calendario</span>
              </NavLink>
              {isAdmin && (
                <NavLink to="/pub/agents" className={linkClass}>
                  <Bot className="w-5 h-5" /><span>Agentes IA</span>
                </NavLink>
              )}
              <NavLink to="/pub/campaigns" className={linkClass}>
                <Flag className="w-5 h-5" /><span>Campañas Pub</span>
              </NavLink>
              <NavLink to="/pub/leads" className={linkClass}>
                <Users className="w-5 h-5" /><span>Leads</span>
              </NavLink>
              <NavLink to="/pub/brand-kit" className={linkClass}>
                <BookOpen className="w-5 h-5" /><span>Brand Kit</span>
              </NavLink>
              <NavLink to="/pub/comments" className={linkClass}>
                <MessageCircle className="w-5 h-5" /><span>Comentarios</span>
              </NavLink>
              <NavLink to="/pub/analytics" className={linkClass}>
                <BarChart3 className="w-5 h-5" /><span>Analíticas</span>
              </NavLink>
              <NavLink to="/pub/settings" className={linkClass}>
                <Settings className="w-5 h-5" /><span>Configuración</span>
              </NavLink>
            </div>
          </>
        )}

      </nav>

      {/* User footer */}
      <div className="border-t border-white/20 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-bold">
              {avatarInitials}
            </div>
            <span
              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                user?.is_online ? 'bg-green-400' : 'bg-gray-400'
              }`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.name}</p>
            <p className="text-xs text-white/60 truncate capitalize">{user?.role ?? ''}</p>
          </div>
          <button onClick={handleLogout} className="text-white/60 hover:text-white p-1" title="Cerrar sesión">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
      </aside>
    </>
  )
}
