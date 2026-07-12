import { useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'
import api from '@/api/client'

/**
 * useWebSocket — cliente WebSocket singleton a nivel de módulo.
 *
 * Flujo de conexión:
 *  1. Se pide un ticket de un solo uso a POST /auth/ws-ticket (autenticado por cookie).
 *  2. Se abre /ws?ticket=... (el ticket expira en 30s y solo sirve una vez).
 *  3. Al abrir, se (re)envían las suscripciones activas al servidor.
 *
 * SEGURIDAD (C-01): todos los canales se namespacean con `company.{id}.` — el prefijo
 * de la empresa del usuario autenticado. El servidor rechaza suscripciones a canales de
 * otra empresa, evitando fugas de datos entre tenants.
 *
 * Reconexión (M-10): backoff exponencial con jitter; la reconexión vive a nivel de módulo
 * (no se cancela al desmontar un componente) y el socket se cierra al hacer logout.
 */

type WSMessage = { event: string; channel: string; data: unknown }
type Handler = (data: unknown) => void

const handlers = new Map<string, Set<Handler>>()
// Canales (ya prefijados) a los que hay que (re)suscribirse en cada (re)conexión.
const activeChannels = new Set<string>()

let socket: WebSocket | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let attempts = 0

// Prefijo de empresa del usuario actual. Superadmin (sin empresa) usa 0.
function companyPrefix(): string {
  const cid = useAuthStore.getState().user?.company_id ?? 0
  return `company.${cid}.`
}

// Añade el prefijo de empresa salvo que el canal ya venga namespaceado.
function withPrefix(channel: string): string {
  return channel.startsWith('company.') ? channel : companyPrefix() + channel
}

function sendSubscribe(channel: string) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ action: 'subscribe', channel }))
  }
}

async function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  if (!useAuthStore.getState().user) return
  try {
    const { data } = await api.post<{ ticket: string }>('/auth/ws-ticket')
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(`${proto}://${window.location.host}/ws?ticket=${data.ticket}`)

    socket.onopen = () => {
      attempts = 0
      // (Re)suscribir todos los canales activos tras (re)conectar.
      activeChannels.forEach(sendSubscribe)
    }

    socket.onmessage = (e) => {
      try {
        const raw: unknown = JSON.parse(e.data)
        if (!isValidWSMessage(raw)) return
        const key = `${raw.channel}:${raw.event}`
        handlers.get(key)?.forEach(h => h(raw.data))
      } catch {
        /* mensaje no-JSON: ignorar */
      }
    }

    socket.onclose = scheduleReconnect
    socket.onerror = () => socket?.close()
  } catch {
    // Falló la obtención del ticket (p. ej. backend caído): reintentar con backoff.
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) return // ya hay un reintento programado
  if (!useAuthStore.getState().user) return
  // Backoff exponencial con jitter, tope de 30s. Evita martillar /auth/ws-ticket en un outage.
  const delay = Math.min(30000, 1000 * 2 ** attempts) + Math.floor(Math.random() * 500)
  attempts++
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    if (useAuthStore.getState().user) connect()
  }, delay)
}

function closeSocket() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
  attempts = 0
  activeChannels.clear()
  if (socket) {
    socket.onclose = null // evitar que el cierre programe una reconexión
    socket.close()
    socket = null
  }
}

// M-10: cerrar el socket cuando el usuario cierra sesión (user → null).
useAuthStore.subscribe((state, prev) => {
  if (prev.user && !state.user) closeSocket()
})

function isValidWSMessage(raw: unknown): raw is WSMessage {
  if (typeof raw !== 'object' || raw === null) return false
  const msg = raw as Record<string, unknown>
  return typeof msg.event === 'string' && typeof msg.channel === 'string'
}

export function useWebSocket() {
  const user = useAuthStore(s => s.user)

  useEffect(() => {
    if (user) connect()
    // Nota (M-10): NO se cancela la reconexión al desmontar el componente; el socket es
    // un singleton compartido por toda la app y su ciclo de vida lo controla el logout.
  }, [user])

  const subscribe = useCallback((channel: string, event: string, handler: Handler) => {
    const ch = withPrefix(channel)
    const key = `${ch}:${event}`
    if (!handlers.has(key)) handlers.set(key, new Set())
    handlers.get(key)!.add(handler)

    // Suscribir el canal en el servidor la primera vez que se usa.
    if (!activeChannels.has(ch)) {
      activeChannels.add(ch)
      sendSubscribe(ch)
    }

    return () => {
      handlers.get(key)?.delete(handler)
      if (handlers.get(key)?.size === 0) handlers.delete(key)
      // Si ningún handler sigue interesado en este canal, dejar de rastrearlo.
      const stillUsed = [...handlers.keys()].some(k => k.startsWith(`${ch}:`))
      if (!stillUsed) {
        activeChannels.delete(ch)
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ action: 'unsubscribe', channel: ch }))
        }
      }
    }
  }, [])

  const send = useCallback((data: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data))
  }, [])

  return { subscribe, send }
}
