import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

type Rgb = { r: number; g: number; b: number }

const root = process.cwd()
const tokensPath = path.join(root, 'src/styles/tokens.css')
const themePath = path.join(root, 'src/dystopai-app-theme.css')
const tokens = readFileSync(tokensPath, 'utf8')
const theme = readFileSync(themePath, 'utf8')

const requiredImports = [
  "@import './styles/tokens.css';",
  "@import './styles/typography.css';",
  "@import './styles/accessibility.css';",
  "@import './styles/dystopai-theme/00-foundation.css';",
]

for (let index = 0; index < requiredImports.length - 1; index += 1) {
  const current = theme.indexOf(requiredImports[index])
  const next = theme.indexOf(requiredImports[index + 1])
  assert.ok(current >= 0, `theme must import ${requiredImports[index]}`)
  assert.ok(next >= 0, `theme must import ${requiredImports[index + 1]}`)
  assert.ok(current < next, `${requiredImports[index]} must load before ${requiredImports[index + 1]}`)
}

const variables = new Map<string, string>()
for (const match of tokens.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  if (!variables.has(match[1])) variables.set(match[1], match[2])
}

function hexToRgb(hex: string): Rgb {
  const value = hex.slice(1)
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

function channel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(color: Rgb): number {
  return channel(color.r) * 0.2126 + channel(color.g) * 0.7152 + channel(color.b) * 0.0722
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(hexToRgb(foreground)), luminance(hexToRgb(background)))
  const darker = Math.min(luminance(hexToRgb(foreground)), luminance(hexToRgb(background)))
  return (lighter + 0.05) / (darker + 0.05)
}

const requiredPairs: [string, string, number][] = [
  ['text-primary', 'surface-0', 4.5],
  ['text-secondary', 'surface-0', 4.5],
  ['text-muted', 'surface-0', 4.5],
  ['text-subtle', 'surface-0', 4.5],
  ['text-primary', 'surface-1', 4.5],
  ['text-secondary', 'surface-1', 4.5],
  ['text-muted', 'surface-1', 4.5],
  ['accent-red', 'surface-0', 4.5],
  ['accent-yellow', 'surface-0', 4.5],
  ['accent-green', 'surface-0', 4.5],
  ['focus-ring', 'surface-0', 3],
  ['focus-ring', 'surface-1', 3],
]

const failures: string[] = []
for (const [foregroundToken, backgroundToken, minimum] of requiredPairs) {
  const foreground = variables.get(foregroundToken)
  const background = variables.get(backgroundToken)
  assert.ok(foreground, `missing --${foregroundToken}`)
  assert.ok(background, `missing --${backgroundToken}`)
  const ratio = contrast(foreground, background)
  if (ratio < minimum) {
    failures.push(`--${foregroundToken} on --${backgroundToken}: ${ratio.toFixed(2)} < ${minimum}`)
  }
}

assert.deepEqual(failures, [], `UI token contrast failures:\n${failures.join('\n')}`)
assert.match(tokens, /data-dui-high-contrast="true"/, 'tokens should expose high-contrast mode overrides')
assert.match(tokens, /data-dui-reduced-glow="true"/, 'tokens should expose reduced-glow mode overrides')
assert.match(tokens, /data-dui-density="compact"/, 'tokens should expose compact density')
assert.match(tokens, /data-dui-density="spacious"/, 'tokens should expose spacious density')

console.log('ui contrast token contract ok')
