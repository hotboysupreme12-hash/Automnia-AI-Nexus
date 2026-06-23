const DEV_FRONTEND_PORT_PATTERN = /^517\d$/

const configuredApiTarget = (import.meta.env.VITE_CONTROL_CENTER_API_TARGET || '').replace(/\/+$/, '')

export function apiUrl(path: string): string {
  if (typeof window !== 'undefined' && path.startsWith('/api') && DEV_FRONTEND_PORT_PATTERN.test(window.location.port)) {
    return `${configuredApiTarget || 'http://127.0.0.1:4050'}${path}`
  }
  return path
}
