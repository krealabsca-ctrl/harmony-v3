import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/client'

interface SystemConfig {
  app_name: string
  favicon_url: string
}

export function useSystemFavicon() {
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
  }, [data])
}
