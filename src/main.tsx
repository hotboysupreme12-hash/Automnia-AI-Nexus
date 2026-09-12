import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './automnia-app-theme.css'
import App from './App.tsx'
import { installAuthenticatedFetch } from './api/authenticatedFetch'
import { applyStoredUiSettings } from './components/settings/uiSettings'
import { applyRegistryCardTheme, readRegistryPreferences } from './components/settings/workspaceSettings'
import { AppErrorBoundary, installGlobalRendererErrorHandlers } from './components/system/AppErrorBoundary'

const userAgent = navigator.userAgent || ''
const isWindowsClient = /Windows/i.test(userAgent)
const isDesktopClient = /Electron/i.test(userAgent)

document.documentElement.classList.add('dy-human-ui', 'dui-pro-overhaul', 'dui-cohesive-ui')
// Favor the inexpensive visual path on every supported CPU/GPU architecture.
// Live surfaces repaint often, so large-area glass effects are a poor default
// even on fast machines.
document.documentElement.classList.add('dy-fast-renderer')
let rendererBootReady = true

function describeBootError(value: unknown): string {
  if (value instanceof Error) return value.message || value.name || 'Unknown renderer startup error'
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) || 'Unknown renderer startup error' } catch { return String(value) }
}

function renderBootFailure(error: unknown): void {
  const root = document.getElementById('root')
  if (!root) return
  const message = describeBootError(error)
  root.replaceChildren()

  const shell = document.createElement('main')
  shell.className = 'dy-error-boundary'
  shell.setAttribute('role', 'alert')
  const panel = document.createElement('section')
  panel.className = 'dy-error-boundary__panel'
  panel.innerHTML = `
    <p class="dy-error-boundary__kicker">Automnia AI Nexus</p>
    <h1 class="dy-error-boundary__title">Renderer startup failed</h1>
    <p class="dy-error-boundary__summary">The workspace could not finish starting. Reload the desktop view to try again.</p>
    <div class="dy-error-boundary__actions">
      <button class="dy-error-boundary__button dy-error-boundary__button--primary" type="button">Reload Console</button>
    </div>
    <details class="dy-error-boundary__details">
      <summary>Startup diagnostics</summary>
      <pre class="dy-error-boundary__pre"></pre>
    </details>
  `
  const diagnostics = panel.querySelector('pre')
  if (diagnostics) diagnostics.textContent = message
  panel.querySelector('button')?.addEventListener('click', () => window.location.reload())
  shell.append(panel)
  root.append(shell)
}

try {
  if (isWindowsClient) document.documentElement.classList.add('dy-windows-client')
  if (isDesktopClient) document.documentElement.classList.add('dy-desktop-client')
  if (isWindowsClient && isDesktopClient) document.documentElement.classList.add('dy-desktop-safe-renderer')
  document.documentElement.dataset.dyTheme = 'dark'
  applyStoredUiSettings()
  applyRegistryCardTheme(readRegistryPreferences())
  installAuthenticatedFetch()
  installGlobalRendererErrorHandlers()
} catch (error) {
  rendererBootReady = false
  renderBootFailure(error)
}

if (rendererBootReady) try {
  const root = document.getElementById('root')
  if (!root) throw new Error('Renderer root element is missing')
  createRoot(root).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>,
  )
} catch (error) {
  renderBootFailure(error)
}
