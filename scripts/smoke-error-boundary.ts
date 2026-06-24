import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath: string) => readFileSync(join(rootDir, relativePath), 'utf8')

const main = read('src/main.tsx')
const boundary = read('src/components/system/AppErrorBoundary.tsx')
const styles = read('src/components/system/AppErrorBoundary.css')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(main, /AppErrorBoundary/, 'main entry must import the renderer error boundary')
assert.match(main, /installGlobalRendererErrorHandlers\(\)/, 'main entry must install global renderer error handlers')
assert.match(
  main,
  /<AppErrorBoundary>[\s\S]*<App \/>[\s\S]*<\/AppErrorBoundary>/,
  'App must be wrapped by the renderer error boundary',
)
assert.ok(
  main.indexOf('installGlobalRendererErrorHandlers()') < main.indexOf('createRoot('),
  'global renderer error handlers must be installed before React renders',
)

assert.match(boundary, /static getDerivedStateFromError/, 'boundary must render a fallback for React render errors')
assert.match(boundary, /componentDidCatch/, 'boundary must record React render failures')
assert.match(boundary, /window\.addEventListener\('error'/, 'boundary module must listen for global script errors')
assert.match(boundary, /window\.addEventListener\('unhandledrejection'/, 'boundary module must listen for unhandled promise rejections')
assert.match(boundary, /sessionStorage/, 'boundary must persist crash-loop evidence in session storage')
assert.match(boundary, /CRASH_WINDOW_MS = 60_000/, 'boundary must use a bounded crash-loop time window')
assert.match(boundary, /CRASH_LOOP_LIMIT = 3/, 'boundary must pause repeated renderer crash loops')
assert.match(boundary, /role="alert"/, 'fallback must announce itself to assistive technology')
assert.match(boundary, /aria-live="assertive"/, 'fallback must announce crash recovery updates')
assert.match(boundary, /Reload Console/, 'fallback must offer a full reload recovery action')
assert.match(boundary, /Clear Crash Guard/, 'fallback must offer an explicit crash guard reset')
assert.match(boundary, /Retry Shell/, 'fallback must offer a render retry action')

assert.match(styles, /\.dy-error-boundary\s*\{[\s\S]*min-height:\s*100vh/, 'error fallback must cover the viewport')
assert.match(styles, /font-size:\s*14px/, 'error fallback body copy must use readable operator-console text')
assert.match(styles, /min-height:\s*36px/, 'error fallback controls must use accessible touch targets')

assert.match(packageJson.scripts?.['smoke:error-boundary'] || '', /smoke-error-boundary\.ts/, 'package must expose error-boundary smoke')
assert.match(packageJson.scripts?.['test:ci'] || '', /smoke:error-boundary/, 'test:ci must include error-boundary smoke')

console.log('renderer error boundary contract ok')
