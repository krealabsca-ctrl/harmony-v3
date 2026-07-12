import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import api from '@/api/client'
import { useCompanyTheme } from '@/hooks/useCompanyTheme'

export default function AppLayout() {
  useCompanyTheme()
  // #12: la barra lateral es un drawer en móvil. En >=md queda fija (md:static).
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      api.post("/heartbeat").catch(() => {})
    }, 60000)
    return () => clearInterval(id)
  }, [])

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
