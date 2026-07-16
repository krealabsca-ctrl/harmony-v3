import React from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

class MonitorErrorBoundary extends React.Component<{children: React.ReactNode}, {error: Error | null}> {
  state: {error: Error | null} = {error: null}
  static getDerivedStateFromError(e: Error) { return {error: e} }
  render() {
    if (this.state.error) return (
      <div style={{padding:'2rem',fontFamily:'monospace',color:'red'}}>
        <strong>Monitor crash:</strong> {this.state.error.message}
        {/* FIX HIGH-07: stack trace solo en desarrollo para evitar information disclosure */}
        {import.meta.env.DEV && (
          <pre style={{marginTop:'1rem',fontSize:'11px',whiteSpace:'pre-wrap'}}>{this.state.error.stack}</pre>
        )}
      </div>
    )
    return this.props.children
  }
}
import { useCompanyTheme } from '@/hooks/useCompanyTheme'
import { useSystemFavicon } from '@/hooks/useSystemFavicon'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/auth/LoginPage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage'
import CompaniesPage from '@/pages/admin/CompaniesPage'
import SystemSettingsPage from '@/pages/admin/SystemSettingsPage'
import SystemEmailPage from '@/pages/admin/SystemEmailPage'
import UsersPage from '@/pages/admin/UsersPage'
import DepartmentsPage from '@/pages/admin/DepartmentsPage'
import TagsPage from '@/pages/admin/TagsPage'
import InboxPage from '@/pages/inbox/InboxPage'
import ChatHistoryPage from '@/pages/inbox/ChatHistoryPage'
import ConversationViewPage from '@/pages/inbox/ConversationViewPage'
import DashboardPage from '@/pages/dashboards/DashboardPage'
import MonitorPage from '@/pages/monitor/MonitorPage'
import ReportsPage from '@/pages/reports/ReportsPage'
import ChannelsPage from '@/pages/channels/ChannelsPage'
import TemplatesPage from '@/pages/templates/TemplatesPage'
import CampaignsPage from '@/pages/campaigns/CampaignsPage'
import BotSettingsPage from '@/pages/bot/BotSettingsPage'
import BotKnowledgePage from '@/pages/bot/BotKnowledgePage'
import PubDashboardPage from '@/pages/pub/PubDashboardPage'
import PubAgentsPage from '@/pages/pub/PubAgentsPage'
import PubContentStudioPage from '@/pages/pub/PubContentStudioPage'
import PubCalendarPage from '@/pages/pub/PubCalendarPage'
import PubCampaignsPage from '@/pages/pub/PubCampaignsPage'
import PubLeadsPage from '@/pages/pub/PubLeadsPage'
import PubAnalyticsPage from '@/pages/pub/PubAnalyticsPage'
import PubSettingsPage from '@/pages/pub/PubSettingsPage'
import PubCommentsPage from '@/pages/pub/PubCommentsPage'
import PubBrandKitPage from '@/pages/pub/PubBrandKitPage'
import BrandingSettingsPage from '@/pages/settings/BrandingSettingsPage'
import HistorySettingsPage from '@/pages/settings/HistorySettingsPage'
import WhatsAppPricingPage from '@/pages/admin/WhatsAppPricingPage'
import IntegrationGuidePage from '@/pages/channels/IntegrationGuidePage'
import NotFoundPage from '@/pages/NotFoundPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  const location = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

