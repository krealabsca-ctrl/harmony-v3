import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Mail, Server, User, Lock, Send, Loader2, CheckCircle, XCircle, ShieldCheck, Save } from 'lucide-react'
import api from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmtpSettings {
  host: string
  port: number | string
  username: string
  password: string
  from_address: string
  from_name: string
  encryption: 'tls' | 'ssl' | 'none'
}

interface PasswordResetTemplate {
  subject: string
  body: string
}

const RESET_VARS = ['{nombre}', '{enlace}', '{sistema}']
const RESET_DEMO: Record<string, string> = {
  '{nombre}': 'Juan Perez',
  '{enlace}': 'https://tudominio.com/reset/abc123',
  '{sistema}': 'Harmony',
}

interface TestResult {
  success: boolean
  message: string
}

// ─── SmtpSettingsPage ─────────────────────────────────────────────────────────

export default function SmtpSettingsPage() {
  const [form, setForm] = useState<SmtpSettings>({
    host: '',
    port: 587,
    username: '',
    password: '',
    from_address: '',
    from_name: '',
    encryption: 'tls',
  })
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const [resetTemplate, setResetTemplate] = useState<PasswordResetTemplate>({
    subject: 'Restablecer contrasena',
    body: 'Hola {nombre},\n\nRecibimos una solicitud para restablecer la contrasena de tu cuenta en {sistema}.\n\nHaz clic en el siguiente enlace para crear una nueva contrasena:\n{enlace}\n\nSi no solicitaste este cambio, ignora este mensaje.',
  })
  const [savingReset, setSavingReset] = useState(false)

  // ── Load settings ──────────────────────────────────────────────────────────

  const { data: smtpData, isLoading } = useQuery<SmtpSettings>({
    queryKey: ['smtp-settings'],
    queryFn: async () => {
      const { data } = await api.get<SmtpSettings>('/settings/smtp')
      return data
    },
  })

  // Load password reset template
  const { data: resetData } = useQuery<PasswordResetTemplate>({
    queryKey: ['smtp-reset-template'],
    queryFn: async () => {
      const { data } = await api.get<PasswordResetTemplate>('/settings/smtp/reset-template')
      return data
    },
  })

  useEffect(() => {
    if (smtpData) {
      setForm({
        host: smtpData.host ?? '',
        port: smtpData.port ?? 587,
        username: smtpData.username ?? '',
        password: smtpData.password ?? '',
        from_address: smtpData.from_address ?? '',
        from_name: smtpData.from_name ?? '',
        encryption: smtpData.encryption ?? 'tls',
      })
    }
  }, [smtpData])

  useEffect(() => {
    if (resetData) {
      setResetTemplate({
        subject: resetData.subject ?? '',
        body: resetData.body ?? '',
      })
    }
  }, [resetData])

  // ── Save mutation ──────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: () => api.put('/settings/smtp', form),
    onSuccess: () => {
      toast.success('Configuración SMTP guardada correctamente')
    },
    onError: () => {
      toast.error('Error al guardar la configuración SMTP')
    },
  })

  // ── Test mutation ──────────────────────────────────────────────────────────

  const testMutation = useMutation({
    mutationFn: () => api.post<TestResult>('/settings/smtp/test', form),
    onSuccess: ({ data }) => {
      setTestResult(data)
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.message ?? 'No se pudo conectar al servidor SMTP'
      setTestResult({ success: false, message })
    },
  })

  // ── Save reset template ────────────────────────────────────────────────────

  const handleSaveResetTemplate = async () => {
    if (!resetTemplate.body.includes('{enlace}')) {
      toast.error('El cuerpo del correo debe incluir la variable {enlace}')
      return
    }
    setSavingReset(true)
    try {
      await api.put('/settings/smtp/reset-template', resetTemplate)
      toast.success('Correo de recuperacion guardado')
    } catch {
      toast.error('Error al guardar el correo de recuperacion')
    } finally {
      setSavingReset(false)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    if (testResult) setTestResult(null)
  }

  function handleToggleEncryption() {
    setForm((prev) => ({
      ...prev,
      encryption: prev.encryption === 'none' ? 'tls' : 'none',
    }))
    if (testResult) setTestResult(null)
  }

  const isBusy = saveMutation.isPending || testMutation.isPending
  const encryptionEnabled = form.encryption !== 'none'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Configuración SMTP</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-1">
          Configura el servidor de correo saliente para notificaciones y alertas del sistema.
        </p>
      </div>

      {/* Card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {/* Card header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <Mail className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Servidor SMTP</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">Credenciales de conexión</p>
          </div>
        </div>

        {/* Form */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400 dark:text-gray-500" />
          </div>
        ) : (
          <div className="px-6 py-6 space-y-5">

            {/* Host + Port */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-1.5">
                  Host SMTP
                </label>
                <div className="relative">
                  <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                  <input
                    type="text"
                    name="host"
                    value={form.host}
                    onChange={handleChange}
                    placeholder="smtp.ejemplo.com"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent"
                    style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-1.5">
                  Puerto
                </label>
                <input
                  type="number"
                  name="port"
                  value={form.port}
                  onChange={handleChange}
                  placeholder="587"
                  min={1}
                  max={65535}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent font-variant-numeric tabular-nums"
                  style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                />
              </div>
            </div>

            {/* Username */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-1.5">
                Usuario SMTP
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                <input
                  type="text"
                  name="username"
                  value={form.username}
                  onChange={handleChange}
                  placeholder="usuario@ejemplo.com"
                  autoComplete="username"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent"
                  style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent"
                  style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                />
              </div>
            </div>

            {/* From address + From name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-1.5">
                  Correo remitente
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                  <input
                    type="email"
                    name="from_address"
                    value={form.from_address}
                    onChange={handleChange}
                    placeholder="noreply@tuempresa.com"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent"
                    style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-1.5">
                  Nombre remitente
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                  <input
                    type="text"
                    name="from_name"
                    value={form.from_name}
                    onChange={handleChange}
                    placeholder="Harmony"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent"
                    style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
                  />
                </div>
              </div>
            </div>

            {/* Encryption toggle */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Cifrado SSL/TLS</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Activa si tu servidor requiere conexión segura
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleEncryption}
                aria-pressed={encryptionEnabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                  encryptionEnabled ? 'bg-green-500' : 'bg-gray-200'
                }`}
              >
                <span className="sr-only">Activar cifrado</span>
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-800 shadow transition-transform ${
                    encryptionEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Encryption type selector — visible when enabled */}
            {encryptionEnabled && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-1.5">
                  Tipo de cifrado
                </label>
                <select
                  name="encryption"
                  value={form.encryption}
                  onChange={handleChange}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none bg-white dark:bg-gray-800"
                >
                  <option value="tls">TLS (recomendado)</option>
                  <option value="ssl">SSL</option>
                </select>
              </div>
            )}

            {/* Test result alert */}
            {testResult && (
              <div
                role="alert"
                className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${
                  testResult.success
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => saveMutation.mutate()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {saveMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Guardar
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setTestResult(null)
                  testMutation.mutate()
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {testMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Probar conexión
              </button>
            </div>

          </div>
        )}
      </div>

      {/* ── Password recovery email section ── */}
      <div className="mt-8 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {/* Section header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <Send className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Correo de recuperacion de contrasena</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">Personaliza el mensaje que reciben los usuarios al solicitar restablecer su contrasena</p>
          </div>
        </div>

        <div className="px-6 py-6 space-y-5">
          {/* Variables hint */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Variables disponibles:{' '}
            {RESET_VARS.map(v => (
              <code key={v} className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs mx-0.5">{v}</code>
            ))}
          </p>

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              Asunto del correo
            </label>
            <input
              type="text"
              value={resetTemplate.subject}
              onChange={e => setResetTemplate(p => ({ ...p, subject: e.target.value }))}
              placeholder="Restablecer contrasena"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
              style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              Cuerpo del mensaje
            </label>
            <textarea
              rows={10}
              value={resetTemplate.body}
              onChange={e => setResetTemplate(p => ({ ...p, body: e.target.value }))}
              placeholder="Hola {nombre}, ..."
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent resize-y dark:bg-gray-700 dark:text-gray-100"
              style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Solo texto plano. El campo <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{'{enlace}'}</code> es obligatorio.
            </p>
          </div>

          {/* Preview */}
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-800 rounded-xl p-4 space-y-1">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">Vista previa con variables resueltas:</p>
            <p className="text-xs text-blue-600 dark:text-blue-400 font-mono whitespace-pre-wrap break-words leading-relaxed">
              {Object.entries(RESET_DEMO).reduce(
                (text, [key, val]) => text.replaceAll(key, val),
                resetTemplate.body
              )}
            </p>
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={savingReset}
              onClick={handleSaveResetTemplate}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {savingReset ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Guardar correo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
