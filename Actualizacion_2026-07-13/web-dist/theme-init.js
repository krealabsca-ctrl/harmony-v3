// A-12: script de inicialización de tema extraído de index.html para eliminar todo
// script inline y permitir una CSP estricta con `script-src 'self'` en producción.
if (localStorage.getItem('harmony_dark') === '1') {
  document.documentElement.classList.add('dark')
}
