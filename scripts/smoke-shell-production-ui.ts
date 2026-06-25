import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const shell = read('src/components/layout/NexusShell.tsx')
const polish = read('src/styles/dystopai-theme/80-production-polish.css')
const theme = read('src/dystopai-app-theme.css')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

assert.match(shell, /className="dy-skip-link" href="#dystopai-main"/, 'shell should expose a keyboard skip link')
assert.match(shell, /<main id="dystopai-main" tabIndex=\{-1\}/, 'workspace should use a focusable main landmark')
assert.match(shell, /<nav className="dy-human-nav flex flex-col" aria-label="Primary navigation">/, 'primary navigation should be named')
assert.match(shell, /dy-human-rail-head--lockup/, 'sidebar should host the full DystopAI logo lockup')
assert.match(shell, /className="dy-human-rail-lockup"/, 'sidebar logo should use the full lockup image')
assert.match(shell, /id=\{`nexus-tab-\$\{t\.id\}`\}/, 'workspace tabs should expose stable ids for automation')
assert.match(shell, /role="tab"[\s\S]*aria-selected=\{tab === t\.id\}/, 'workspace tabs should expose selected state')
assert.match(shell, /aria-controls=\{`nexus-panel-\$\{t\.id\}`\}/, 'workspace tabs should identify their active panel')
assert.match(shell, /role="region"[\s\S]*aria-label=\{`\$\{activeTab\.label\} workspace`\}/, 'active workspace should be a named region')
assert.doesNotMatch(shell, /dy-command-header/, 'shell should not render the retired top command header')
assert.doesNotMatch(shell, /className="dy-top-tabs/, 'shell should not render a duplicate hidden tab bar')
assert.match(shell, /aria-keyshortcuts=\{activeCronCount \? 'Delete'/, 'cron cleanup review should be keyboard discoverable')
assert.match(shell, /event\.key !== 'Delete'/, 'cron cleanup should support the declared keyboard shortcut')
assert.match(shell, /role="status" aria-live="polite" aria-label="Loading workspace"/, 'lazy workspace loading should be announced')
assert.match(shell, /className="dy-workspace-context" data-workspace=\{tab\}/, 'shell should expose a contextual workspace header')
assert.match(shell, /id="dystopai-workspace-title">\{activeTab\.label\}/, 'workspace context should expose the active page title')
assert.match(shell, /<p>\{activeTab\.description\}<\/p>/, 'workspace context should explain the active operator surface')
assert.match(shell, /className="dy-workspace-context__meta"/, 'workspace context should host the static status controls')
assert.match(shell, /aria-label="Workspace status summary"/, 'workspace status chips should remain named')
assert.match(shell, /className="dy-workspace-context__state"[\s\S]*role="status" aria-live="polite"/, 'workspace runtime state should be announced')

assert.match(polish, /\.dy-skip-link:focus-visible/, 'skip link should become visible on keyboard focus')
assert.match(polish, /:focus-visible[\s\S]*outline: 2px solid var\(--dui-focus-inner\)/, 'interactive controls should have a strong visible focus treatment')
assert.match(polish, /@media \(max-width: 900px\)[\s\S]*\.dy-human-rail[\s\S]*bottom:/, 'small screens should receive a bottom navigation dock')
assert.match(polish, /@media \(pointer: coarse\)[\s\S]*min-height: 44px/, 'coarse pointers should receive production-sized targets')
assert.match(polish, /@media \(prefers-reduced-motion: reduce\)/, 'motion should respect the operator preference')
assert.match(polish, /@media \(forced-colors: active\)/, 'focus treatment should survive forced-color modes')
assert.match(polish, /\.dy-workspace-context\[data-workspace="agents"\]/, 'agent workspace should have a dedicated visual accent')
assert.match(polish, /\.dy-workspace-context\[data-workspace="missions"\]/, 'mission workspace should have a dedicated visual accent')
assert.match(polish, /\.dy-workspace-context__state\[data-state="offline"\]/, 'offline runtime state should remain visually distinct')
assert.match(polish, /\.dy-human-rail-head--lockup[\s\S]*min-height: 84px/, 'sidebar lockup should reserve space for the full logo')
assert.match(polish, /\.dy-workspace-context__meta[\s\S]*flex-direction: column/, 'workspace status controls should live in the tab header')
assert.ok(theme.trimEnd().endsWith("@import './styles/dystopai-theme/80-production-polish.css';"), 'production polish must load last in the theme cascade')

assert.equal(packageJson.scripts?.['smoke:shell-production-ui'], 'tsx scripts/smoke-shell-production-ui.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:shell-production-ui'))

console.log('production shell UI contract ok')
