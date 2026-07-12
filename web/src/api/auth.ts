import api from './client'
import type { AuthUser } from '@/stores/authStore'

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password }),

  logout: () => api.post('/auth/logout'),

  me: () => api.get<AuthUser>('/auth/me'),

  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),

  resetPassword: (token: string, email: string, password: string) =>
    api.post('/auth/reset-password', { token, email, password }),
}
