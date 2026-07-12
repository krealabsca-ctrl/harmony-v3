import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import api from '@/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PubSettings {
  approval_required: boolean
  approval_phone: string
  lead_threshold: number
  lead_whatsapp_numbers: string
  lead_keywords: string
  has_openai_key: boolean
  openai_api_key_masked: string
  image_style: string
  wa_channel_id: number | null
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PubSettingsPage() {
  const [approvalRequired, setApprovalRequired] = useState(true)
  const [approvalPhone, setApprovalPhone] = useState('')
  const [leadThreshold, setLeadThreshold] = useState(70)
  const [leadWhatsappNumbers, setLeadWhatsappNumbers] = useState('')
  const [leadKeywords, setLeadKeywords] = useState('')
  const [newOpenAIKey, setNewOpenAIKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [hasOpenAIKey, setHasOpenAIKey] = useState(false)
  const [maskedKey, setMaskedKey] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const { data } = useQuery<PubSettings>({
    queryKey: ['pub-settings'],
    queryFn: () => api.get('/pub/settings').then(r => r.data),
  })

  useEffect(() => {
    if (!data) return
    setApprovalRequired(data.approval_required ?? true)
    setApprovalPhone(data.approval_phone ?? '')
    setLeadThreshold(data.lead_threshold ?? 70)
    setLeadWhatsappNumbers(data.lead_whatsapp_numbers ?? '')
    setLeadKeywords(data.lead_keywords ?? '')
    setHasOpenAIKey(data.has_openai_key ?? false)
    setMaskedKey(data.openai_api_key_masked ?? '')
  }, [data])

  const saveMutation = useMutation({
    mutationFn: (payload: object) => api.put('/pub/settings', payload),
    onSuccess: () => {
      setSavedMessage('Configuración guardada correctamente.')
      setErrorMessage('')
      if (newOpenAIKey) {
        setHasOpenAIKey(true)
        setMaskedKey(newOpenAIKey.slice(0, 4) + '****' + newOpenAIKey.slice(-4))
        setNewOpenAIKey('')
      }
      setTimeout(() => setSavedMessage(''), 4000)
    },
    onError: () => {
      setErrorMessage('Ocurrió un error al guardar. Inténtalo de nuevo.')
      setSavedMessage('')
    },
  })

  const handleSave = () => {
    setErrorMessage('')
    setSavedMessage('')

    if (approvalRequired && !approvalPhone.trim()) {
      setErrorMessage('Ingresa el número de WhatsApp para aprobaciones.')
      return
    }

    const payload: Record<string, unknown> = {
      approval_required: approvalRequired,
      approval_phone: approvalPhone.trim(),
      lead_threshold: leadThreshold,
      lead_whatsapp_numbers: leadWhatsappNumbers.trim(),
      lead_keywords: leadKeywords.trim(),
    }
    if (newOpenAIKey.trim()) {
      payload.openai_api_key = newOpenAIKey.trim()
    }

    saveMutation.mutate(payload)
  }

  const leadLabel =
    leadThreshold >= 80 ? 'Alto interés' :
    leadThreshold >= 50 ? 'Interés moderado' :
    'Bajo interés'

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Configuración de Publicidad</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">Ajusta el comportamiento del módulo de IA para publicaciones.</p>
      </div>

      {/* Feedback */}
      {savedMessage && (
        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-400 text-sm">
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
          </svg>
          {savedMessage}
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
          </svg>
          {errorMessage}
        </div>
      )}

      {/* ── Sección 1: Flujo de aprobación ── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        <div className="px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400 text-sm">📲</span>
            Aprobación de publicaciones
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Decide si la IA necesita aprobación antes de publicar en redes sociales.</p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Toggle aprobación */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Requerir aprobación antes de publicar</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {approvalRequired
                  ? 'La IA enviará la vista previa por WhatsApp y esperará tu "aprobado".'
                  : 'La IA publicará directamente sin pedir confirmación.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setApprovalRequired(v => !v)}
              style={{ background: approvalRequired ? '#f59e0b' : '#D1D5DB' }}
              className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${approvalRequired ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Número WhatsApp aprobaciones */}
          {approvalRequired && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Número de WhatsApp para aprobaciones <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 text-sm">+</span>
                <input
                  type="text"
                  value={approvalPhone}
                  onChange={e => setApprovalPhone(e.target.value)}
                  placeholder="50688951234"
                  className="w-full pl-7 pr-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Sin el símbolo +. Ej: 50688951234. La IA enviará aquí la vista previa del post.</p>
            </div>
          )}

          {/* Info box */}
          <div className={`rounded-lg p-3 text-xs border ${approvalRequired
            ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
            : 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800'}`}>
            {approvalRequired
              ? <><strong>Flujo con aprobación:</strong> IA genera → envía por WhatsApp → aprobador responde <strong>aprobado</strong> → IA publica · o responde con cambios → IA regenera y reenvía.</>
              : <><strong>Flujo automático:</strong> IA genera → publica directamente en todas las redes configuradas. Recomendado solo cuando el contenido ya esté bien calibrado.</>}
          </div>
        </div>
      </div>

      {/* ── Sección 2: Detección de leads ── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        <div className="px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-green-600 dark:text-green-400 text-sm">🎯</span>
            Detección de leads calientes
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">La IA analiza comentarios y notifica cuando detecta alguien con alta intención de compra.</p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Umbral */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Umbral mínimo de score para notificar{' '}
              <span className="ml-1 font-bold text-indigo-600 dark:text-indigo-400">{leadThreshold}/100</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={leadThreshold}
              onChange={e => setLeadThreshold(Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
              <span>0 — Todos</span>
              <span className="text-indigo-600 dark:text-indigo-400 font-medium">{leadLabel}</span>
              <span>100 — Muy calificados</span>
            </div>
          </div>

          {/* Números de notificación */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Números de WhatsApp para notificaciones de leads
            </label>
            <input
              type="text"
              value={leadWhatsappNumbers}
              onChange={e => setLeadWhatsappNumbers(e.target.value)}
              placeholder="50688951234, 50699887766"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Separa múltiples números con coma. Sin el símbolo +.</p>
          </div>

          {/* Keywords */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Palabras clave de intención de compra
            </label>
            <input
              type="text"
              value={leadKeywords}
              onChange={e => setLeadKeywords(e.target.value)}
              placeholder="precio, cuánto cuesta, disponible, quiero comprar"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Separa con coma. La IA las considera como señales adicionales de interés.</p>
          </div>
        </div>
      </div>

      {/* ── Sección 3: Claves de API ── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        <div className="px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-400 text-sm">🔑</span>
            Claves de API
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Necesarias para la generación de imágenes con DALL-E 3.</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* OpenAI */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Clave de OpenAI (para DALL-E 3)
            </label>

            {hasOpenAIKey && !newOpenAIKey && (
              <div className="flex items-center gap-2 mb-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                </svg>
                Clave configurada: <span className="font-mono">{maskedKey}</span>
              </div>
            )}

            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={newOpenAIKey}
                onChange={e => setNewOpenAIKey(e.target.value)}
                placeholder={hasOpenAIKey ? 'Ingresa una nueva clave para reemplazar la actual' : 'sk-...'}
                className="w-full pr-10 pl-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(v => !v)}
                className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Obtén tu clave en <span className="font-mono">platform.openai.com/api-keys</span>. Se guarda encriptada.
            </p>
          </div>

          {/* Nota Anthropic */}
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-800 p-3 text-xs text-indigo-700 dark:text-indigo-400">
            <strong>Clave de Anthropic (Claude):</strong> Se configura a nivel del servidor en la variable de entorno{' '}
            <span className="font-mono bg-indigo-100 dark:bg-indigo-900/40 px-1 rounded">ANTHROPIC_API_KEY</span>.
            Contacta al administrador del servidor para actualizarla.
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium rounded-xl transition-colors text-sm"
        >
          {saveMutation.isPending ? (
            <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
            </svg>
          )}
          Guardar configuración
        </button>
      </div>

    </div>
  )
}
