import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import api from '@/api/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detectedCompany, setDetectedCompany] = useState('')
  const [detectingCompany, setDetectingCompany] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cargar config del sistema (logo, nombre)
  const { data: systemConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: async () => {
      const res = await api.get('/system-config')
      return res.data
    },
  })

  // Detecta la empresa del usuario en tiempo real mientras escribe su email
  useEffect(() => {
    setDetectedCompany('')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    if (!isValidEmail) { setDetectingCompany(false); return }
    setDetectingCompany(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/auth/detect-company', { params: { email } })
        setDetectedCompany(data.company_name ?? '')
      } catch {
        setDetectedCompany('')
      } finally {
        setDetectingCompany(false)
      }
    }, 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [email])
  const setAuth = useAuthStore(s => s.setAuth)
  const navigate = useNavigate()
  const location = useLocation()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { email, password, remember })
      // M-09: el token viaja en cookie httpOnly; solo guardamos el user en el store.
      setAuth(data.user)
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/'
      navigate(from, { replace: true })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string } }; message?: string }
      console.error('[Login] error:', axiosErr?.response?.status, axiosErr?.response?.data, axiosErr?.message)
      const msg = axiosErr?.response?.data?.message
      setError(msg ?? `Error ${axiosErr?.response?.status ?? 'de red'}: ${axiosErr?.message ?? 'sin respuesta'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left column: login form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            {systemConfig?.logo_url ? (
              <img
                src={systemConfig.logo_url}
                alt="Logo"
                className="w-16 h-16 rounded-2xl object-cover mb-4 shadow-sm"
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
              Bienvenido a {systemConfig?.app_name || 'Harmony'}
            </h1>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-1 text-center">Iniciar Sesión</h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              Ingresa tus credenciales para acceder a {systemConfig?.app_name || 'Harmony'}
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Correo Electrónico
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                    </svg>
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Ingresa tu correo electrónico"
                    required
                    className="pl-9 pr-4 py-2.5 w-full border border-gray-300 rounded-xl text-sm focus:ring-2 focus:border-transparent focus:outline-none"
                  />
                </div>
                {detectingCompany && (
                  <p className="mt-1.5 text-xs text-gray-400 flex items-center gap-1">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Verificando empresa...
                  </p>
                )}
                {!detectingCompany && detectedCompany && (
                  <p className="mt-1.5 text-xs text-green-600 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    Empresa: <strong>{detectedCompany}</strong>
                  </p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contraseña
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Ingresa tu contraseña"
                    required
                    className="pl-9 pr-4 py-2.5 w-full border border-gray-300 rounded-xl text-sm focus:ring-2 focus:border-transparent focus:outline-none"
                  />
                </div>
              </div>

              {/* Remember + Forgot */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="remember"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="remember" className="text-sm text-gray-600 cursor-pointer">
                    Recordarme en este dispositivo
                  </label>
                </div>
                <a
                  href="/forgot-password"
                  className="text-sm hover:underline"
                  style={{ color: 'var(--color-primary)' }}
                >
                  ¿Olvidaste tu contraseña?
                </a>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl text-white font-medium text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Iniciando...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                    </svg>
                    <span>Iniciar Sesión</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Version */}
        <p className="mt-8 text-center text-xs text-gray-400">v3.0.0</p>
      </div>

      {/* Right column: branding panel */}
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
          {/* Feature: Gestión multiempresa */}
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

          {/* Feature: Seguimiento completo */}
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

          {/* Feature: De multicanal a omnicanal */}
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
