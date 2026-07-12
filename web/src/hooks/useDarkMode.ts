import { useState, useEffect } from 'react'

export function useDarkMode() {
  const [isDark, setIsDark] = useState(
    () => localStorage.getItem('harmony_dark') === '1'
  )

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('harmony_dark', isDark ? '1' : '0')
  }, [isDark])

  return { isDark, toggle: () => setIsDark(v => !v) }
}
