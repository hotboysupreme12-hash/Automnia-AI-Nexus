import { Component, type ErrorInfo, type ReactNode } from 'react'
import './AppErrorBoundary.css'

const CRASH_EVENTS_KEY = 'dystopai.renderer.crash.events'
const CRASH_WINDOW_MS = 60_000
const CRASH_LOOP_LIMIT = 3
const MAX_RECORDED_EVENTS = 8
const MAX_ERROR_DETAIL_LENGTH = 1_600
const RENDERER_ERROR_EVENT = 'dystopai:renderer-error'

type RendererErrorSource = 'react-render' | 'window-error' | 'unhandled-rejection'

interface SerializableRendererError {
  name: string
  message: string
  source: RendererErrorSource
  timestamp: number
  stack?: string
}

interface RendererCrashSnapshot {
  recentCrashCount: number
  crashLoopDetected: boolean
  lastCrashAt: number | null
}

interface RecordedRendererErrorEvent {
  error: SerializableRendererError
  guard: RendererCrashSnapshot
}

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  error: SerializableRendererError | null
  guard: RendererCrashSnapshot
  componentStack?: string
}

const emptyGuard: RendererCrashSnapshot = {
  recentCrashCount: 0,
  crashLoopDetected: false,
  lastCrashAt: null,
}

let globalRendererErrorHandlersInstalled = false

function rendererSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function trimmedErrorDetail(value: string): string {
  return value.length > MAX_ERROR_DETAIL_LENGTH
    ? `${value.slice(0, MAX_ERROR_DETAIL_LENGTH)}...`
    : value
}

function describeUnknownError(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function normalizeRendererError(value: unknown, source: RendererErrorSource): SerializableRendererError {
  const timestamp = Date.now()
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message || 'Unknown renderer error',
      source,
      timestamp,
      stack: value.stack ? trimmedErrorDetail(value.stack) : undefined,
    }
  }

  return {
    name: source === 'unhandled-rejection' ? 'UnhandledPromiseRejection' : 'RendererError',
    message: trimmedErrorDetail(describeUnknownError(value)),
    source,
    timestamp,
  }
}

