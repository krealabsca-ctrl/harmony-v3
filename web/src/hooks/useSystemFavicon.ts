import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/client'
import { useAuthStore } from '@/stores/authStore'

interface SystemConfig {
  app_name: string
  favicon_url: string
  logo_url?: string
  primary_color?: string
  secondary_color?: string
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

export function useSystemFavicon() {
  // Los colores propios de la empresa (si el usuario pertenece a una) tienen prioridad
  // sobre los colores globales del sistema; ver useCompanyTheme.
  const company = useAuthStore(s => s.user?.company)

  const { data } = useQuery<SystemConfig>({
    queryKey: ['system-config'],
    queryFn: () => api.get('/system-config').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!data) return

    if (data.favicon_url) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.href = data.favicon_url + '?t=' + Date.now()
    }

    if (data.app_name) {
      document.title = data.app_name
    }

    // Aplicar la paleta global solo si el usuario no tiene una empresa con colores propios
    // (así el tema de la empresa no queda pisado por el del sistema).
    const hasCompanyColors = !!company?.primary_color
    if (!hasCompanyColors) {
      const root = document.documentElement
      if (data.primary_color && HEX_COLOR.test(data.primary_color)) {
        root.style.setProperty('--color-primary', data.primary_color)
      }
      if (data.secondary_color && HEX_COLOR.test(data.secondary_color)) {
        root.style.setProperty('--color-secondary', data.secondary_color)
      }
    }
  }, [data, company?.primary_color])
}
