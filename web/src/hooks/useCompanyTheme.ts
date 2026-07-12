import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'

// Solo se aceptan colores hex (#rgb / #rrggbb / #rrggbbaa). El objeto `user` se
// persiste en localStorage y es manipulable; validar el color evita inyección CSS
// (p. ej. `url(...)` en el valor de una variable) — hallazgo #5 de la ronda 3.
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

export function useCompanyTheme() {
  const company = useAuthStore(s => s.user?.company)
  useEffect(() => {
    if (!company) return
    const root = document.documentElement
    if (company.primary_color && HEX_COLOR.test(company.primary_color)) {
      root.style.setProperty('--color-primary', company.primary_color)
    }
    if (company.secondary_color && HEX_COLOR.test(company.secondary_color)) {
      root.style.setProperty('--color-secondary', company.secondary_color)
    }
  }, [company?.primary_color, company?.secondary_color])
}
