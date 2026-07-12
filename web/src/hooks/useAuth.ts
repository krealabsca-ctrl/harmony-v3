import { useAuthStore } from '@/stores/authStore'

export function useAuth() {
  // M-09: ya no existe `token` en el store (la sesión vive en la cookie httpOnly).
  const { user, logout } = useAuthStore()
  return {
    user,
    logout,
    isSuperAdmin: user?.role === 'superadmin',
    isAdmin: user?.role === 'admin',
    isSupervisor: user?.role === 'supervisor',
    isAgent: user?.role === 'agent',
    isMercadeo: user?.role === 'mercadeo',
    canSendCampaigns: user?.can_send_campaigns ?? false,
    canAccessAdvertising: user?.can_access_advertising ?? false,
  }
}
