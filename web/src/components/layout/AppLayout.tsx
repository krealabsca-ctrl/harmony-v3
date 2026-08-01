import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import api from '@/api/client'
import { useCompanyTheme } from '@/hooks/useCompanyTheme'
import { useWebSocket } from '@/hooks/useWebSocket'

export default function AppLayout() {
  useCompanyTheme()
  // #12: la barra lateral es un drawer en móvil. En >=md queda fija (md:static).
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { subscribe, onReconnect } = useWebSocket()

  useEffect(() => {
    const id = setInterval(() => {
      api.post("/heartbeat").catch(() => {})
    }, 60000)
    return () => clearInterval(id)
  }, [])

  /*
   * Notificación de mensajes nuevos en el título de la pestaña del navegador.
   * Antes vivía dentro de InboxPage.tsx y desaparecía apenas se navegaba a
   * cualquier otra sección (Campañas, Reportes, etc.) porque ese componente se
   * desmontaba. Vive acá porque AppLayout permanece montado en TODA la sesión
   * autenticada — así el aviso se ve sin importar en qué pantalla esté el agente.
   * Endpoint liviano (un solo COUNT, sin traer conversaciones) + WS 'inbox' para
   * refrescar al instante cuando llega un mensaje; el polling de 20s es solo
   * respaldo por si se pierde algún evento (ej. reconexión del socket).
   */
  const { data: unreadData, refetch: refetchUnread } = useQuery<{ unread: number }>({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/conversations/unread-count').then(r => r.data),
    refetchInterval: 20000,
  })

  useEffect(() => {
    const unsub = subscribe('inbox', 'MessageReceived', () => refetchUnread())
    return unsub
  }, [subscribe, refetchUnread])

  // Al reconectar el socket se perdieron los avisos de la caída: recontar de una.
  useEffect(() => onReconnect(() => refetchUnread()), [onReconnect, refetchUnread])

  useEffect(() => {
    const unread = unreadData?.unread ?? 0
    document.title = unread > 0 ? `(${unread}) Harmony` : 'Harmony'
  }, [unreadData?.unread])

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
