import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Mail, Send } from 'lucide-react'
import api from '@/api/client'

interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from_name: string
  from_email: string
  encryption: string
}

interface RetentionTemplate {
  subject: string
  body_html: string
}

export default function SystemEmailPage() {
  const [smtpForm, setSmtpForm] = useState<SmtpConfig>({
    host: '',
    port: 587,
    user: '',
    pass: '',
    from_name: '',
    from_email: '',
    encryption: 'starttls',
  })

  const [templateForm, setTemplateForm] = useState<RetentionTemplate>({
    subject: '',
    body_html: '',
  })

  const [testEmail, setTestEmail] = useState('')
  const [showTestModal, setShowTestModal] = useState(false)

  // Obtener configuración SMTP
  const { data: smtpData, isLoading: smtpLoading } = useQuery({
    queryKey: ['system-smtp'],
    queryFn: async () => {
      const res = await api.get('/admin/system-settings/smtp')
      return res.data?.data || {}
    },
  })

  // Obtener plantilla de retención
  const { data: templateData, isLoading: templateLoading } = useQuery({
    queryKey: ['retention-template'],
    queryFn: async () => {
      const res = await api.get('/admin/system-settings/retention-template')
      return res.data?.data || {}
    },
  })

  // Cargar SMTP cuando se obtiene
  useEffect(() => {
    if (smtpData) {
      setSmtpForm(smtpData as SmtpConfig)
    }
  }, [smtpData])

  // Cargar plantilla cuando se obtiene
  useEffect(() => {
    if (templateData) {
      setTemplateForm(templateData as RetentionTemplate)
    }
  }, [templateData])

  // Guardar SMTP
  const saveSMTPMutation = useMutation({
    mutationFn: (data: SmtpConfig) => api.put('/admin/system-settings/smtp', data),
    onSuccess: () => {
      toast.success('Configuración SMTP guardada')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al guardar SMTP')
    },
  })

  // Guardar plantilla
  const saveTemplateMutation = useMutation({
    mutationFn: (data: RetentionTemplate) =>
      api.put('/admin/system-settings/retention-template', data),
    onSuccess: () => {
      toast.success('Plantilla guardada')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.errors || 'Error al guardar plantilla')
    },
  })

  // Enviar correo de prueba
  const testSendMutation = useMutation({
    mutationFn: (email: string) => api.post('/admin/system-settings/smtp/test', { email }),
    onSuccess: () => {
      toast.success('Correo de prueba enviado')
      setShowTestModal(false)
      setTestEmail('')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al enviar correo de prueba')
    },
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Mail className="w-6 h-6" />
          Correo del Sistema
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Configuración SMTP y plantillas de notificaciones
        </p>
      </div>

      {/* SMTP Configuration */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Configuración SMTP
        </h2>

        {smtpLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-xl" />
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-xl" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Servidor SMTP (Host)
                </label>
                <input
                  type="text"
                  value={smtpForm.host}
                  onChange={(e) => setSmtpForm({ ...smtpForm, host: e.target.value })}
                  placeholder="smtp.gmail.com"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Puerto
                </label>
                <input
                  type="number"
                  value={smtpForm.port}
                  onChange={(e) => setSmtpForm({ ...smtpForm, port: parseInt(e.target.value) })}
                  placeholder="587"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Usuario
                </label>
                <input
                  type="text"
                  value={smtpForm.user}
                  onChange={(e) => setSmtpForm({ ...smtpForm, user: e.target.value })}
                  placeholder="tu-email@gmail.com"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Contraseña
                </label>
                <input
                  type="password"
                  value={smtpForm.pass}
                  onChange={(e) => setSmtpForm({ ...smtpForm, pass: e.target.value })}
                  placeholder="••••••••"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Nombre del remitente
                </label>
                <input
                  type="text"
                  value={smtpForm.from_name}
                  onChange={(e) => setSmtpForm({ ...smtpForm, from_name: e.target.value })}
                  placeholder="Harmony Notificaciones"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Correo del remitente
                </label>
                <input
                  type="email"
                  value={smtpForm.from_email}
                  onChange={(e) => setSmtpForm({ ...smtpForm, from_email: e.target.value })}
                  placeholder="noreply@empresa.com"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Cifrado
              </label>
              <select
                value={smtpForm.encryption}
                onChange={(e) => setSmtpForm({ ...smtpForm, encryption: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="none">Sin cifrado (Puerto 25)</option>
                <option value="starttls">STARTTLS (Puerto 587)</option>
                <option value="tls">TLS implícito (Puerto 465)</option>
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => saveSMTPMutation.mutate(smtpForm)}
                disabled={saveSMTPMutation.isPending}
                className="flex-1 py-2.5 text-sm font-medium text-white rounded-xl shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {saveSMTPMutation.isPending ? 'Guardando...' : 'Guardar configuración'}
              </button>
              <button
                onClick={() => setShowTestModal(true)}
                disabled={testSendMutation.isPending || !smtpForm.host}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
              >
                <Send className="w-4 h-4" />
                Enviar prueba
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Retention Template */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Plantilla de Aviso de Retención
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Variables disponibles: <code className="font-mono">{'{{empresa}}'}</code>,{' '}
          <code className="font-mono">{'{{encargado}}'}</code>,{' '}
          <code className="font-mono">{'{{dias}}'}</code>,{' '}
          <code className="font-mono">{'{{fecha_limite}}'}</code>,{' '}
          <code className="font-mono">{'{{fecha_eliminacion}}'}</code>
        </p>

        {templateLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-xl" />
            <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Asunto
              </label>
              <input
                type="text"
                value={templateForm.subject}
                onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })}
                placeholder="Tu información será eliminada — {{empresa}}"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Cuerpo (HTML)
              </label>
              <textarea
                value={templateForm.body_html}
                onChange={(e) => setTemplateForm({ ...templateForm, body_html: e.target.value })}
                placeholder="<p>Hola {{encargado}},...</p>"
                rows={8}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <button
              onClick={() => saveTemplateMutation.mutate(templateForm)}
              disabled={saveTemplateMutation.isPending}
              className="py-2.5 px-6 text-sm font-medium text-white rounded-xl shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {saveTemplateMutation.isPending ? 'Guardando...' : 'Guardar plantilla'}
            </button>
          </div>
        )}
      </div>

      {/* Test Modal */}
      {showTestModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-4">
              Enviar correo de prueba
            </h3>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowTestModal(false)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => testSendMutation.mutate(testEmail)}
                disabled={testSendMutation.isPending || !testEmail}
                className="flex-1 py-2.5 text-sm font-medium text-white rounded-xl shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {testSendMutation.isPending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
