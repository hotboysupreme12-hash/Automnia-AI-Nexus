const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const cacheRoot = path.join(root, '.cache')
const electronCache = path.join(cacheRoot, 'electron')
const builderCache = path.join(cacheRoot, 'electron-builder')
const npmToolchainRoot = path.join(cacheRoot, 'npm-toolchain', 'node_modules', 'npm')
const npmBin = path.join(cacheRoot, 'npm-bin')
const nodeModulesBin = path.join(root, 'node_modules', '.bin')

fs.mkdirSync(electronCache, { recursive: true })
fs.mkdirSync(builderCache, { recursive: true })

function ensureLocalNpmBin() {
  const npmCli = path.join(npmToolchainRoot, 'bin', 'npm-cli.js')
  const npxCli = path.join(npmToolchainRoot, 'bin', 'npx-cli.js')
  if (!fs.existsSync(npmCli) || !fs.existsSync(npxCli)) return null

  fs.mkdirSync(npmBin, { recursive: true })
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(npmBin, 'npm.cmd'),
      [
        '@echo off',
        'setlocal',
        'set "NPM_BIN_DIR=%~dp0"',
        'set "NPM_CLI=%NPM_BIN_DIR%..\\npm-toolchain\\node_modules\\npm\\bin\\npm-cli.js"',
        'if defined NODE_EXE (',
        '  "%NODE_EXE%" "%NPM_CLI%" %*',
        ') else (',
        '  node "%NPM_CLI%" %*',
        ')',
        '',
      ].join('\r\n'),
    )
    fs.writeFileSync(
      path.join(npmBin, 'npx.cmd'),
      [
        '@echo off',
        'setlocal',
        'set "NPM_BIN_DIR=%~dp0"',
        'set "NPX_CLI=%NPM_BIN_DIR%..\\npm-toolchain\\node_modules\\npm\\bin\\npx-cli.js"',
        'if defined NODE_EXE (',
        '  "%NODE_EXE%" "%NPX_CLI%" %*',
        ') else (',
        '  node "%NPX_CLI%" %*',
        ')',
        '',
      ].join('\r\n'),
    )
  } else {
    fs.writeFileSync(
      path.join(npmBin, 'npm'),
      [
        '#!/usr/bin/env sh',
        'DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
        'CLI="$DIR/../npm-toolchain/node_modules/npm/bin/npm-cli.js"',
        'exec "${NODE_EXE:-node}" "$CLI" "$@"',
        '',
      ].join('\n'),
    )
    fs.writeFileSync(
      path.join(npmBin, 'npx'),
      [
        '#!/usr/bin/env sh',
        'DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
        'CLI="$DIR/../npm-toolchain/node_modules/npm/bin/npx-cli.js"',
        'exec "${NODE_EXE:-node}" "$CLI" "$@"',
        '',
      ].join('\n'),
    )
    fs.chmodSync(path.join(npmBin, 'npm'), 0o755)
    fs.chmodSync(path.join(npmBin, 'npx'), 0o755)
  }

  return npmBin
}

const localNpmBin = ensureLocalNpmBin()
const pathDelimiter = process.platform === 'win32' ? ';' : ':'
const pathEntries = [
  localNpmBin,
  fs.existsSync(nodeModulesBin) ? nodeModulesBin : '',
  process.env.PATH || '',
].filter(Boolean)
const electronBuilderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js')
const openClawVendorPrep = path.join(root, 'scripts', 'prepare-openclaw-vendor.cjs')
const command = process.execPath
const requestedArgs = process.argv.slice(2)
const unsignedDirectoryPackage = requestedArgs.includes('--unsigned') || process.env.AUTOMNIA_SKIP_PLATFORM_SIGNING === '1'
const forwardedArgs = requestedArgs.filter((arg) => arg !== '--unsigned')
const hasPublishMode = forwardedArgs.some((arg, index) => arg === '--publish' || arg.startsWith('--publish=') || forwardedArgs[index - 1] === '--publish')
const publishArgs = hasPublishMode ? [] : ['--publish', 'never']
const signingOverrideArgs = unsignedDirectoryPackage
  ? [
      '--config.win.signAndEditExecutable=false',
    ]
  : []

function runChecked(label, executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: options.stdio || 'inherit',
    shell: false,
    windowsHide: true,
    ...options,
  })
  if (result.status === 0) return result
  const detail = result.error ? `: ${result.error.message}` : ''
  throw new Error(`${label} failed${detail}`)
}

