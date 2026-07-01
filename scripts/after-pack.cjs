const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function resolveWindowsCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function installWindowsElectronLauncher(root, context) {
  if (process.platform !== 'win32') return
  const electronSource = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const electronTarget = path.join(context.appOutDir, 'electron.exe')
  const launcherSource = path.join(root, 'scripts', 'windows-electron-launcher.cs')
  const launcherTarget = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const csc = resolveWindowsCsc()

  if (!fs.existsSync(electronSource)) {
    throw new Error(`[afterPack] Missing Electron runtime executable at ${electronSource}`)
  }
  if (!fs.existsSync(launcherSource)) {
    throw new Error(`[afterPack] Missing Windows launcher source at ${launcherSource}`)
  }
  if (!csc) {
    throw new Error('[afterPack] Could not find .NET Framework csc.exe needed to build the Windows launcher.')
  }

  fs.copyFileSync(electronSource, electronTarget)
  const result = spawnSync(csc, [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/reference:System.Windows.Forms.dll',
    `/out:${launcherTarget}`,
    launcherSource,
  ], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`[afterPack] Windows launcher build failed:\n${result.stdout || ''}\n${result.stderr || ''}`)
  }

  console.log(`[afterPack] installed Electron runtime -> ${electronTarget}`)
  console.log(`[afterPack] built Windows launcher -> ${launcherTarget}`)
}

function copyDirectorySync(source, target, label) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(target), { recursive: true })

  if (process.platform === 'win32') {
    const result = spawnSync('robocopy', [
      source,
      target,
      '/E',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
      '/NP',
      '/R:2',
      '/W:1',
    ], {
      encoding: 'utf8',
      windowsHide: true,
    })
    const status = result.status ?? 16
    if (status < 8) return
    throw new Error(`[afterPack] ${label} copy failed via robocopy (${status}):\n${result.stdout || ''}\n${result.stderr || ''}`)
  }

  fs.cpSync(source, target, { recursive: true })
}

function copyBundledExtensionSkills(root, resourcesDir) {
  const extensionsSource = path.join(root, 'vendor', 'openclaw', 'dist', 'extensions')
  const extensionsTarget = path.join(resourcesDir, 'openclaw', 'dist', 'extensions')
  if (!fs.existsSync(extensionsSource)) {
    throw new Error(`[afterPack] Missing vendored OpenClaw extensions at ${extensionsSource}`)
  }

  const copied = []
  for (const entry of fs.readdirSync(extensionsSource, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillSource = path.join(extensionsSource, entry.name, 'skills')
    if (!fs.existsSync(skillSource)) continue
    const skillTarget = path.join(extensionsTarget, entry.name, 'skills')
    copyDirectorySync(skillSource, skillTarget, `${entry.name} extension skills`)
    copied.push(entry.name)
  }

  if (copied.length) {
    console.log(`[afterPack] bundled OpenClaw extension skills (${copied.join(', ')}) -> ${extensionsTarget}`)
  }
}

function copyBundledNodeToolchain(root, resourcesDir) {
  const source = path.join(root, '.cache', 'runtime-bundles', 'toolchains', 'node')
  const target = path.join(resourcesDir, 'toolchains', 'node')
  if (!fs.existsSync(source)) {
    throw new Error(`[afterPack] Missing bundled Node/npm toolchain at ${source}; run npm run prepare:runtime-bundles first.`)
  }

  copyDirectorySync(source, target, 'Node/npm toolchain')
  console.log(`[afterPack] bundled Node/npm toolchain -> ${target}`)
}

function copyBundledCodexPlugin(root, resourcesDir) {
  const source = path.join(root, '.cache', 'runtime-bundles', 'openclaw-codex', 'codex')
  const target = path.join(resourcesDir, 'openclaw', 'dist', 'extensions', 'codex')
  const required = [
    path.join(source, 'package.json'),
    path.join(source, 'openclaw.plugin.json'),
    path.join(source, 'dist', 'index.js'),
    path.join(source, 'node_modules', '@openai', 'codex', 'package.json'),
  ]
  const missing = required.find((filePath) => !fs.existsSync(filePath))
  if (missing) {
    throw new Error(`[afterPack] Missing bundled Codex plugin artifact at ${missing}; run npm run prepare:runtime-bundles first.`)
  }

  copyDirectorySync(source, target, 'Codex plugin')
  console.log(`[afterPack] bundled Codex plugin -> ${target}`)
}

module.exports = async function afterPack(context) {
  const root = path.resolve(__dirname, '..')
  const source = path.join(root, 'vendor', 'openclaw', 'node_modules')
  const docsSource = path.join(root, 'vendor', 'openclaw', 'docs', 'reference', 'templates')
  const resourcesDir = process.platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')
  const target = path.join(resourcesDir, 'openclaw', 'node_modules')
  const docsTarget = path.join(resourcesDir, 'openclaw', 'docs', 'reference', 'templates')
  const json5 = path.join(target, 'json5', 'package.json')
  const agentsTemplate = path.join(docsTarget, 'AGENTS.md')

  if (!fs.existsSync(source)) {
    throw new Error(`[afterPack] Missing vendored OpenClaw node_modules at ${source}`)
  }
  if (!fs.existsSync(docsSource)) {
    throw new Error(`[afterPack] Missing vendored OpenClaw docs templates at ${docsSource}`)
  }

  copyDirectorySync(source, target, 'OpenClaw node_modules')
  copyDirectorySync(docsSource, docsTarget, 'OpenClaw docs templates')
  copyBundledExtensionSkills(root, resourcesDir)
  copyBundledNodeToolchain(root, resourcesDir)
  copyBundledCodexPlugin(root, resourcesDir)

  if (!fs.existsSync(json5)) {
    throw new Error(`[afterPack] OpenClaw dependency copy failed; missing ${json5}`)
  }
  if (!fs.existsSync(agentsTemplate)) {
    throw new Error(`[afterPack] OpenClaw docs copy failed; missing ${agentsTemplate}`)
  }

  console.log(`[afterPack] bundled OpenClaw node_modules -> ${target}`)
  console.log(`[afterPack] bundled OpenClaw docs templates -> ${docsTarget}`)
  installWindowsElectronLauncher(root, context)
}