function readCrashEvents(now = Date.now()): number[] {
  const storage = rendererSessionStorage()
  if (!storage) return []

  try {
    const parsed = JSON.parse(storage.getItem(CRASH_EVENTS_KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((value): value is number => Number.isFinite(value))
      .filter((timestamp) => now - timestamp <= CRASH_WINDOW_MS)
      .slice(-MAX_RECORDED_EVENTS)
  } catch {
    storage.removeItem(CRASH_EVENTS_KEY)
    return []
  }
}

function crashSnapshot(events: number[]): RendererCrashSnapshot {
  return {
    recentCrashCount: events.length,
    crashLoopDetected: events.length >= CRASH_LOOP_LIMIT,
    lastCrashAt: events.length > 0 ? events[events.length - 1] ?? null : null,
  }
}

function recordRendererCrash(now = Date.now()): RendererCrashSnapshot {
  const storage = rendererSessionStorage()
  const events = [...readCrashEvents(now), now].slice(-MAX_RECORDED_EVENTS)
  if (storage) {
    try {
      storage.setItem(CRASH_EVENTS_KEY, JSON.stringify(events))
    } catch {
      storage.removeItem(CRASH_EVENTS_KEY)
    }
  }
  return crashSnapshot(events)
}

function dispatchRecordedRendererError(detail: RecordedRendererErrorEvent): void {
  window.dispatchEvent(new CustomEvent<RecordedRendererErrorEvent>(RENDERER_ERROR_EVENT, { detail }))
}

export function clearRendererCrashGuard(): void {
  const storage = rendererSessionStorage()
  if (!storage) return
  storage.removeItem(CRASH_EVENTS_KEY)
}

export function installGlobalRendererErrorHandlers(): void {
  if (globalRendererErrorHandlersInstalled || typeof window === 'undefined') return
  globalRendererErrorHandlersInstalled = true

  window.addEventListener('error', (event) => {
    const error = normalizeRendererError(event.error || event.message, 'window-error')
    const guard = recordRendererCrash(error.timestamp)
    dispatchRecordedRendererError({ error, guard })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const error = normalizeRendererError(event.reason, 'unhandled-rejection')
    const guard = recordRendererCrash(error.timestamp)
    dispatchRecordedRendererError({ error, guard })
  })
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    error: null,
    guard: emptyGuard,
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return {
      hasError: true,
      error: normalizeRendererError(error, 'react-render'),
    }
  }

  componentDidMount(): void {
    window.addEventListener(RENDERER_ERROR_EVENT, this.handleRecordedRendererError as EventListener)
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const normalizedError = normalizeRendererError(error, 'react-render')
    this.setState({
      error: normalizedError,
      guard: recordRendererCrash(normalizedError.timestamp),
      componentStack: errorInfo.componentStack || undefined,
    })
  }

  componentWillUnmount(): void {
    window.removeEventListener(RENDERER_ERROR_EVENT, this.handleRecordedRendererError as EventListener)
  }

  private handleRecordedRendererError = (event: Event): void => {
    const detail = (event as CustomEvent<RecordedRendererErrorEvent>).detail
    if (!detail?.error) return

    this.setState({
      hasError: true,
      error: detail.error,
      guard: detail.guard,
      componentStack: undefined,
    })
  }

  private handleRetry = (): void => {
    clearRendererCrashGuard()
    this.setState({
      hasError: false,
      error: null,
      guard: emptyGuard,
      componentStack: undefined,
    })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private renderDetails(): string {
    const { error, componentStack } = this.state
    if (!error) return 'No renderer error details were captured.'

    const lines = [
      `Source: ${error.source}`,
      `Name: ${error.name}`,
      `Message: ${error.message}`,
      `Timestamp: ${new Date(error.timestamp).toISOString()}`,
    ]
    if (error.stack) lines.push('', error.stack)
    if (componentStack) lines.push('', 'React component stack:', componentStack)
    return lines.join('\n')
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    const { error, guard } = this.state
    const title = guard.crashLoopDetected
      ? 'Renderer crash loop paused'
      : 'Renderer recovery screen'
    const summary = guard.crashLoopDetected
      ? 'Automnia AI Nexus caught repeated renderer failures in the current session and paused normal rendering so the console stays recoverable.'
      : 'Automnia AI Nexus caught a renderer failure before it could blank the console. You can retry the shell or reload the desktop view.'
    const lastCrash = guard.lastCrashAt ? new Date(guard.lastCrashAt).toLocaleTimeString() : 'Unavailable'

    return (
      <main className="dy-error-boundary" role="alert" aria-live="assertive">
        <section className="dy-error-boundary__panel" aria-labelledby="dy-error-boundary-title">
          <p className="dy-error-boundary__kicker">Automnia AI Nexus Control Center</p>
          <h1 id="dy-error-boundary-title" className="dy-error-boundary__title">
            {title}
          </h1>
          <p className="dy-error-boundary__summary">{summary}</p>
          <div className="dy-error-boundary__status" aria-label="Renderer crash status">
            <span className="dy-error-boundary__chip">
              Recent crashes: {guard.recentCrashCount}
            </span>
            <span className="dy-error-boundary__chip">Last crash: {lastCrash}</span>
            <span className="dy-error-boundary__chip">
              Source: {error?.source || 'unknown'}
            </span>
          </div>
          <div className="dy-error-boundary__actions">
            <button
              className="dy-error-boundary__button dy-error-boundary__button--primary"
              type="button"
              onClick={this.handleRetry}
            >
              Retry Shell
            </button>
            <button className="dy-error-boundary__button" type="button" onClick={this.handleReload}>
              Reload Console
            </button>
            <button className="dy-error-boundary__button" type="button" onClick={clearRendererCrashGuard}>
              Clear Crash Guard
            </button>
          </div>
          <details className="dy-error-boundary__details">
            <summary>Renderer diagnostics</summary>
            <pre className="dy-error-boundary__pre">{this.renderDetails()}</pre>
          </details>
        </section>
      </main>
    )
  }
}