// Restringe una ruta a los roles indicados; redirige a /inbox si el usuario no tiene permiso.
function RequireRole({ allowed, children }: { allowed: string[]; children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  if (!user || !allowed.includes(user.role)) return <Navigate to="/inbox" replace />
  return <>{children}</>
}

export default function App() {
  useCompanyTheme()
  useSystemFavicon()
  return (
    <Routes>
      {/* Guest */}
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
      <Route path="/reset-password" element={<GuestOnly><ResetPasswordPage /></GuestOnly>} />

      {/* Authenticated */}
      <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
        {/* Root redirect */}
        <Route index element={<RootRedirect />} />
        {/* Superadmin */}
        <Route path="admin/companies" element={<RequireRole allowed={['superadmin']}><CompaniesPage /></RequireRole>} />
        <Route path="admin/system-settings" element={<RequireRole allowed={['superadmin']}><SystemSettingsPage /></RequireRole>} />
        <Route path="admin/system-email" element={<RequireRole allowed={['superadmin']}><SystemEmailPage /></RequireRole>} />
        <Route path="settings/branding" element={<RequireRole allowed={['superadmin']}><BrandingSettingsPage /></RequireRole>} />
        {/* Admin */}
        <Route path="settings/history" element={<RequireRole allowed={['admin']}><HistorySettingsPage /></RequireRole>} />
        <Route path="admin/users" element={<RequireRole allowed={['admin']}><UsersPage /></RequireRole>} />
        <Route path="admin/departments" element={<RequireRole allowed={['admin']}><DepartmentsPage /></RequireRole>} />
        <Route path="admin/tags" element={<RequireRole allowed={['admin']}><TagsPage /></RequireRole>} />
        <Route path="admin/whatsapp-pricing" element={<RequireRole allowed={['admin','supervisor']}><WhatsAppPricingPage /></RequireRole>} />
        <Route path="channels/*" element={<RequireRole allowed={['admin']}><ChannelsPage /></RequireRole>} />
        <Route path="channels/guide" element={<RequireRole allowed={['admin']}><IntegrationGuidePage /></RequireRole>} />
        <Route path="bot/settings" element={<RequireRole allowed={['admin']}><BotSettingsPage /></RequireRole>} />
        <Route path="bot/knowledge-base" element={<RequireRole allowed={['admin']}><BotKnowledgePage /></RequireRole>} />
        {/* Admin + Supervisor */}
        <Route path="templates/*" element={<RequireRole allowed={['admin','supervisor']}><TemplatesPage /></RequireRole>} />
        <Route path="campaigns/*" element={<RequireRole allowed={['admin','supervisor']}><CampaignsPage /></RequireRole>} />
        <Route path="reports" element={<RequireRole allowed={['admin','supervisor']}><ReportsPage /></RequireRole>} />
        <Route path="monitor" element={<RequireRole allowed={['admin','supervisor']}><MonitorErrorBoundary><MonitorPage /></MonitorErrorBoundary></RequireRole>} />
        {/* All operational */}
        <Route path="inbox" element={<InboxPage />} />
        <Route path="chat-history" element={<ChatHistoryPage />} />
        <Route path="chat-history/:id" element={<ConversationViewPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        {/* Pub */}
        <Route path="pub" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubDashboardPage /></RequireRole>} />
        <Route path="pub/agents" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubAgentsPage /></RequireRole>} />
        <Route path="pub/content-studio" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubContentStudioPage /></RequireRole>} />
        <Route path="pub/calendar" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubCalendarPage /></RequireRole>} />
        <Route path="pub/campaigns" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubCampaignsPage /></RequireRole>} />
        <Route path="pub/leads" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubLeadsPage /></RequireRole>} />
        <Route path="pub/analytics" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubAnalyticsPage /></RequireRole>} />
        <Route path="pub/settings" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubSettingsPage /></RequireRole>} />
        <Route path="pub/comments" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubCommentsPage /></RequireRole>} />
        <Route path="pub/brand-kit" element={<RequireRole allowed={['admin','supervisor','mercadeo']}><PubBrandKitPage /></RequireRole>} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

function RootRedirect() {
  const user = useAuthStore(s => s.user)
  if (!user) return null
  if (user.role === 'superadmin') return <Navigate to="/admin/companies" replace />
  if (user.role === 'mercadeo') return <Navigate to="/pub" replace />
  return <Navigate to="/inbox" replace />
}
