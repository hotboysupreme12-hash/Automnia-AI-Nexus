const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const yaml = require('js-yaml')

test('cross-platform update staging flattens coherent metadata and excludes evidence payloads', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-update-stage-'))
  try {
    const input = path.join(temp, 'input')
    const output = path.join(temp, 'output')
    const files = {
      'windows/Automnia-Setup-1.2.0-x64.exe': 'windows',
      'windows/Automnia-Setup-1.2.0-x64.exe.blockmap': 'windows-map',
      'windows/latest.yml': 'version: 1.2.0\npath: Automnia-Setup-1.2.0-x64.exe\nfiles:\n  - url: Automnia-Setup-1.2.0-x64.exe\n',
      'macos/Automnia-1.2.0-arm64.dmg': 'dmg',
      'macos/Automnia-1.2.0-arm64.zip': 'zip',
      'macos/latest-mac.yml': 'version: 1.2.0\npath: Automnia-1.2.0-arm64.zip\nfiles:\n  - url: Automnia-1.2.0-arm64.zip\n',
      'linux/Automnia-1.2.0-x64.AppImage': 'appimage',
      'linux/latest-linux.yml': 'version: 1.2.0\npath: Automnia-1.2.0-x64.AppImage\nfiles:\n  - url: Automnia-1.2.0-x64.AppImage\n',
      'windows/builder-debug.yml': 'debug metadata',
      'windows/evidence/do-not-publish.zip': 'evidence',
      'windows/win-unpacked/Automnia.exe': 'unpacked',
    }
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(input, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, contents)
    }
    const result = spawnSync(process.execPath, ['scripts/stage-update-channel.cjs'], {
      cwd: process.cwd(),
      env: { ...process.env, AUTOMNIA_UPDATE_STAGE_INPUT: input, AUTOMNIA_UPDATE_STAGE_OUTPUT: output, AUTOMNIA_UPDATE_ROLLOUT_PERCENTAGE: '5', AUTOMNIA_RELEASE_VERSION: '1.2.0' },
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.existsSync(path.join(output, 'do-not-publish.zip')), false)
    assert.equal(fs.existsSync(path.join(output, 'Automnia.exe')), false)
    assert.equal(fs.existsSync(path.join(output, 'builder-debug.yml')), false)
    assert.equal(fs.existsSync(path.join(output, 'Automnia-1.2.0-arm64.zip')), true)
    const metadata = yaml.load(fs.readFileSync(path.join(output, 'latest.yml'), 'utf8'))
    assert.equal(metadata.version, '1.2.0')
    assert.equal(metadata.stagingPercentage, undefined, 'signed manifest owns rollout so updater cohorts cannot disagree')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('update staging rejects a release tag that disagrees with updater metadata', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-update-stage-version-'))
  try {
    const input = path.join(temp, 'input')
    const output = path.join(temp, 'output')
    fs.mkdirSync(input, { recursive: true })
    fs.writeFileSync(path.join(input, 'Automnia-Setup-1.2.0-x64.exe'), 'windows')
    fs.writeFileSync(path.join(input, 'latest.yml'), 'version: 1.2.0\npath: Automnia-Setup-1.2.0-x64.exe\n')
    const result = spawnSync(process.execPath, ['scripts/stage-update-channel.cjs'], {
      cwd: process.cwd(),
      env: { ...process.env, AUTOMNIA_UPDATE_STAGE_INPUT: input, AUTOMNIA_UPDATE_STAGE_OUTPUT: output, AUTOMNIA_RELEASE_VERSION: '1.3.0' },
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /does not match requested release/)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
