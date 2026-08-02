import { useEffect, useCallback, useState } from 'react'
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
// Callbacks a ejecutar cuando el socket se RE-conecta (no en la primera conexión).
// Mientras estuvo caído se perdieron eventos, así que quien escuche debe recargar.
const reconnectHandlers = new Set<() => void>()
// Suscriptores al estado de la conexión, para el indicador del menú lateral.
const statusListeners = new Set<(connected: boolean) => void>()

let socket: WebSocket | null = null
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let attempts = 0
// Guard sincrónico contra la carrera del await de /auth/ws-ticket (ver connect()).
let connecting = false
// Falso hasta la primera conexión exitosa: distingue "conectar" de "re-conectar".
let everConnected = false

// Prefijo de empresa del usuario actual. Superadmin (sin empresa) usa 0.
function companyPrefix(): string {
  const cid = useAuthStore.getState().user?.company_id ?? 0
  return `company.${cid}.`
}

// Añade el prefijo de empresa salvo que el canal ya venga namespaceado.
function withPrefix(channel: string): string {
  return channel.startsWith('company.') ? channel : companyPrefix() + channel
}

// isConnected refleja si la sesión tiene ahora mismo un canal abierto con el
// servidor: es la señal que respalda el punto de estado del menú lateral.
function isConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN
}

function notifyStatus() {
  const v = isConnected()
  statusListeners.forEach(fn => fn(v))
}

function sendSubscribe(channel: string) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ action: 'subscribe', channel }))
  }
}

async function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  // La petición del ticket es asíncrona y `socket` sigue en null durante el await.
  // Sin este guard, los componentes que llaman a useWebSocket() a la vez (AppLayout,
  // InboxPage, MonitorPage — y el doble montaje de StrictMode en dev) pasaban todos
  // el chequeo de arriba y abrían un socket cada uno: se midieron 4 conexiones y 4
  // tickets por pestaña. Solo la última quedaba en `socket`, así que las suscripciones
  // viajaban por una conexión mientras las otras quedaban huérfanas, y el onclose de
  // cualquiera de ellas inflaba el backoff de reconexión de todas.
  if (connecting) return
  if (!useAuthStore.getState().user) return
  connecting = true
  try {
    const { data } = await api.post<{ ticket: string }>('/auth/ws-ticket')
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?ticket=${data.ticket}`)
    socket = ws

    ws.onopen = () => {
      connecting = false
      attempts = 0
      // (Re)suscribir todos los canales activos tras (re)conectar.
      activeChannels.forEach(sendSubscribe)
      // Los eventos emitidos mientras el socket estuvo caído no se recuperan: avisar
      // a las vistas para que recarguen y no queden mostrando datos viejos.
      if (everConnected) reconnectHandlers.forEach(h => h())
      everConnected = true
      notifyStatus()
    }

    ws.onmessage = (e) => {
      try {
        const raw: unknown = JSON.parse(e.data)
        if (!isValidWSMessage(raw)) return
        const key = `${raw.channel}:${raw.event}`
        handlers.get(key)?.forEach(h => h(raw.data))
      } catch {
        /* mensaje no-JSON: ignorar */
      }
    }

    ws.onclose = () => {
      connecting = false
      // Solo reprogramar si este era el socket vigente; un socket viejo que se cierra
      // no debe disparar reconexiones ni tocar el backoff del que sí está activo.
      if (socket === ws) {
        notifyStatus()
        scheduleReconnect()
      }
    }
    ws.onerror = () => ws.close()
  } catch {
    // Falló la obtención del ticket (p. ej. backend caído): reintentar con backoff.
    connecting = false
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) return // ya hay un reintento programado
  if (!useAuthStore.getState().user) return
  // Backoff exponencial con jitter, tope de 10s. Evita martillar /auth/ws-ticket en un
  // outage, pero con el tope anterior de 30s una caída breve dejaba la bandeja sin
  // tiempo real hasta medio minuto, apoyada solo en el polling de respaldo.
  const delay = Math.min(10000, 1000 * 2 ** attempts) + Math.floor(Math.random() * 500)
  attempts++
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    if (useAuthStore.getState().user) connect()
  }, delay)
}

/*
 * El socket muere en silencio cuando el equipo se suspende, cambia de red o el backend
 * se reinicia (cada deploy). El navegador puede tardar en emitir 'close', y aunque lo
 * emita el backoff haría esperar varios segundos más. Cuando el usuario vuelve a la
 * pestaña o se recupera la red, reconectamos YA, sin backoff: es justo el momento en
 * que espera ver la bandeja al día.
 */
function reconnectNow() {
  if (!useAuthStore.getState().user) return
  if (socket?.readyState === WebSocket.OPEN) return
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
  attempts = 0
  connect()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', reconnectNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectNow()
  })
}

function closeSocket() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
  attempts = 0
  connecting = false
  everConnected = false
  activeChannels.clear()
  if (socket) {
    socket.onclose = null // evitar que el cierre programe una reconexión
    socket.close()
    socket = null
  }
  notifyStatus()
}

/*
 * useConnectionStatus — indica si la sesión está conectada al servidor en este
 * momento.
 *
 * El punto de estado del menú lateral leía `user.is_online` del almacén de sesión,
 * un campo que el backend nunca envió (no está en buildUserResponse): siempre valía
 * undefined y el punto quedaba gris para todo el mundo, sin importar el estado real.
 *
 * Tampoco alcanzaba con agregar ese campo a la respuesta: el usuario se guarda al
 * iniciar sesión y no se vuelve a consultar, así que habría quedado congelado en el
 * valor del login (verde permanente, sin informar nada). Lo que sí es útil y cierto
 * es si la conexión en vivo está activa: cuando se cae, el usuario deja de recibir
 * mensajes al instante y los demás lo ven como desconectado.
 */
export function useConnectionStatus(): boolean {
  const [connected, setConnected] = useState(isConnected)
  useEffect(() => {
    statusListeners.add(setConnected)
    setConnected(isConnected()) // sincronizar por si cambió antes de suscribirse
    return () => { statusListeners.delete(setConnected) }
  }, [])
  return connected
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

  /*
   * onReconnect — se ejecuta cuando el socket vuelve tras haberse caído (no en la
   * primera conexión). Las suscripciones se restablecen solas, pero los eventos que
   * ocurrieron durante la caída se perdieron para siempre: quien escuche acá debe
   * recargar sus datos para no quedar mostrando una bandeja desactualizada.
   */
  const onReconnect = useCallback((handler: () => void) => {
    reconnectHandlers.add(handler)
    return () => { reconnectHandlers.delete(handler) }
  }, [])

  const send = useCallback((data: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data))
  }, [])

  return { subscribe, onReconnect, send }
}
