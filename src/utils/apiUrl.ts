const DEV_FRONTEND_PORT_PATTERN = /^517\d$/

type ViteImportMeta = ImportMeta & {
  env?: {
    DEV?: boolean
    VITE_CONTROL_CENTER_API_TARGET?: string
  }
}

const viteEnv = (import.meta as ViteImportMeta).env
const configuredApiTarget = (((import.meta as ViteImportMeta).env?.VITE_CONTROL_CENTER_API_TARGET) || '').replace(/\/+$/, '')

export function apiUrl(path: string): string {
  if (typeof window !== 'undefined' && path.startsWith('/api') && DEV_FRONTEND_PORT_PATTERN.test(window.location.port)) {
    // Keep the Vite browser client same-origin. The dev server already proxies
    // /api to the Control Center, which avoids browser CORS/local-network
    // policy failures between 127.0.0.1:5173 and 127.0.0.1:4050.
    if (viteEnv?.DEV) return path
    return `${configuredApiTarget || 'http://127.0.0.1:4050'}${path}`
  }
  return path
}
