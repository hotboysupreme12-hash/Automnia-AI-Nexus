#!/usr/bin/env node
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const yaml = require('js-yaml')

const repoRoot = path.resolve(__dirname, '..')
const stageScript = path.join(repoRoot, 'scripts', 'stage-update-channel.cjs')
const version = '1.0.26'

function sha512(value) {
  return crypto.createHash('sha512').update(value).digest('base64')
}

function writeMetadata(filePath, zipName, zipContents) {
  const document = {
    version,
    files: [{ url: zipName, sha512: sha512(zipContents), size: zipContents.length }],
    path: zipName,
    sha512: sha512(zipContents),
    releaseDate: '2026-11-19T00:00:00.000Z',
  }
  fs.writeFileSync(filePath, yaml.dump(document, { lineWidth: 120, noRefs: true }))
}

function runScenario({ armMetadata }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'automnia-mac-update-stage-'))
  const inputRoot = path.join(tempRoot, 'release-downloads')
  const outputRoot = path.join(tempRoot, 'update-channel')
  const x64Root = path.join(inputRoot, 'macos')
  const arm64Root = path.join(inputRoot, 'macos-arm64')
  fs.mkdirSync(x64Root, { recursive: true })
  fs.mkdirSync(arm64Root, { recursive: true })

  const x64ZipName = `Automnia AI Nexus-${version}-x64.zip`
  const arm64ZipName = `Automnia AI Nexus-${version}-arm64.zip`
  const x64Zip = Buffer.from('fixture intel mac update zip')
  const arm64Zip = Buffer.from('fixture apple silicon mac update zip')
  fs.writeFileSync(path.join(x64Root, x64ZipName), x64Zip)
  fs.writeFileSync(path.join(x64Root, `Automnia AI Nexus-${version}-x64.dmg`), 'intel dmg fixture')
  fs.writeFileSync(path.join(arm64Root, arm64ZipName), arm64Zip)
  fs.writeFileSync(path.join(arm64Root, `Automnia AI Nexus-${version}-arm64.dmg`), 'arm64 dmg fixture')
  writeMetadata(path.join(x64Root, 'latest-mac.yml'), x64ZipName, x64Zip)
  if (armMetadata) writeMetadata(path.join(arm64Root, 'latest-mac.yml'), arm64ZipName, arm64Zip)

  try {
    const result = spawnSync(process.execPath, [stageScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTOMNIA_UPDATE_STAGE_INPUT: inputRoot,
        AUTOMNIA_UPDATE_STAGE_OUTPUT: outputRoot,
        AUTOMNIA_RELEASE_VERSION: version,
        AUTOMNIA_UPDATE_CHANNEL: 'stable-x64',
        AUTOMNIA_UPDATE_ROLLOUT_PERCENTAGE: '100',
      },
    })
    assert.equal(result.status, 0, `staging failed (${armMetadata ? 'dual metadata' : 'x64 metadata only'}):\n${result.stderr}\n${result.stdout}`)

    const metadata = yaml.load(fs.readFileSync(path.join(outputRoot, 'latest-mac.yml'), 'utf8'))
    const urls = metadata.files.map((entry) => entry.url).sort()
    assert.deepEqual(urls, [arm64ZipName, x64ZipName].sort(), 'macOS update feed must publish both CPU-specific ZIPs')
    assert.equal(metadata.path, x64ZipName, 'legacy top-level metadata should remain compatible with Intel clients')
    const armEntry = metadata.files.find((entry) => entry.url === arm64ZipName)
    assert.equal(armEntry.sha512, sha512(arm64Zip), 'Apple silicon ZIP checksum must match the staged file')
    assert.equal(armEntry.size, arm64Zip.length, 'Apple silicon ZIP size must match the staged file')

    const channelAlias = yaml.load(fs.readFileSync(path.join(outputRoot, 'stable-x64-mac.yml'), 'utf8'))
    assert.deepEqual(channelAlias.files.map((entry) => entry.url).sort(), urls, 'stable-x64 alias must retain both Mac architectures')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

runScenario({ armMetadata: false })
runScenario({ armMetadata: true })
console.log('macOS update staging retains validated Intel and Apple silicon ZIP metadata')