function packageJson() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
}

function macArchLabel() {
  if (forwardedArgs.includes('--x64')) return 'x64'
  if (forwardedArgs.includes('--arm64')) return 'arm64'
  if (forwardedArgs.includes('--universal')) return 'universal'
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

function findBuiltMacApp(productName) {
  const releaseDir = path.join(root, 'release')
  if (!fs.existsSync(releaseDir)) return null
  const candidates = fs.readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
    .map((entry) => path.join(releaseDir, entry.name, `${productName}.app`))
    .filter((candidate) => fs.existsSync(candidate))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  return candidates[0] || null
}

function macElectronFrameworkBinary(appPath) {
  return path.join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Electron Framework',
  )
}

function detachDmgMount(mountDir) {
  const result = spawnSync('hdiutil', ['detach', mountDir, '-quiet'], {
    cwd: root,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
  })
  if (result.status === 0) return
  spawnSync('hdiutil', ['detach', mountDir, '-force', '-quiet'], {
    cwd: root,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
  })
}

function macDmgContainsElectronFramework(dmgPath, productName) {
  const mountDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-dmg-check-'))
  try {
    runChecked('mount mac DMG', 'hdiutil', ['attach', dmgPath, '-mountpoint', mountDir, '-nobrowse', '-readonly', '-quiet'])
    const frameworkBinary = macElectronFrameworkBinary(path.join(mountDir, `${productName}.app`))
    return fs.existsSync(frameworkBinary)
  } finally {
    detachDmgMount(mountDir)
    fs.rmSync(mountDir, { recursive: true, force: true })
  }
}

function repairedDmgNotarytoolArgs() {
  const apiKey = process.env.APPLE_API_KEY || ''
  const apiKeyId = process.env.APPLE_API_KEY_ID || ''
  const apiIssuer = process.env.APPLE_API_ISSUER || ''
  const hasApiCredential = Boolean(apiKey || apiKeyId || apiIssuer)
  if (hasApiCredential) {
    const missing = [
      ['APPLE_API_KEY', apiKey],
      ['APPLE_API_KEY_ID', apiKeyId],
      ['APPLE_API_ISSUER', apiIssuer],
    ].filter(([, value]) => !value).map(([name]) => name)
    if (missing.length) {
      throw new Error(`Cannot notarize repaired mac DMG: missing ${missing.join(', ')}`)
    }
    return ['--key', apiKey, '--key-id', apiKeyId, '--issuer', apiIssuer]
  }

  const appleId = process.env.APPLE_ID || ''
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_PASSWORD || ''
  const teamId = process.env.APPLE_TEAM_ID || ''
  const hasAppleIdCredential = Boolean(appleId || password || teamId)
  if (hasAppleIdCredential) {
    const missing = [
      ['APPLE_ID', appleId],
      ['APPLE_APP_SPECIFIC_PASSWORD', password],
      ['APPLE_TEAM_ID', teamId],
    ].filter(([, value]) => !value).map(([name]) => name)
    if (missing.length) {
      throw new Error(`Cannot notarize repaired mac DMG: missing ${missing.join(', ')}`)
    }
    return ['--apple-id', appleId, '--password', password, '--team-id', teamId]
  }

  return null
}

function notarizeRepairedMacDmgIfConfigured(dmgPath) {
  const notaryArgs = repairedDmgNotarytoolArgs()
  if (!notaryArgs) return false

  runChecked('notarize repaired mac DMG', 'xcrun', ['notarytool', 'submit', dmgPath, ...notaryArgs, '--wait'])
  runChecked('staple repaired mac DMG', 'xcrun', ['stapler', 'staple', dmgPath])
  runChecked('validate stapled repaired mac DMG', 'xcrun', ['stapler', 'validate', dmgPath])
  runChecked('assess repaired mac DMG', 'spctl', [
    '--assess',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    '--verbose=4',
    dmgPath,
  ])
  return true
}

