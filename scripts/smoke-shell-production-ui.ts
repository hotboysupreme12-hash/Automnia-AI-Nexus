import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const shell = read('src/components/layout/NexusShell.tsx')
const settingsPanel = read('src/components/settings/SettingsPanel.tsx')
const uiSettings = read('src/components/settings/uiSettings.ts')
const missionPanel = read('src/components/mission/MissionDeploymentPanel.tsx')
const missionPanelCss = read('src/components/mission/MissionDeploymentPanel.css')
const monitorPanel = read('src/components/monitor/LiveOperationMonitor.tsx')
const commandConsole = read('src/components/monitor/AgentResponseConsole.tsx')
const pluginsPanel = read('src/components/plugins/PluginsPanel.tsx')
const recruitModal = read('src/components/recruit/RecruitAgentModal.tsx')
const accessibility = read('src/styles/accessibility.css')
const polish = read('src/styles/automnia-theme/80-production-polish.css')
const theme = read('src/automnia-app-theme.css')
const phaseKSettingsPersistenceSmoke = read('scripts/smoke-phase-k-settings-persistence.ts')
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
const productionPolishImport = "@import './styles/automnia-theme/80-production-polish.css';"
const referenceScreenshotImport = "@import './styles/automnia-theme/90-reference-screenshot.css';"
const typographyPolishImport = "@import './styles/automnia-theme/95-typography-polish.css';"
const navSelectionGlowImport = "@import './styles/automnia-theme/96-nav-selection-glow.css';"
const chatComposerImport = "@import './styles/automnia-theme/97-chat-composer.css';"
const flattenedShellImport = "@import './styles/automnia-theme/98-flattened-shell.css';"
const horizonCommandCenterImport = "@import './styles/automnia-theme/99-horizon-command-center.css';"
const operatorExperienceImport = "@import './styles/automnia-theme/100-operator-experience.css';"
const agentCardThemesImport = "@import './styles/automnia-theme/101-agent-card-themes.css';"
const settingsSystemImport = "@import './styles/automnia-theme/102-settings-system.css';"
const cronJobsSystemImport = "@import './styles/automnia-theme/103-cron-jobs-system.css';"
const horizonCommandCenter = read('src/styles/automnia-theme/99-horizon-command-center.css')
const operatorExperience = read('src/styles/automnia-theme/100-operator-experience.css')

