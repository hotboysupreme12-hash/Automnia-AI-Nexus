import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './automnia-app-theme.css'
import App from './App.tsx'
import { installAuthenticatedFetch } from './api/authenticatedFetch'
import { preloadMissionIconAssets } from './components/mission/missionIconAssets'
import { applyStoredUiSettings } from './components/settings/uiSettings'
import { AppErrorBoundary, installGlobalRendererErrorHandlers } from './components/system/AppErrorBoundary'

const userAgent = navigator.userAgent || ''
const isWindowsClient = /Windows/i.test(userAgent)
const isDesktopClient = /Electron/i.test(userAgent)

document.documentElement.classList.add('dy-human-ui', 'dui-pro-overhaul', 'dui-cohesive-ui')
if (isWindowsClient) document.documentElement.classList.add('dy-windows-client')
if (isDesktopClient) document.documentElement.classList.add('dy-desktop-client')
if (isWindowsClient && isDesktopClient) document.documentElement.classList.add('dy-desktop-safe-renderer')
document.documentElement.dataset.dyTheme = 'dark'
applyStoredUiSettings()
installAuthenticatedFetch()
installGlobalRendererErrorHandlers()
void preloadMissionIconAssets()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