function repairMacDmg(dmgPath, appPath, productName) {
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-dmg-stage-'))
  const repairedDmg = path.join(path.dirname(dmgPath), `${path.basename(dmgPath, '.dmg')}.repaired.dmg`)
  try {
    fs.rmSync(repairedDmg, { force: true })
    runChecked('stage mac app for DMG repair', '/usr/bin/ditto', [
      '--rsrc',
      '--extattr',
      '--acl',
      appPath,
      path.join(stageDir, `${productName}.app`),
    ])
    try {
      fs.symlinkSync('/Applications', path.join(stageDir, 'Applications'))
    } catch {
      // The staging directory is temporary; if the link already exists, the DMG can still be created.
    }
    runChecked('create repaired mac DMG', 'hdiutil', [
      'create',
      '-volname',
      productName,
      '-srcfolder',
      stageDir,
      '-ov',
      '-fs',
      'HFS+',
      '-format',
      'UDZO',
      '-imagekey',
      'zlib-level=6',
      repairedDmg,
    ])
    if (!macDmgContainsElectronFramework(repairedDmg, productName)) {
      throw new Error('repaired mac DMG is missing Electron Framework')
    }
    if (notarizeRepairedMacDmgIfConfigured(repairedDmg)) {
      console.warn(`[package-desktop] repaired mac DMG was notarized and stapled: ${path.basename(dmgPath)}`)
    }
    fs.renameSync(repairedDmg, dmgPath)
  } finally {
    fs.rmSync(repairedDmg, { force: true })
    fs.rmSync(stageDir, { recursive: true, force: true })
  }
}

function ensureMacDmgLaunchable() {
  if (process.platform !== 'darwin') return
  if (!forwardedArgs.includes('--mac') || forwardedArgs.includes('--dir')) return

  const pkg = packageJson()
  const productName = pkg.build?.productName || pkg.productName || pkg.name
  const dmgPath = path.join(root, 'release', `${productName}-${pkg.version}-${macArchLabel()}.dmg`)
  const appPath = findBuiltMacApp(productName)
  if (!appPath || !fs.existsSync(dmgPath)) return

  const sourceFrameworkBinary = macElectronFrameworkBinary(appPath)
  if (!fs.existsSync(sourceFrameworkBinary)) {
    throw new Error(`mac app bundle is missing Electron Framework: ${sourceFrameworkBinary}`)
  }

  if (macDmgContainsElectronFramework(dmgPath, productName)) return

  console.warn(`[package-desktop] mac DMG was missing Electron Framework; regenerating ${path.basename(dmgPath)}`)
  fs.rmSync(`${dmgPath}.blockmap`, { force: true })
  fs.rmSync(path.join(path.dirname(dmgPath), 'latest-mac.yml'), { force: true })
  repairMacDmg(dmgPath, appPath, productName)
}

function cleanGeneratedWindowsDirPackage() {
  if (process.platform !== 'win32' || !forwardedArgs.includes('--dir')) return

  const target = path.resolve(root, 'release', 'win-unpacked')
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (target === root || !target.startsWith(rootWithSeparator)) {
    throw new Error(`Refusing to clean package output outside the project: ${target}`)
  }
  if (!fs.existsSync(target)) return

  try {
    fs.rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    })
    return
  } catch (error) {
    const empty = path.join(cacheRoot, `empty-${Date.now()}-${process.pid}`)
    fs.mkdirSync(empty, { recursive: true })
    const result = spawnSync('robocopy', [
      empty,
      target,
      '/MIR',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
      '/NP',
      '/R:2',
      '/W:1',
    ], {
      windowsHide: true,
    })
    fs.rmSync(empty, { recursive: true, force: true })
    if ((result.status ?? 16) >= 8) {
      throw error
    }
    fs.rmSync(target, { recursive: true, force: true })
  }
}

const vendorPrep = spawnSync(command, [openClawVendorPrep], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
})
if (vendorPrep.status !== 0) {
  process.exit(vendorPrep.status ?? 1)
}

cleanGeneratedWindowsDirPackage()

const child = spawn(command, [electronBuilderCli, ...forwardedArgs, ...publishArgs, ...signingOverrideArgs], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    ...(unsignedDirectoryPackage
      ? {
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
          WIN_CSC_LINK: '',
          WIN_CSC_KEY_PASSWORD: '',
        }
      : {}),
    ...(pathEntries.length
      ? {
          PATH: pathEntries.join(pathDelimiter),
          NODE_EXE: process.execPath,
        }
      : {}),
    ELECTRON_CACHE: electronCache,
    ELECTRON_BUILDER_CACHE: builderCache,
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  if (code !== 0) process.exit(code ?? 1)
  try {
    ensureMacDmgLaunchable()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  process.exit(0)
})