assert.match(shell, /className="dy-skip-link" href="#automnia-main"/, 'shell should expose a keyboard skip link')
assert.match(shell, /<main id="automnia-main" tabIndex=\{-1\}/, 'workspace should use a focusable main landmark')
assert.match(shell, /<nav className="dy-human-nav flex flex-col" aria-label="Primary navigation">/, 'primary navigation should be named')
assert.match(shell, /dy-human-rail-head--lockup/, 'sidebar should host the full Automnia logo lockup')
assert.match(shell, /className="dy-human-rail-lockup"/, 'sidebar logo should use the full lockup image')
assert.match(shell, /id=\{`nexus-nav-\$\{t\.id\}`\}/, 'workspace navigation should expose stable ids for automation')
const primaryRailBlock = shell.slice(
  shell.indexOf('<nav className="dy-human-nav flex flex-col" aria-label="Primary navigation">'),
  shell.indexOf('<div className="dy-human-rail-bottom">'),
)
const utilityRailBlock = shell.slice(
  shell.indexOf('<nav className="dy-human-nav dy-human-nav--utility flex flex-col" aria-label="Utility navigation">'),
  shell.indexOf('</nav>', shell.indexOf('<nav className="dy-human-nav dy-human-nav--utility flex flex-col" aria-label="Utility navigation">')),
)
assert.doesNotMatch(primaryRailBlock, /role="tab"/, 'rail navigation should not advertise a tab role')
assert.doesNotMatch(primaryRailBlock, /role="tablist"/, 'primary rail should not advertise a tablist role')
assert.doesNotMatch(primaryRailBlock, /aria-selected=/, 'rail navigation should not advertise tab selection state')
assert.doesNotMatch(primaryRailBlock, /aria-controls=/, 'rail navigation should not advertise tab panel controls')
assert.match(primaryRailBlock, /aria-current=\{tab === t\.id \? 'page' : undefined\}/, 'active rail destination should use aria-current page')
assert.doesNotMatch(utilityRailBlock, /role="tab"/, 'utility rail should not advertise a tab role')
assert.doesNotMatch(utilityRailBlock, /role="tablist"/, 'utility rail should not advertise a tablist role')
assert.doesNotMatch(utilityRailBlock, /aria-selected=/, 'utility rail should not advertise tab selection state')
assert.doesNotMatch(utilityRailBlock, /aria-controls=/, 'utility rail should not advertise tab panel controls')
assert.match(utilityRailBlock, /id="nexus-nav-settings"/, 'settings utility navigation should expose a stable automation id')
assert.match(utilityRailBlock, /aria-current=\{tab === 'settings' \? 'page' : undefined\}/, 'settings navigation should use aria-current page when active')
assert.match(shell, /role="region"[\s\S]*aria-label=\{`\$\{activeTab\.label\} workspace`\}/, 'active workspace should be a named region')
assert.match(shell, /id=\{`nexus-workspace-\$\{tab\}`\}/, 'workspace region should use a workspace id, not a tab id')
assert.doesNotMatch(shell, /nexus-tab-/, 'shell should not expose tab-oriented workspace navigation ids')
assert.doesNotMatch(shell, /nexus-panel-/, 'shell should not expose tab-panel-oriented workspace ids')
assert.doesNotMatch(shell, /dy-command-header/, 'shell should not render the retired top command header')
assert.doesNotMatch(shell, /className="dy-top-tabs/, 'shell should not render a duplicate hidden tab bar')
assert.match(shell, /aria-keyshortcuts=\{activeCronCount \? 'Delete'/, 'cron cleanup review should be keyboard discoverable')
assert.match(shell, /event\.key !== 'Delete'/, 'cron cleanup should support the declared keyboard shortcut')
assert.match(shell, /role="status" aria-live="polite" aria-label="Loading workspace"/, 'lazy workspace loading should be announced')
assert.match(shell, /className="dy-workspace-context" data-workspace=\{tab\}/, 'shell should expose a contextual workspace header')
assert.match(shell, /id="automnia-workspace-title">\{activeTab\.label\}/, 'workspace context should expose the active page title')
assert.match(shell, /<p>\{activeTab\.description\}<\/p>/, 'workspace context should explain the active operator surface')
assert.match(shell, /className="dy-workspace-context__meta"/, 'workspace context should host the static status controls')
assert.match(shell, /aria-label="Workspace status summary"/, 'workspace status chips should remain named')
assert.match(shell, /import \{ Button, StatusChip \} from '..\/ui'/, 'shell rail actions and workspace status chips should use local UI primitives')
assert.match(primaryRailBlock, /<Button[\s\S]*data-tone="recruit"/, 'recruit rail action should use the Button primitive')
assert.match(primaryRailBlock, /<Button[\s\S]*id=\{`nexus-nav-\$\{t\.id\}`\}/, 'primary rail destinations should use the Button primitive')
assert.doesNotMatch(primaryRailBlock, /<kbd\b/, 'rail destinations should not crowd labels with visible keyboard shortcut badges')
assert.match(utilityRailBlock, /<Button[\s\S]*id="nexus-nav-settings"/, 'settings rail action should use the Button primitive')
assert.match(utilityRailBlock, /data-tone="settings"/, 'settings should retain its dedicated navigation identity')
assert.doesNotMatch(utilityRailBlock, /<kbd\b/, 'utility rail should not crowd labels with visible keyboard shortcut badges')
assert.match(shell, /<Button[\s\S]*className="dy-console-toggle"/, 'agent console header toggle should use the Button primitive')
assert.match(shell, /aria-pressed=\{isAgentConsoleVisible\}/, 'console toggle pressed state should report the actual console visibility')
assert.match(shell, /className="dy-console-toggle"[\s\S]*onClick=\{\(\) => \{\s*setAgentConsoleVisible\(\(visible\) => !visible\)\s*\}\}/, 'console toggle should use the Button click interaction without duplicate pointer or keyboard handlers')
for (const indicator of ['agents', 'party', 'running', 'gateway', 'results']) {
  assert.match(shell, new RegExp(`<StatusChip[\\s\\S]*data-indicator="${indicator}"`), `${indicator} workspace status should be rendered through StatusChip`)
}
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
assert.match(polish, /\.app-bg > \.dy-app-main[\s\S]*width: 100vw !important/, 'desktop shell should fill the available viewport width')
assert.doesNotMatch(polish, /\.app-bg > \.dy-app-main[\s\S]*width: min\(100%, 1780px\)/, 'desktop shell should not cap wide windows')
assert.match(polish, /\.dy-human-rail-head--lockup[\s\S]*min-height: 98px/, 'sidebar lockup should reserve space for the full logo')
assert.match(polish, /\.dy-workspace-context__meta[\s\S]*flex-direction: column/, 'workspace status controls should live in the tab header')
assert.ok(theme.includes(productionPolishImport), 'production polish must remain in the theme cascade')
assert.ok(theme.includes(referenceScreenshotImport), 'reference screenshot polish must remain in the theme cascade')
assert.ok(theme.includes(typographyPolishImport), 'typography polish must remain in the theme cascade')
assert.ok(theme.includes(navSelectionGlowImport), 'nav selection glow must remain in the theme cascade')
assert.ok(theme.includes(chatComposerImport), 'chat composer polish must remain in the theme cascade')
assert.ok(theme.includes(flattenedShellImport), 'flattened shell polish must remain in the theme cascade')
assert.ok(theme.includes(horizonCommandCenterImport), 'Horizon Command Center must remain the final global visual layer')
assert.ok(theme.includes(operatorExperienceImport), 'Operator Experience must remain the final global refinement layer')
assert.ok(theme.includes(agentCardThemesImport), 'Agent Card Themes must remain in the theme cascade')
assert.ok(theme.includes(settingsSystemImport), 'Settings System must remain the final scoped settings and autosave layer')
assert.ok(theme.includes(cronJobsSystemImport), 'Cron Jobs System must remain in the theme cascade')
const themeLayerImports = [...theme.matchAll(/@import '\.\/styles\/automnia-theme\/(\d+)-([^']+)\.css';/g)]
const layersAfterTypography = themeLayerImports
  .map((match) => ({ order: Number(match[1]), name: match[2] }))
  .filter((layer) => layer.order > 95)
assert.deepEqual(layersAfterTypography, [
  { order: 96, name: 'nav-selection-glow' },
  { order: 97, name: 'chat-composer' },
  { order: 98, name: 'flattened-shell' },
  { order: 99, name: 'horizon-command-center' },
  { order: 100, name: 'operator-experience' },
  { order: 101, name: 'agent-card-themes' },
  { order: 102, name: 'settings-system' },
  { order: 103, name: 'cron-jobs-system' },
], 'global automnia theme layers after typography must remain limited to the approved shell, operator, card, settings, and cron layers')
assert.doesNotMatch(theme, /99-mission-quiet-redesign/, 'mission quiet redesign should no longer be a global late layer')
assert.ok(
  theme.indexOf(productionPolishImport) < theme.indexOf(referenceScreenshotImport),
  'production polish must load before the final reference screenshot layer',
)
assert.ok(
  theme.indexOf(referenceScreenshotImport) < theme.indexOf(typographyPolishImport),
  'reference screenshot polish must load before the final typography layer',
)
assert.ok(theme.indexOf(typographyPolishImport) < theme.indexOf(navSelectionGlowImport), 'typography polish must load before nav-selection glow')
assert.ok(theme.indexOf(navSelectionGlowImport) < theme.indexOf(chatComposerImport), 'nav-selection glow must load before chat composer polish')
assert.ok(theme.indexOf(chatComposerImport) < theme.indexOf(flattenedShellImport), 'chat composer polish must load before flattened shell polish')
assert.ok(theme.indexOf(flattenedShellImport) < theme.indexOf(horizonCommandCenterImport), 'flattened shell polish must load before Horizon Command Center')
assert.ok(theme.indexOf(horizonCommandCenterImport) < theme.indexOf(operatorExperienceImport), 'Horizon Command Center must load before Operator Experience')
assert.ok(theme.indexOf(operatorExperienceImport) < theme.indexOf(agentCardThemesImport), 'Operator Experience must load before Agent Card Themes')
assert.ok(theme.indexOf(agentCardThemesImport) < theme.indexOf(settingsSystemImport), 'Agent Card Themes must load before the scoped Settings System')
assert.ok(theme.indexOf(settingsSystemImport) < theme.indexOf(cronJobsSystemImport), 'Settings System must load before the scoped Cron Jobs System')
assert.ok(theme.trimEnd().endsWith(cronJobsSystemImport), 'Cron Jobs System must load last in the theme cascade')
assert.match(operatorExperience, /\.dui-recruit-code-editor:focus-within[\s\S]*#071012 !important/, 'focused recruit Markdown editing must retain its dedicated contrast treatment')
assert.match(horizonCommandCenter, /Each destination has a dedicated hue/, 'navigation selection should document the workspace identity system')
for (const [tone, accent] of [
  ['recruit', '#f17d72'],
  ['agents', '#66aee7'],
  ['missions', '#e5b967'],
  ['monitor', '#60d9cb'],
  ['plugins', '#ad8ae8'],
  ['settings', '#7ec5ad'],
] as const) {
  assert.match(
    horizonCommandCenter,
    new RegExp(`\\[data-tone="${tone}"\\][\\s\\S]*?--horizon-nav-accent: ${accent.replace('#', '\\#')}`),
    `${tone} should retain its selected navigation accent`,
  )
}
assert.match(horizonCommandCenter, /right: 9px !important;/, 'active navigation should use a compact right-side identity dot')
assert.match(horizonCommandCenter, /old left-edge chip/, 'active navigation must not restore the retired left-edge chip')
assert.match(horizonCommandCenter, /box-shadow: none !important;/, 'active navigation should suppress the legacy colored inset marker')
assert.match(operatorExperience, /Operator Experience refinement suite/, 'final design layer should document its operator-focused ownership')
assert.match(operatorExperience, /content: none !important;/, 'workspace title chrome should not reintroduce a decorative eyebrow or title line')
assert.match(operatorExperience, /\.party-slot-empty[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;/, 'empty party slots should not draw a second dashed frame around their label')
assert.match(operatorExperience, /\.dy-command-composer__field[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/, 'composer text should not sit inside a redundant dark inline box')
assert.match(recruitModal, /function defaultRecruitResourceFiles\(\)/, 'recruit modal should define Markdown defaults before the dialog opens')
assert.match(recruitModal, /useState<Record<string, string>>\(defaultRecruitResourceFiles\)/, 'recruit modal should render the selected Markdown document with an immediate default value')
assert.match(operatorExperience, /Recruit Markdown editor:[\s\S]*?grid-template-rows: auto auto auto minmax\(0, 1fr\) !important;/, 'recruit Markdown layout should reserve a distinct grid row for the file toolbar and editor')
assert.match(operatorExperience, /Recruit Markdown legibility and file-tab alignment[\s\S]*?\.dui-recruit-code-input:focus-visible[\s\S]*?background-color: transparent !important;/, 'recruit Markdown input should remain transparent on focus so the highlighted preview stays legible')
assert.match(operatorExperience, /\.dui-recruit-file-tabs button\[data-md-tone\]::before[\s\S]*?content: none !important;[\s\S]*?display: none !important;/, 'recruit Markdown tabs should suppress the retired decorative pseudo-icon')
assert.match(operatorExperience, /grid-template-columns: 20px minmax\(0, 1fr\) 28px !important;/, 'recruit Markdown tabs should align one document icon, filename, and MD badge')
assert.match(missionPanel, /import '\.\/MissionDeploymentPanel\.css'/, 'mission late overrides should be owned by the mission component')
assert.match(monitorPanel, /import \{ Badge, Button, IconButton, StatusChip \} from '\.\.\/ui'/, 'Monitor controls and status chips should use local UI primitives')
assert.match(monitorPanel, /data-ui-revision="cron-job-v2"/, 'Active cron cards should expose the upgraded presentation contract')
assert.match(monitorPanel, /className="dy-cron-job-glyph"/, 'Active cron cards should expose a glanceable schedule glyph')
assert.match(monitorPanel, /<span>Current instruction<\/span>/, 'Active cron cards should label their current instruction clearly')
assert.match(commandConsole, /import \{ Badge, Button, IconButton, StatusChip \} from '\.\.\/ui'/, 'Command Console controls and runtime chips should use local UI primitives')
assert.match(missionPanel, /import \{ Badge, Button, StatusChip \} from '\.\.\/ui'/, 'Mission action rows and mission status should use local UI primitives')
assert.match(pluginsPanel, /import \{ Badge, Button, IconButton, StatusChip \} from '\.\.\/ui'/, 'Plugin action rows and summary chips should use local UI primitives')
for (const [sourceName, source, primitive] of [
  ['Monitor', monitorPanel, 'Button'],
  ['Monitor', monitorPanel, 'IconButton'],
  ['Monitor', monitorPanel, 'StatusChip'],
  ['Monitor', monitorPanel, 'Badge'],
  ['Command Console', commandConsole, 'Button'],
  ['Command Console', commandConsole, 'IconButton'],
  ['Command Console', commandConsole, 'StatusChip'],
  ['Command Console', commandConsole, 'Badge'],
  ['Missions', missionPanel, 'Button'],
  ['Missions', missionPanel, 'StatusChip'],
  ['Missions', missionPanel, 'Badge'],
  ['Plugins', pluginsPanel, 'Button'],
  ['Plugins', pluginsPanel, 'IconButton'],
  ['Plugins', pluginsPanel, 'StatusChip'],
  ['Plugins', pluginsPanel, 'Badge'],
] as const) {
  assert.match(source, new RegExp(`<${primitive}\\b`), `${sourceName} should render ${primitive} primitives`)
}
assert.match(missionPanelCss, /Component-owned mission pass/, 'mission component CSS should explain its ownership')
assert.doesNotMatch(missionPanelCss, /font-size:\s*(?:[0-9]|10(?:\.\d+)?)px\b/, 'mission component CSS should not reintroduce sub-11px text')
assert.match(accessibility, /:focus-visible[\s\S]*outline: 2px solid var\(--focus-ring\)/, 'token-backed focus rings should stay visible on dark surfaces')
assert.match(accessibility, /:focus-visible[\s\S]*var\(--focus-ring-shadow\)/, 'focus rings should include a dark-surface halo')
assert.match(accessibility, /data-dui-motion="reduced"[\s\S]*transition-duration: 0\.001ms/, 'explicit reduced-motion mode should collapse transitions')
assert.match(accessibility, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.001ms/, 'OS reduced-motion preference should collapse animations')
assert.match(settingsPanel, /data-dui-setting="density"/, 'Settings density control should expose a stable automation selector')
assert.match(settingsPanel, /data-dui-setting="motion"/, 'Settings motion control should expose a stable automation selector')
assert.match(settingsPanel, /saveUiSettings\(next\)[\s\S]*applyUiSettings\(next\)/, 'Settings changes should persist before applying root UI state')
assert.match(uiSettings, /UI_SETTINGS_STORAGE_KEY = 'automnia-ui-settings-v1'/, 'UI settings storage key should remain stable for rehydration')
assert.match(uiSettings, /root\.dataset\.duiDensity = settings\.density/, 'UI settings should project density to the document root')
assert.match(uiSettings, /root\.dataset\.duiMotion = settings\.motion/, 'UI settings should project motion to the document root')
assert.match(phaseKSettingsPersistenceSmoke, /completedItems:\s*\[130\]/, 'Phase K Settings persistence smoke should record item 130 completion')
assert.match(phaseKSettingsPersistenceSmoke, /reloadIgnoringCache/, 'Phase K Settings persistence smoke should verify persistence across renderer reload')
assert.match(phaseKSettingsPersistenceSmoke, /evidenceHasSecretMaterial/, 'Phase K Settings persistence smoke should guard evidence against credential material')

assert.equal(packageJson.scripts?.['smoke:shell-production-ui'], 'tsx scripts/smoke-shell-production-ui.ts')
assert.equal(packageJson.scripts?.['smoke:phase-k-settings-persistence'], 'tsx scripts/smoke-phase-k-settings-persistence.ts')
assert.ok(packageJson.scripts?.['test:ci']?.includes('npm run smoke:shell-production-ui'))

console.log('production shell UI contract ok')
