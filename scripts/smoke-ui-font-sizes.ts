import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const theme = read('src/automnia-app-theme.css')
const typography = read('src/styles/typography.css')
const finalTypography = read('src/styles/automnia-theme/95-typography-polish.css')
const missionPanelCss = read('src/components/mission/MissionDeploymentPanel.css')
const monitorTypographySources: [string, string][] = [
  ['src/components/monitor/LiveOperationMonitor.tsx', read('src/components/monitor/LiveOperationMonitor.tsx')],
  ['src/components/monitor/AgentResponseConsole.tsx', read('src/components/monitor/AgentResponseConsole.tsx')],
]

const typographyImport = "@import './styles/typography.css';"
const foundationImport = "@import './styles/automnia-theme/00-foundation.css';"
const finalTypographyImport = "@import './styles/automnia-theme/95-typography-polish.css';"
const horizonCommandCenterImport = "@import './styles/automnia-theme/99-horizon-command-center.css';"

assert.ok(theme.includes(typographyImport), 'theme should import typography tokens')
assert.ok(theme.includes(foundationImport), 'theme should import legacy foundation after typography tokens')
assert.ok(theme.includes(finalTypographyImport), 'theme should import final typography compatibility layer')
assert.ok(theme.includes(horizonCommandCenterImport), 'theme should import the final Horizon Command Center visual layer')
assert.ok(
  theme.indexOf(typographyImport) < theme.indexOf(foundationImport),
  'typography tokens must load before legacy theme files',
)
assert.ok(
  theme.indexOf(finalTypographyImport) < theme.indexOf(horizonCommandCenterImport),
  'typography compatibility layer must load before the final Horizon Command Center visual layer',
)

function readPxVariable(source: string, name: string): number {
  const match = source.match(new RegExp(`--${name}:\\s*([0-9]+(?:\\.[0-9]+)?)px\\s*;`))
  assert.ok(match, `missing --${name}`)
  return Number.parseFloat(match[1])
}

const tokenMinimums: [string, number][] = [
  ['font-size-2xs', 11],
  ['font-size-xs', 12],
  ['font-size-sm', 13],
  ['font-size-md', 14],
  ['font-size-lg', 16],
  ['font-size-xl', 20],
  ['font-size-2xl', 24],
  ['font-size-3xl', 32],
]

for (const [token, minimum] of tokenMinimums) {
  const value = readPxVariable(typography, token)
  assert.ok(value >= minimum, `--${token} must be at least ${minimum}px, got ${value}px`)
}

assert.match(typography, /--dy-type-micro:\s*var\(--font-size-2xs\);/, 'micro type must resolve through the 11px token')
assert.match(typography, /--dy-type-caption:\s*var\(--font-size-xs\);/, 'caption type must resolve through the 12px token')
assert.match(typography, /--dy-type-small:\s*var\(--font-size-sm\);/, 'small type must resolve through the 13px token')
assert.match(typography, /--dy-type-ui:\s*var\(--font-size-md\);/, 'body UI type must resolve through the 14px token')

function blockContaining(source: string, needle: string): string {
  const needleIndex = source.indexOf(needle)
  assert.ok(needleIndex >= 0, `missing selector fragment ${needle}`)
  const blockStart = source.lastIndexOf('html.dui-pro-overhaul', needleIndex)
  const openBrace = source.indexOf('{', needleIndex)
  const closeBrace = source.indexOf('}', openBrace)
  assert.ok(blockStart >= 0 && openBrace >= 0 && closeBrace > openBrace, `could not parse block for ${needle}`)
  return source.slice(blockStart, closeBrace + 1)
}

const legacyMicroClassBlock = blockContaining(finalTypography, '[class*="text-[6px]"]')
for (const size of ['6', '6.5', '6.8', '7', '7.25', '7.5', '7.75', '8', '8.5']) {
  assert.ok(
    legacyMicroClassBlock.includes(`[class*="text-[${size}px]"]`),
    `legacy text-[${size}px] utilities should be raised by the final typography layer`,
  )
}
assert.match(
  legacyMicroClassBlock,
  /font-size:\s*var\(--dy-type-micro\)\s*!important;/,
  'legacy 6px-8.5px utility classes should resolve to the 11px micro type token',
)

const captionClassBlock = blockContaining(finalTypography, '[class*="text-[9px]"]')
assert.ok(captionClassBlock.includes('[class*="text-[10px]"]'), 'legacy text-[10px] utilities should be raised')
assert.match(
  captionClassBlock,
  /font-size:\s*var\(--dy-type-caption\)\s*!important;/,
  'legacy 9px-10px utility classes should resolve to the 12px caption type token',
)

const smallClassBlock = blockContaining(finalTypography, '[class*="text-[11px]"]')
assert.match(
  smallClassBlock,
  /font-size:\s*var\(--dy-type-small\)\s*!important;/,
  'legacy 11px utility classes should resolve to the 13px small type token',
)

const controlClassBlock = blockContaining(finalTypography, '[class*="text-[12px]"]')
assert.match(
  controlClassBlock,
  /font-size:\s*var\(--dy-type-control\)\s*!important;/,
  'legacy 12px utility classes should resolve to the control type token',
)

const explicitFinalMicrotype: string[] = []
for (const [relativePath, source] of [
  ['src/styles/automnia-theme/95-typography-polish.css', finalTypography],
  ['src/components/mission/MissionDeploymentPanel.css', missionPanelCss],
] as const) {
  for (const match of source.matchAll(/font-size:\s*([0-9]+(?:\.[0-9]+)?)px\b/g)) {
    const value = Number.parseFloat(match[1])
    if (value < 11) {
      const line = source.slice(0, match.index).split(/\r?\n/).length
      explicitFinalMicrotype.push(`${relativePath}:${line} uses ${value}px`)
    }
  }
}

assert.deepEqual(
  explicitFinalMicrotype,
  [],
  `final typography and component-owned mission CSS must not reintroduce explicit font-size values below 11px:\n${explicitFinalMicrotype.join('\n')}`,
)

const monitorSourceMicrotype: string[] = []
for (const [relativePath, source] of monitorTypographySources) {
  for (const match of source.matchAll(/text-\[([0-9]+(?:\.[0-9]+)?)px\]/g)) {
    const value = Number.parseFloat(match[1])
    if (value < 11) {
      const line = source.slice(0, match.index).split(/\r?\n/).length
      monitorSourceMicrotype.push(`${relativePath}:${line} uses text-[${match[1]}px]`)
    }
  }
}

assert.deepEqual(
  monitorSourceMicrotype,
  [],
  `monitor and command console source must not depend on legacy sub-11px text utilities:\n${monitorSourceMicrotype.join('\n')}`,
)

console.log('ui font-size typography contract ok')
