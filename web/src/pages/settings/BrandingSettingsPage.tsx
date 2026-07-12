import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Upload, Save, Loader2, Palette, Image as ImageIcon, Monitor,
  MessageSquare, LayoutDashboard, FileText, Settings,
  BarChart3, Users, Megaphone, LogOut, Radio,
} from 'lucide-react'
import api from '@/api/client'
import { useAuth } from '@/hooks/useAuth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandingSettings {
  system_name: string
  primary_color: string
  secondary_color: string
  logo_url: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyColorsToDocument(primary: string, secondary: string) {
  document.documentElement.style.setProperty('--color-primary', primary)
  document.documentElement.style.setProperty('--color-secondary', secondary)
}

function isValidHex(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value)
}

// ─── Sidebar Preview ──────────────────────────────────────────────────────────

interface SidebarPreviewProps {
  systemName: string
  primaryColor: string
  secondaryColor: string
  logoPreview: string | null
}

function SidebarPreview({ systemName, primaryColor, secondaryColor, logoPreview }: SidebarPreviewProps) {
  const primary = isValidHex(primaryColor) ? primaryColor : '#4F46E5'
  const secondary = isValidHex(secondaryColor) ? secondaryColor : '#7C3AED'

  const navItems = [
    { icon: MessageSquare, label: 'Inbox', active: true },
    { icon: LayoutDashboard, label: 'Dashboard', active: false },
    { icon: Megaphone, label: 'Campañas', active: false },
    { icon: FileText, label: 'Plantillas', active: false },
    { icon: BarChart3, label: 'Reportes', active: false },
    { icon: Radio, label: 'Canales', active: false },
    { icon: Users, label: 'Usuarios', active: false },
    { icon: Settings, label: 'Config.', active: false },
  ]

  return (
    <div className="rounded-2xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 w-full" style={{ maxWidth: 220 }}>
      <div className="flex" style={{ height: 340 }}>
        {/* Sidebar — white bg, matching real Sidebar.tsx */}
        <div className="flex flex-col bg-white dark:bg-gray-800 border-r border-gray-100 dark:border-gray-700 w-full">
          {/* Logo */}
          <div className="h-11 flex items-center px-3 border-b border-gray-100 dark:border-gray-700 gap-2 flex-shrink-0">
            {logoPreview ? (
              <img
                src={logoPreview}
                alt="Logo"
                className="h-6 w-6 rounded-md object-contain flex-shrink-0"
              />
            ) : (
              <div
                className="h-6 w-6 rounded-md flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0"
                style={{ backgroundColor: primary }}
              >
                {(systemName || 'H').charAt(0).toUpperCase()}
              </div>
            )}
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-[11px] truncate">
              {systemName || 'Harmony'}
            </span>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-1.5 space-y-0.5 overflow-hidden">
            <p className="px-2 pt-1.5 pb-0.5 text-[8px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              Omnicanal
            </p>
            {navItems.map(({ icon: Icon, label, active }) => (
              <div
                key={label}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors"
                style={
                  active
                    ? { backgroundColor: primary, color: '#fff' }
                    : { color: '#6b7280' }
                }
              >
                <Icon className="w-2.5 h-2.5 flex-shrink-0" />
                <span className="truncate">{label}</span>
              </div>
            ))}
          </nav>

          {/* User footer */}
          <div className="p-1.5 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                style={{ backgroundColor: secondary }}
              >
                SA
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-medium text-gray-900 dark:text-gray-100 truncate">Superadmin</p>
                <p className="text-[8px] text-gray-400 dark:text-gray-500 truncate">admin@sistema.com</p>
              </div>
              <LogOut className="w-2.5 h-2.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ColorField ───────────────────────────────────────────────────────────────

interface ColorFieldProps {
  label: string
  hint: string
  colorValue: string
  hexInput: string
  onPickerChange: (hex: string) => void
  onHexChange: (raw: string) => void
  pickerId: string
}

function ColorField({ label, hint, colorValue, hexInput, onPickerChange, onHexChange, pickerId }: ColorFieldProps) {
  const valid = isValidHex(colorValue)

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        {/* Swatch / color picker */}
        <div className="relative flex-shrink-0">
          <input
            type="color"
            value={valid ? colorValue : '#000000'}
            onChange={e => onPickerChange(e.target.value)}
            className="sr-only"
            id={pickerId}
          />
          <label
            htmlFor={pickerId}
            className="block h-10 w-10 rounded-xl border border-gray-300 dark:border-gray-600 cursor-pointer shadow-sm hover:shadow-md transition-shadow overflow-hidden"
            style={{ backgroundColor: valid ? colorValue : '#e5e7eb' }}
            title="Abrir selector de color"
          />
        </div>

        {/* Hex text input */}
        <input
          type="text"
          value={hexInput}
          onChange={e => onHexChange(e.target.value)}
          maxLength={7}
          className="flex-1 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent uppercase"
          placeholder="#4F46E5"
          spellCheck={false}
        />
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{hint}</p>
    </div>
  )
}

// ─── BrandingSettingsPage ─────────────────────────────────────────────────────

export default function BrandingSettingsPage() {
  const { isSuperAdmin } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<BrandingSettings>({
    system_name: '',
    primary_color: '#4F46E5',
    secondary_color: '#7C3AED',
    logo_url: null,
  })

  // Separate raw hex inputs so user can type freely without snapping
  const [primaryHex, setPrimaryHex] = useState('#4F46E5')
  const [secondaryHex, setSecondaryHex] = useState('#7C3AED')

  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [initialLogoUrl, setInitialLogoUrl] = useState<string | null>(null)

  const [faviconFile, setFaviconFile] = useState<File | null>(null)
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null)

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const { isLoading } = useQuery<BrandingSettings>({
    queryKey: ['branding'],
    queryFn: async () => {
      const { data } = await api.get('/settings/branding')
      return data
    },
    onSuccess: (data: BrandingSettings) => {
      const p = data.primary_color ?? '#4F46E5'
      const s = data.secondary_color ?? '#7C3AED'
      setForm({
        system_name: data.system_name ?? '',
        primary_color: p,
        secondary_color: s,
        logo_url: data.logo_url ?? null,
      })
      setPrimaryHex(p)
      setSecondaryHex(s)
      setInitialLogoUrl(data.logo_url ?? null)
      if (data.logo_url) setLogoPreview(data.logo_url)
    },
  } as any)

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (logoFile || faviconFile) {
        const fd = new FormData()
        fd.append('system_name', form.system_name)
        fd.append('primary_color', form.primary_color)
        fd.append('secondary_color', form.secondary_color)
        if (logoFile) fd.append('logo', logoFile)
        if (faviconFile) fd.append('favicon', faviconFile)
        return api.put('/settings/branding', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
      return api.put('/settings/branding', {
        system_name: form.system_name,
        primary_color: form.primary_color,
        secondary_color: form.secondary_color,
      })
    },
    onSuccess: () => {
      applyColorsToDocument(form.primary_color, form.secondary_color)
      toast.success('Branding guardado y aplicado correctamente')
    },
    onError: () => {
      toast.error('Error al guardar la configuración de branding')
    },
  })

  // ── Color handlers ────────────────────────────────────────────────────────

  const handlePrimaryPicker = useCallback((hex: string) => {
    setPrimaryHex(hex)
    setForm(p => ({ ...p, primary_color: hex }))
  }, [])

  const handleSecondaryPicker = useCallback((hex: string) => {
    setSecondaryHex(hex)
    setForm(p => ({ ...p, secondary_color: hex }))
  }, [])

  const handlePrimaryHex = useCallback((raw: string) => {
    const normalized = raw.startsWith('#') ? raw : `#${raw}`
    setPrimaryHex(normalized)
    if (isValidHex(normalized)) {
      setForm(p => ({ ...p, primary_color: normalized }))
    }
  }, [])

  const handleSecondaryHex = useCallback((raw: string) => {
    const normalized = raw.startsWith('#') ? raw : `#${raw}`
    setSecondaryHex(normalized)
    if (isValidHex(normalized)) {
      setForm(p => ({ ...p, secondary_color: normalized }))
    }
  }, [])

  // ── Logo handlers ─────────────────────────────────────────────────────────

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Por favor selecciona un archivo de imagen válido')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('La imagen no debe superar los 2 MB')
      return
    }
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleRemoveLogo = () => {
    setLogoFile(null)
    setLogoPreview(initialLogoUrl)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFaviconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 512 * 1024) {
      toast.error('El favicon no debe superar los 512 KB')
      return
    }
    setFaviconFile(file)
    const reader = new FileReader()
    reader.onload = ev => setFaviconPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.system_name.trim()) {
      toast.error('El nombre del sistema es obligatorio')
      return
    }
    if (!isValidHex(form.primary_color)) {
      toast.error('Color primario inválido — usa formato #RRGGBB')
      return
    }
    if (!isValidHex(form.secondary_color)) {
      toast.error('Color secundario inválido — usa formato #RRGGBB')
      return
    }
    saveMutation.mutate()
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Branding</h1>
        <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm mt-1">
          Personaliza la apariencia visual global del sistema para todos los usuarios.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: settings (2 cols) ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Logo card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                <ImageIcon className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Logotipo</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500">PNG, SVG, WEBP · máx. 2 MB · fondo transparente recomendado</p>
              </div>
            </div>

            <div className="px-6 py-5">
              <div className="flex items-start gap-5">
                {/* Preview box */}
                <div className="h-20 w-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" className="h-full w-full object-contain p-1" />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-gray-300" />
                  )}
                </div>

                {/* Controls */}
                <div className="flex-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoChange}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      {logoPreview ? 'Cambiar logo' : 'Subir logo'}
                    </button>
                    {logoPreview && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                  {logoFile ? (
                    <p className="text-xs text-green-600 mt-2 font-medium">
                      Archivo listo: {logoFile.name} ({(logoFile.size / 1024).toFixed(0)} KB)
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                      Se muestra en la barra lateral junto al nombre del sistema.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Favicon card — superAdmin only */}
          {isSuperAdmin && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  <ImageIcon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Favicon</h2>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Icono que aparece en la pestana del navegador</p>
                </div>
              </div>

              <div className="px-6 py-5 space-y-3">
                {/* Hidden file input */}
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept="image/*,.ico"
                  className="hidden"
                  onChange={handleFaviconChange}
                />

                <div className="flex items-center gap-4">
                  {/* Preview */}
                  <div className="flex-shrink-0 w-10 h-10 border border-gray-200 dark:border-gray-600 rounded flex items-center justify-center bg-gray-50 dark:bg-gray-900 overflow-hidden">
                    {faviconPreview ? (
                      <img src={faviconPreview} alt="Favicon preview" className="w-8 h-8 object-contain" />
                    ) : (
                      <span className="text-xs text-gray-300">ico</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => faviconInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-900 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    {faviconFile ? 'Cambiar favicon' : 'Subir favicon'}
                  </button>

                  {faviconFile && (
                    <p className="text-xs text-green-600 font-medium">
                      {faviconFile.name} ({(faviconFile.size / 1024).toFixed(0)} KB)
                    </p>
                  )}
                </div>

                <p className="text-xs text-gray-400 dark:text-gray-500">
                  32x32 px recomendado. Formatos: .ico, .png, .svg
                </p>
              </div>
            </div>
          )}

          {/* System name + colors card */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                <Palette className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Identidad visual</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500">Nombre y paleta de colores del sistema</p>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* System name */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-1.5">
                  Nombre del sistema
                </label>
                <input
                  type="text"
                  value={form.system_name}
                  onChange={e => setForm(p => ({ ...p, system_name: e.target.value }))}
                  placeholder="Harmony"
                  maxLength={60}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                  Aparece en el sidebar, la pestaña del navegador y los correos del sistema.
                </p>
              </div>

              {/* Colors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <ColorField
                  label="Color primario"
                  hint="Sidebar activo, botones principales, iconos de tarjetas."
                  colorValue={form.primary_color}
                  hexInput={primaryHex}
                  onPickerChange={handlePrimaryPicker}
                  onHexChange={handlePrimaryHex}
                  pickerId="primary-color-picker"
                />
                <ColorField
                  label="Color secundario"
                  hint="Avatares de usuario, acentos y elementos complementarios."
                  colorValue={form.secondary_color}
                  hexInput={secondaryHex}
                  onPickerChange={handleSecondaryPicker}
                  onHexChange={handleSecondaryHex}
                  pickerId="secondary-color-picker"
                />
              </div>
            </div>
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Guardar cambios
            </button>
          </div>
        </div>

        {/* ── Right: live preview (1 col) ── */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden sticky top-6">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                <Monitor className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Vista previa</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500">Actualiza en tiempo real</p>
              </div>
            </div>

            <div className="px-5 py-5 flex justify-center">
              <SidebarPreview
                systemName={form.system_name}
                primaryColor={form.primary_color}
                secondaryColor={form.secondary_color}
                logoPreview={logoPreview}
              />
            </div>

            {/* Color swatches */}
            <div className="px-5 pb-5 space-y-2">
              <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-900 rounded-xl">
                <div
                  className="h-5 w-5 rounded-md border border-gray-200 dark:border-gray-700 flex-shrink-0"
                  style={{ backgroundColor: form.primary_color }}
                />
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Primario</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{form.primary_color.toUpperCase()}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-900 rounded-xl">
                <div
                  className="h-5 w-5 rounded-md border border-gray-200 dark:border-gray-700 flex-shrink-0"
                  style={{ backgroundColor: form.secondary_color }}
                />
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Secundario</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{form.secondary_color.toUpperCase()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Info tip */}
          <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4">
            <p className="text-xs font-semibold text-blue-700 mb-1">Aplicación inmediata</p>
            <p className="text-xs text-blue-600 leading-relaxed">
              Al guardar, los colores se aplican al instante en toda la aplicación
              mediante variables CSS globales (<code className="font-mono">--color-primary</code>).
            </p>
          </div>
        </div>
      </form>
    </div>
  )
}
