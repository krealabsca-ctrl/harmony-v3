// recaptcha.ts — Carga perezosa de Google reCAPTCHA v3 y obtención de tokens.
// La site key es pública y llega desde /system-config. Si no hay site key configurada,
// getRecaptchaToken devuelve "" y el backend trata la verificación como desactivada.

interface Grecaptcha {
  ready: (cb: () => void) => void
  execute: (siteKey: string, opts: { action: string }) => Promise<string>
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha
  }
}

let loadPromise: Promise<void> | null = null

function loadScript(siteKey: string): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = new Promise<void>((resolve, reject) => {
    if (window.grecaptcha) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => {
      loadPromise = null
      reject(new Error('No se pudo cargar reCAPTCHA'))
    }
    document.head.appendChild(s)
  })
  return loadPromise
}

// getRecaptchaToken devuelve un token para la acción dada. Si algo falla o no hay site key,
// devuelve "" (el login continúa; el backend decide si exige reCAPTCHA).
export async function getRecaptchaToken(siteKey: string | undefined, action: string): Promise<string> {
  if (!siteKey) return ''
  try {
    await loadScript(siteKey)
    await new Promise<void>((resolve) => window.grecaptcha!.ready(() => resolve()))
    return await window.grecaptcha!.execute(siteKey, { action })
  } catch {
    return ''
  }
}
