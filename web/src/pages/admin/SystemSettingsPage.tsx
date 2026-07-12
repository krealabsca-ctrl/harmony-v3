import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Upload, Globe } from 'lucide-react'
import api from '@/api/client'

interface SystemConfig {
  app_name: string
  favicon_url: string
}

export default function SystemSettingsPage() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [appName, setAppName] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [savedMessage, setSavedMessage] = useState('')

  const { data } = useQuery<SystemConfig>({
    queryKey: ['system-settings'],
    queryFn: () => api.get('/admin/system-settings').then(r => r.data),
  })

  useEffect(() => {
    if (!data) return
    setAppName(data.app_name ?? 'Harmony')
  }, [data])

  const saveMutation = useMutation({
    mutationFn: (name: string) => api.put('/admin/system-settings', { app_name: name }),
    onSuccess: () => {
      setSavedMessage('Nombre guardado.')
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      queryClient.invalidateQueries({ queryKey: ['system-config'] })
      setTimeout(() => setSavedMessage(''), 3000)
    },
    onError: () => toast.error('Error al guardar'),
  })

  const faviconMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('favicon', file)
      return api.post('/admin/system-settings/favicon', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: (res) => {
      toast.success('Favicon actualizado.')
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      queryClient.invalidateQueries({ queryKey: ['system-config'] })
      setSelectedFile(null)
      setPreviewUrl(null)
      // Apply immediately to current tab
      const url = res.data.favicon_url
      if (url) {
        const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
        if (link) link.href = url + '?t=' + Date.now()
      }
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Error al subir favicon'),
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const currentFavicon = previewUrl ?? (data?.favicon_url ? data.favicon_url + '?t=' + Date.now() : null)

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Configuración del Sistema</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Ajustes globales que aplican a todas las empresas.</p>
      </div>

      {savedMessage && (
        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-400 text-sm">
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
          </svg>
          {savedMessage}
        </div>
      )}

      {/* Nombre de la aplicación */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        <div className="px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 text-sm">
              <Globe className="w-4 h-4" />
            </span>
            Nombre de la aplicación
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Se muestra en la barra del navegador y en el sidebar.</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <input
            type="text"
            value={appName}
            onChange={e => setAppName(e.target.value)}
            placeholder="Harmony"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex justify-end">
            <button
              onClick={() => saveMutation.mutate(appName)}
              disabled={saveMutation.isPending || !appName.trim()}
              className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition"
            >
              {saveMutation.isPending && <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Guardar nombre
            </button>
          </div>
        </div>
      </div>

      {/* Favicon */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
        <div className="px-6 py-4">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-400 text-sm">🌐</span>
            Favicon del sistema
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Ícono que aparece en la pestaña del navegador. Recomendado: 32×32 px en PNG o ICO.</p>
        </div>
        <div className="px-6 py-5 space-y-4">

          {/* Preview actual */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-600 flex items-center justify-center bg-gray-50 dark:bg-gray-700 overflow-hidden">
              {currentFavicon ? (
                <img src={currentFavicon} alt="favicon" className="w-10 h-10 object-contain" />
              ) : (
                <span className="text-2xl">🌐</span>
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {selectedFile ? selectedFile.name : data?.favicon_url ? 'Favicon configurado' : 'Sin favicon personalizado'}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : 'Formatos: PNG, ICO, SVG, JPG'}
              </p>
            </div>
          </div>

          {/* Botones */}
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".png,.ico,.svg,.jpg,.jpeg"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              <Upload className="w-4 h-4" />
              Seleccionar archivo
            </button>
            {selectedFile && (
              <button
                onClick={() => faviconMutation.mutate(selectedFile)}
                disabled={faviconMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition"
              >
                {faviconMutation.isPending
                  ? <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Upload className="w-3.5 h-3.5" />}
                Subir favicon
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
