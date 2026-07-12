import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: number
  name: string
  email: string
  role: 'superadmin' | 'admin' | 'supervisor' | 'agent' | 'mercadeo'
  company_id: number | null
  department_id: number | null
  can_send_campaigns: boolean
  can_access_advertising: boolean
  is_online?: boolean
  company?: {
    id: number
    name: string
    primary_color: string
    secondary_color: string
    logo_path: string | null
    omnichannel_enabled: boolean
    advertising_enabled: boolean
  }
}

// SEGURIDAD (M-09): el JWT NO se guarda en el store ni en localStorage. La sesión
// se sostiene con una cookie httpOnly (inaccesible a JavaScript), de modo que un XSS
// no puede robar el token. Solo se persiste el objeto `user` para hidratar la UI.
interface AuthState {
  user: AuthUser | null
  setAuth: (user: AuthUser) => void
  setUser: (user: AuthUser) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setAuth: (user) => set({ user }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null }),
    }),
    {
      name: 'harmony-auth',
      partialize: (state) => ({ user: state.user }),
    }
  )
)
