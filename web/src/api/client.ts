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

/*
 * El Content-Type por defecto de arriba es application/json, y se aplica a TODAS las
 * peticiones. Cuando el cuerpo es un FormData eso rompe el envío: el navegador manda
 * el cuerpo multipart pero declarándolo como JSON, así que el servidor no puede leer
 * ningún campo. Era el motivo de que crear una campaña respondiera "El nombre es
 * requerido" aunque el nombre sí viajara.
 *
 * El resto de pantallas lo sorteaba pasando el header a mano en cada llamada; la de
 * campañas era la única que no lo hacía. Se resuelve acá de una vez: si el cuerpo es
 * FormData se quita el Content-Type para que el navegador ponga el suyo, que incluye
 * el "boundary" que multipart necesita y que a mano no se puede calcular.
 */
api.interceptors.request.use((config) => {
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }
  return config
})

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
