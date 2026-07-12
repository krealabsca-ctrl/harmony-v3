import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-6xl font-bold mb-4" style={{ color: 'var(--color-primary)' }}>404</p>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Página no encontrada</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-6">La página que buscas no existe.</p>
        <Link to="/" className="btn-primary inline-block">Volver al inicio</Link>
      </div>
    </div>
  )
}
