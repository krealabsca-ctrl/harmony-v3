import { useQuery } from '@tanstack/react-query'
import api from '@/api/client'

// AuthLayout replica el diseño de dos columnas del login (formulario a la izquierda con el
// logo/nombre del sistema, panel de marca a la derecha) para reutilizarlo en las pantallas
// de recuperación y restablecimiento de contraseña.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { data: systemConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: async () => {
      const res = await api.get('/system-config')
      return res.data as { app_name?: string; logo_url?: string }
    },
  })

  return (
    <div className="min-h-screen flex">
      {/* Columna izquierda: contenido (formulario) */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Logo + nombre del sistema */}
          <div className="flex flex-col items-center mb-8">
            {systemConfig?.logo_url ? (
              <img
                src={systemConfig.logo_url}
                alt="Logo"
                className="w-16 h-16 rounded-2xl object-contain mb-4 shadow-sm"
              />
            ) : (
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 text-white text-2xl font-bold"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                H
              </div>
            )}
            <h1 className="text-2xl font-bold text-gray-900">
              {systemConfig?.app_name || 'Harmony'}
            </h1>
          </div>

          {children}
        </div>

        <p className="mt-8 text-center text-xs text-gray-400">v3.0.0</p>
      </div>

      {/* Columna derecha: panel de marca */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center px-12 text-white"
        style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)' }}
      >
        <div className="max-w-md text-center mb-12">
          <h2 className="text-4xl font-bold mb-4">Gestión Ágil Omnicanal</h2>
          <p className="text-lg text-white/80">
            Gestione y Optimice las comunicaciones con sus clientes y prospectos en un solo lugar
          </p>
        </div>

        <div className="w-full max-w-md space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500 flex-shrink-0 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-lg">Gestión multiempresa</h3>
              <p className="text-white/70 text-sm">Gestión multiempresa y multidepartamento</p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-500 flex-shrink-0 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-lg">Seguimiento completo</h3>
              <p className="text-white/70 text-sm">
                Trazabilidad en todo el ciclo del proceso. Calendarización de tareas y visualización de funnels
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-orange-500 flex-shrink-0 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-lg">De multicanal a omnicanal</h3>
              <p className="text-white/70 text-sm">
                Gestione todo el proceso de comunicación desde múltiples canales en un solo lugar
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
