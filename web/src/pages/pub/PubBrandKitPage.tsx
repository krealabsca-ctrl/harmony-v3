import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactInfo {
  contactPhone:   string
  contactEmail:   string
  contactWebsite: string
  contactAddress: string
}

interface BrandKit {
  id:                 number
  logo_path:          string
  colors:             string[]
  contact_info:       ContactInfo
  tone:               string
  target_audience:    string
  avoid_words:        string[]
  extra_instructions: string
}

interface PubDocument {
  id:                number
  name:              string
  file_path:         string
  mime_type:         string
  is_active:         boolean
  processing_status: 'pending' | 'processing' | 'done' | 'failed'
  created_at:        string
}

const TONES = [
  'profesional',
  'cercano y amigable',
  'formal',
  'divertido y creativo',
  'inspirador',
]

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  done:       { label: 'Listo',       cls: 'bg-green-100 text-green-700' },
  failed:     { label: 'Error',       cls: 'bg-red-100 text-red-700'     },
  pending:    { label: 'Procesando',  cls: 'bg-yellow-100 text-yellow-700' },
  processing: { label: 'Procesando',  cls: 'bg-yellow-100 text-yellow-700' },
}

const EMPTY_KIT: BrandKit = {
  id:                 0,
  logo_path:          '',
  colors:             ['#6D28D9'],
  contact_info:       { contactPhone: '', contactEmail: '', contactWebsite: '', contactAddress: '' },
  tone:               'profesional',
  target_audience:    '',
  avoid_words:        [],
  extra_instructions: '',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PubBrandKitPage() {
  const qc       = useQueryClient()
  const logoRef  = useRef<HTMLInputElement>(null)
  const docRef   = useRef<HTMLInputElement>(null)

  // ── Form state ───────────────────────────────────────────────────────────────
  const [form,       setForm]       = useState<BrandKit>(EMPTY_KIT)
  const [logoFile,   setLogoFile]   = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string>('')
  const [newColor,   setNewColor]   = useState('#000000')
  const [newWord,    setNewWord]    = useState('')

  // Document upload state
  const [docName, setDocName] = useState('')
  const [docFile, setDocFile] = useState<File | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: kitData, isLoading: kitLoading } = useQuery<BrandKit>({
    queryKey: ['pub-brand-kit'],
    queryFn: () => api.get('/pub/brand-kit').then(r => r.data),
  })

  const { data: docsData, isLoading: docsLoading } = useQuery<{ data: PubDocument[] }>({
    queryKey: ['pub-documents'],
    queryFn: () => api.get('/pub/documents').then(r => r.data),
  })

  useEffect(() => {
    if (kitData) {
      setForm({
        ...kitData,
        colors:      Array.isArray(kitData.colors)      ? kitData.colors      : ['#6D28D9'],
        avoid_words: Array.isArray(kitData.avoid_words) ? kitData.avoid_words : [],
        contact_info: {
          contactPhone:   kitData.contact_info?.contactPhone   ?? '',
          contactEmail:   kitData.contact_info?.contactEmail   ?? '',
          contactWebsite: kitData.contact_info?.contactWebsite ?? '',
          contactAddress: kitData.contact_info?.contactAddress ?? '',
        },
      })
    }
  }, [kitData])

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('colors',              JSON.stringify(form.colors))
      fd.append('contact_info',        JSON.stringify(form.contact_info))
      fd.append('avoid_words',         JSON.stringify(form.avoid_words))
      fd.append('tone',                form.tone)
      fd.append('target_audience',     form.target_audience)
      fd.append('extra_instructions',  form.extra_instructions)
      if (logoFile) fd.append('logo', logoFile)
      return api.post('/pub/brand-kit', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pub-brand-kit'] })
      setLogoFile(null)
      setLogoPreview('')
      toast.success('Marca guardada correctamente.')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al guardar')
    },
  })

  const uploadDocMutation = useMutation({
    mutationFn: () => {
      if (!docFile) throw new Error('Archivo requerido')
      const fd = new FormData()
      fd.append('doc_name', docName)
      fd.append('doc_file', docFile)
      return api.post('/pub/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pub-documents'] })
      setDocName('')
      setDocFile(null)
      if (docRef.current) docRef.current.value = ''
      toast.success('Documento subido correctamente.')
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Error al subir documento')
    },
  })

  const toggleDocMutation = useMutation({
    mutationFn: (id: number) => api.put(`/pub/documents/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pub-documents'] }),
  })

  const deleteDocMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/pub/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pub-documents'] })
      toast.success('Documento eliminado')
    },
  })

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const set = <K extends keyof BrandKit>(key: K, val: BrandKit[K]) =>
    setForm(f => ({ ...f, [key]: val }))

  const setContact = (key: keyof ContactInfo, val: string) =>
    setForm(f => ({ ...f, contact_info: { ...f.contact_info, [key]: val } }))

  const addColor = () => {
    if (form.colors.length >= 5) return
    if (!/^#[0-9A-Fa-f]{6}$/.test(newColor)) return
    if (form.colors.includes(newColor)) return
    set('colors', [...form.colors, newColor])
  }

  const removeColor = (i: number) =>
    set('colors', form.colors.filter((_, idx) => idx !== i))

  const addWord = () => {
    const w = newWord.trim()
    if (!w || form.avoid_words.includes(w)) return
    set('avoid_words', [...form.avoid_words, w])
    setNewWord('')
  }

  const removeWord = (i: number) =>
    set('avoid_words', form.avoid_words.filter((_, idx) => idx !== i))

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setLogoFile(f)
    setLogoPreview(URL.createObjectURL(f))
  }

  const currentLogoSrc = logoPreview
    ? logoPreview
    : form.logo_path
    ? `/uploads/${form.logo_path}` // M-09: la cookie httpOnly autentica la descarga
    : ''

  const docs = docsData?.data ?? []

  if (kitLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500 text-sm">
        <Loader2 size={20} className="animate-spin mr-2" />
        Cargando Brand Kit...
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* ── LEFT: Brand Identity ───────────────────────────────────────────── */}
        <div className="lg:sticky lg:top-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-5">Identidad de marca</h2>

            {/* Logo */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Logo</label>
              {currentLogoSrc && (
                <img
                  src={currentLogoSrc}
                  alt="Logo"
                  className="h-16 mb-2 rounded-lg object-contain border border-gray-100 dark:border-gray-700 p-1"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <input
                ref={logoRef}
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 dark:file:bg-violet-900/30 dark:file:text-violet-300"
              />
            </div>

            {/* Colors */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                Colores de marca <span className="text-gray-400">(máx. 5)</span>
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {form.colors.map((color, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 bg-gray-50 dark:bg-gray-700 rounded-full px-2 py-1 border border-gray-200 dark:border-gray-600"
                  >
                    <span
                      className="w-4 h-4 rounded-full inline-block border border-gray-300 dark:border-gray-500 shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-300 font-mono">{color}</span>
                    <button
                      type="button"
                      onClick={() => removeColor(i)}
                      className="text-gray-400 hover:text-red-500 text-xs leading-none ml-0.5"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {form.colors.length < 5 && (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newColor}
                    onChange={e => setNewColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border border-gray-200 dark:border-gray-600"
                  />
                  <button
                    type="button"
                    onClick={addColor}
                    className="text-xs px-3 py-1.5 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/50 font-medium"
                  >
                    Agregar
                  </button>
                </div>
              )}
            </div>

            {/* Contact Info */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                Información de contacto
              </label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: 'contactPhone'   as const, label: 'Teléfono',   type: 'text',  placeholder: '+506 0000-0000' },
                  { key: 'contactEmail'   as const, label: 'Correo',     type: 'email', placeholder: 'info@empresa.com' },
                  { key: 'contactWebsite' as const, label: 'Sitio web',  type: 'url',   placeholder: 'https://empresa.com' },
                  { key: 'contactAddress' as const, label: 'Dirección',  type: 'text',  placeholder: 'Ciudad, País' },
                ] as const).map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{f.label}</label>
                    <input
                      type={f.type}
                      value={form.contact_info[f.key]}
                      onChange={e => setContact(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 dark:focus:ring-violet-600"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Tono de comunicación
              </label>
              <select
                value={form.tone}
                onChange={e => set('tone', e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 dark:focus:ring-violet-600"
              >
                {TONES.map(t => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Audience */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Audiencia objetivo <span className="text-gray-400">(máx. 500 caracteres)</span>
              </label>
              <textarea
                value={form.target_audience}
                onChange={e => set('target_audience', e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Describe tu audiencia ideal..."
                className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 dark:focus:ring-violet-600 resize-none"
              />
              <p className="text-right text-xs text-gray-400 mt-0.5">
                {form.target_audience.length}/500
              </p>
            </div>

            {/* Avoid Words */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                Palabras a evitar
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.avoid_words.map((word, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs rounded-full px-2.5 py-1 border border-red-100 dark:border-red-800"
                  >
                    {word}
                    <button
                      type="button"
                      onClick={() => removeWord(i)}
                      className="hover:text-red-900 dark:hover:text-red-200 leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newWord}
                  onChange={e => setNewWord(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addWord() } }}
                  placeholder="Escribir y presionar Enter..."
                  className="flex-1 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 dark:focus:ring-violet-600"
                />
                <button
                  type="button"
                  onClick={addWord}
                  className="text-xs px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 font-medium"
                >
                  Agregar
                </button>
              </div>
            </div>

            {/* Extra Instructions */}
            <div className="mb-6">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Instrucciones adicionales para la IA
              </label>
              <textarea
                value={form.extra_instructions}
                onChange={e => set('extra_instructions', e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Cualquier indicación extra para el asistente..."
                className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 dark:focus:ring-violet-600 resize-none"
              />
            </div>

            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-xl transition"
            >
              {saveMutation.isPending ? 'Guardando...' : 'Guardar marca'}
            </button>
          </div>
        </div>

        {/* ── RIGHT: Knowledge Base ──────────────────────────────────────────── */}
        <div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-5">Base de conocimiento</h2>

            {/* Upload form */}
            <div className="mb-6">
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Nombre del documento
                </label>
                <input
                  type="text"
                  value={docName}
                  onChange={e => setDocName(e.target.value)}
                  placeholder="Ej: Manual de marca 2024"
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 dark:focus:ring-violet-600"
                />
              </div>
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Archivo <span className="text-gray-400">(PDF, DOCX, TXT — máx. 20 MB)</span>
                </label>
                <input
                  ref={docRef}
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={e => setDocFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 dark:file:bg-violet-900/30 dark:file:text-violet-300"
                />
              </div>
              <button
                type="button"
                onClick={() => uploadDocMutation.mutate()}
                disabled={uploadDocMutation.isPending || !docName.trim() || !docFile}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-xl transition"
              >
                {uploadDocMutation.isPending ? 'Subiendo...' : 'Subir documento'}
              </button>
            </div>

            {/* Document list */}
            {docsLoading ? (
              <div className="flex items-center justify-center py-6 text-gray-400 dark:text-gray-500 text-sm">
                <Loader2 size={16} className="animate-spin mr-2" /> Cargando documentos...
              </div>
            ) : docs.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
                No hay documentos subidos aún.
              </p>
            ) : (
              <ul className="divide-y divide-gray-50 dark:divide-gray-700">
                {docs.map(doc => {
                  const badge = STATUS_LABEL[doc.processing_status] ?? STATUS_LABEL.pending
                  return (
                    <li key={doc.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                          {doc.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">{doc.mime_type}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Active toggle */}
                        <button
                          type="button"
                          onClick={() => toggleDocMutation.mutate(doc.id)}
                          title={doc.is_active ? 'Desactivar' : 'Activar'}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            doc.is_active ? 'bg-violet-500' : 'bg-gray-200 dark:bg-gray-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                              doc.is_active ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm('¿Eliminar este documento?')) return
                            deleteDocMutation.mutate(doc.id)
                          }}
                          title="Eliminar"
                          className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
