import axios from 'axios'
import { useAuthStore } from '@/stores/authStore'

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
  withCredentials: true,
})

// M-09: no se adjunta header Authorization. La autenticación viaja en la cookie
// httpOnly (withCredentials: true), inaccesible a JavaScript.

let redirecting = false

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const url: string = error.config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/forgot') || url.includes('/auth/reset')
    // M-11: guarda para no disparar N redirects en ráfaga cuando varias queries fallan con 401.
    if (error.response?.status === 401 && !isAuthEndpoint && !redirecting) {
      redirecting = true
      useAuthStore.getState().logout()
      window.location.href = '/login' // la recarga completa limpia la caché de react-query
    }
    return Promise.reject(error)
  }
)

export default api
