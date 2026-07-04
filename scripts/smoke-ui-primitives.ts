import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const button = read('src/components/ui/Button.tsx')
const buttonCss = read('src/components/ui/button.css')
const iconButton = read('src/components/ui/IconButton.tsx')
const iconButtonCss = read('src/components/ui/icon-button.css')
const panel = read('src/components/ui/Panel.tsx')
const panelCss = read('src/components/ui/panel.css')
const badge = read('src/components/ui/Badge.tsx')
const statusChip = read('src/components/ui/StatusChip.tsx')
const badgeCss = read('src/components/ui/badge.css')
const field = read('src/components/ui/Field.tsx')
const fieldCss = read('src/components/ui/field.css')
const index = read('src/components/ui/index.ts')

const cssFiles = [
  ['button.css', buttonCss],
  ['icon-button.css', iconButtonCss],
  ['panel.css', panelCss],
  ['badge.css', badgeCss],
  ['field.css', fieldCss],
] as const

for (const [name, css] of cssFiles) {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${name} should use PR43 semantic tokens instead of raw hex colors`)
  assert.doesNotMatch(css, /font-size:\s*(?:[0-9]|10(?:\.\d+)?)px\b/i, `${name} should not introduce sub-11px text`)
  assert.match(css, /letter-spacing:\s*0\b/, `${name} should not add negative/tiny tracking`)
  if (/transition:|animation:/.test(css)) {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, `${name} should honor reduced motion where transitions or animation exist`)
  }
}

for (const [name, css] of [
  ['button.css', buttonCss],
  ['icon-button.css', iconButtonCss],
  ['field.css', fieldCss],
] as const) {
  assert.match(css, /:focus-visible[\s\S]*outline:\s*2px solid var\(--focus-ring\)/, `${name} should expose token-backed focus-visible styling`)
}

assert.match(button, /export type ButtonVariant = 'primary' \| 'secondary' \| 'quiet' \| 'danger'/, 'Button should expose a constrained priority model')
assert.match(button, /loading \? <span className="dui-button__spinner" aria-hidden="true" \/> : null/, 'Button should expose a non-text loading affordance')
assert.match(button, /aria-busy=\{loading \? 'true' : undefined\}/, 'Button should announce loading state')
assert.match(buttonCss, /\.dui-button--size-primary[\s\S]*min-height:\s*var\(--control-height-primary\)/, 'Primary buttons should be at least 40px high')
assert.match(buttonCss, /\.dui-button--size-compact[\s\S]*min-height:\s*var\(--control-height-compact\)/, 'Compact buttons should stay at least 32px high')

assert.match(iconButton, /'aria-label': string/, 'IconButton should require an accessible name at the type boundary')
assert.match(iconButton, /title=\{title \?\? ariaLabel\}/, 'IconButton should expose the accessible name as a hover title by default')
assert.match(iconButtonCss, /min-width:\s*var\(--icon-button-size\)/, 'Icon buttons should reserve a 32px+ square target')
assert.match(iconButtonCss, /\.dui-icon-button--size-compact[\s\S]*min-width:\s*var\(--control-height-compact\)/, 'Compact icon buttons should remain 32px square')

assert.match(panel, /data-dui-panel="primitive"/, 'Panel should expose a stable primitive marker')
assert.match(panel, /aria-labelledby=\{ariaLabelledBy \?\? \(title \? titleId : undefined\)\}/, 'Panel should connect visible titles to region labels')
assert.match(panelCss, /border-radius:\s*var\(--radius-md\)/, 'Panel should keep card radius within the local token system')
assert.match(panelCss, /font-size:\s*var\(--dy-type-title, var\(--font-size-lg\)\)/, 'Panel titles should use 16px+ title tokens')

assert.match(badge, /export type BadgeTone = 'neutral' \| 'info' \| 'success' \| 'warning' \| 'error'/, 'Badge should expose semantic status tones')
assert.match(statusChip, /aria-label=\{accessibleLabel\}/, 'StatusChip should not communicate state by color alone')
assert.match(statusChip, /<span className="dui-status-chip__label dy-status-label">\{label\}<\/span>/, 'StatusChip should render a visible state label with the legacy shell styling hook')
assert.match(statusChip, /<span className="dui-status-chip__value dy-status-value">\{visibleValue\}<\/span>/, 'StatusChip should render a visible state value with the legacy shell styling hook')
assert.match(badgeCss, /\.dui-badge--micro[\s\S]*font-size:\s*var\(--font-size-2xs\)/, 'Micro badges should bottom out at the 11px token')
assert.match(badgeCss, /\.dui-badge--success[\s\S]*--dui-badge-accent:\s*var\(--accent-green\)/, 'Success state should use semantic tokens plus visible text')
assert.match(badgeCss, /\.dui-badge--warning[\s\S]*--dui-badge-accent:\s*var\(--accent-yellow\)/, 'Warning state should use semantic tokens plus visible text')
assert.match(badgeCss, /\.dui-badge--error[\s\S]*--dui-badge-accent:\s*var\(--accent-red\)/, 'Error state should use semantic tokens plus visible text')

assert.match(field, /<label className="dui-field__label" htmlFor=\{controlId\}>/, 'Field should connect labels with controls')
assert.match(field, /'aria-describedby': describedBy/, 'Field should connect hint and error text')
assert.match(field, /role="alert"/, 'Field errors should be announced')
assert.match(fieldCss, /\.dui-field__label[\s\S]*font-size:\s*var\(--font-size-sm\)/, 'Field labels should be at least 13px')
assert.match(fieldCss, /min-height:\s*var\(--control-height-default\)/, 'Field controls should be at least 36px high')
assert.match(fieldCss, /\.dui-field__hint,[\s\S]*font-size:\s*var\(--font-size-xs\)/, 'Field hints/errors should be at least 12px')

for (const exported of ['Button', 'IconButton', 'Panel', 'Badge', 'StatusChip', 'Field', 'Input', 'Select', 'Textarea']) {
  assert.match(index, new RegExp(`export \\{[^}]*${exported}`), `index.ts should export ${exported}`)
}

console.log('ui primitive contracts ok')
