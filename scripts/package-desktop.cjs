const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
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

const vendorPrep = spawnSync(command, [openClawVendorPrep], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
})
if (vendorPrep.status !== 0) {
  process.exit(vendorPrep.status ?? 1)
}

const child = spawn(command, [electronBuilderCli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
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
  process.exit(code ?? 1)
})
