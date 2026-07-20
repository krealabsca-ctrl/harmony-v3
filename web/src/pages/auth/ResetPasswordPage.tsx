import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import api from '@/api/client'
import AuthLayout from '@/components/layout/AuthLayout'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''
  const email = searchParams.get('email') ?? ''

  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => navigate('/login', { replace: true }), 3000)
      return () => clearTimeout(timer)
    }
  }, [success, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== passwordConfirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/reset-password', {
        token,
        email,
        password,
        password_confirmation: passwordConfirmation,
      })
      setSuccess(true)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string }; status?: number }; message?: string }
      const msg = axiosErr?.response?.data?.message
      setError(msg ?? `Error ${axiosErr?.response?.status ?? 'de red'}: ${axiosErr?.message ?? 'sin respuesta'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {success ? (
            <div className="flex flex-col items-center text-center py-2">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                ¡Contraseña restablecida!
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Tu contraseña ha sido actualizada correctamente. Serás redirigido al inicio de sesión en unos segundos.
              </p>
              <Link to="/login" className="text-sm hover:underline" style={{ color: 'var(--color-primary)' }}>
                ← Ir al inicio de sesión ahora
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">Restablecer Contraseña</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Ingresa tu nueva contraseña.</p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nueva Contraseña
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                    placeholder="Mínimo 8 caracteres"
                    required
                  />
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Usa al menos 8 caracteres.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Confirmar Contraseña
                  </label>
                  <input
                    type="password"
                    value={passwordConfirmation}
                    onChange={e => setPasswordConfirmation(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                    placeholder="Repite tu contraseña"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {loading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      Procesando...
                    </>
                  ) : (
                    'Restablecer Contraseña'
                  )}
                </button>
              </form>

              <div className="mt-4 text-center">
                <Link to="/login" className="text-sm text-gray-500 dark:text-gray-400 hover:underline">
                  ← Volver al inicio de sesión
                </Link>
              </div>
            </>
          )}
        </div>
    </AuthLayout>
  )
}
