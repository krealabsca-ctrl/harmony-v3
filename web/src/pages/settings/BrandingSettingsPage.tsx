import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Save, Loader2, Palette, Monitor,
  MessageSquare, LayoutDashboard, FileText, Settings,
  BarChart3, Users, Megaphone, LogOut, Radio,
} from 'lucide-react'
import api from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandingSettings {
  system_name: string
  primary_color: string
  secondary_color: string
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
}

function SidebarPreview({ systemName, primaryColor, secondaryColor }: SidebarPreviewProps) {
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
            <div
              className="h-6 w-6 rounded-md flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0"
              style={{ backgroundColor: primary }}
            >
              {(systemName || 'H').charAt(0).toUpperCase()}
            </div>
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
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">{label}</label>
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
  const queryClient = useQueryClient()

  const [form, setForm] = useState<BrandingSettings>({
    system_name: '',
    primary_color: '#4F46E5',
    secondary_color: '#7C3AED',
  })

  // Separate raw hex inputs so user can type freely without snapping
  const [primaryHex, setPrimaryHex] = useState('#4F46E5')
  const [secondaryHex, setSecondaryHex] = useState('#7C3AED')

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery<BrandingSettings>({
    queryKey: ['branding'],
    queryFn: async () => {
      const { data } = await api.get('/settings/branding')
      return data?.data ?? data
    },
  })

  // React Query v5 no soporta onSuccess en useQuery: cargamos el form con useEffect.
  useEffect(() => {
    if (!data) return
    const p = data.primary_color ?? '#4F46E5'
    const s = data.secondary_color ?? '#7C3AED'
    setForm({
      system_name: data.system_name ?? '',
      primary_color: p,
      secondary_color: s,
    })
    setPrimaryHex(p)
    setSecondaryHex(s)
  }, [data])

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () =>
      api.put('/settings/branding', {
        system_name: form.system_name,
        primary_color: form.primary_color,
        secondary_color: form.secondary_color,
      }),
    onSuccess: () => {
      applyColorsToDocument(form.primary_color, form.secondary_color)
      queryClient.invalidateQueries({ queryKey: ['branding'] })
      queryClient.invalidateQueries({ queryKey: ['system-config'] })
      toast.success('Apariencia guardada y aplicada correctamente')
    },
    onError: () => {
      toast.error('Error al guardar la configuración de apariencia')
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
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Apariencia</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Nombre y paleta de colores del sistema. El logo y el favicon se configuran en{' '}
          <span className="font-medium">Configuración del Sistema</span>.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: settings (2 cols) ── */}
        <div className="lg:col-span-2 space-y-5">

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
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
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
          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-2xl border border-blue-100 dark:border-blue-900 p-4">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">Aplicación de colores</p>
            <p className="text-xs text-blue-600 dark:text-blue-300 leading-relaxed">
              Al guardar, los colores se aplican de inmediato en esta sesión mediante variables
              CSS globales (<code className="font-mono">--color-primary</code>). Cada empresa puede
              además definir su propia paleta desde Gestión de Empresas.
            </p>
          </div>
        </div>
      </form>
    </div>
  )
}
