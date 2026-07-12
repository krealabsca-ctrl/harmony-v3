import { Menu, Moon, Sun } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDarkMode } from '@/hooks/useDarkMode'

export default function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user } = useAuth()
  const { isDark, toggle } = useDarkMode()
  if (!user) return null
  return (
    <header className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-4 flex-shrink-0">
      <button
        className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 mr-2"
        onClick={onMenuClick}
        aria-label="Abrir menú"
      >
        <Menu size={20} className="text-gray-600 dark:text-gray-300" />
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-400"></span>
        <span className="text-sm text-gray-500 dark:text-gray-400">{user.company?.name ?? 'Sistema'}</span>
      </div>
      <button
        onClick={toggle}
        title={isDark ? 'Modo claro' : 'Modo oscuro'}
        className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  )
}
