#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { writeUpdateManifest } = require('./lib/update-manifest.cjs')

const root = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const artifactRoot = path.resolve(process.env.AUTOMNIA_RELEASE_ARTIFACT_ROOT || path.join(root, 'release'))
const outputDir = path.resolve(process.env.AUTOMNIA_UPDATE_OUTPUT_DIR || path.join(artifactRoot, 'updates'))
const requireSigning = /^(1|true|yes)$/i.test(String(process.env.AUTOMNIA_UPDATE_REQUIRE_SIGNING || ''))
const artifacts = String(process.env.AUTOMNIA_UPDATE_ARTIFACTS || '')
  .split(path.delimiter)
  .map((entry) => entry.trim())
  .filter(Boolean)

try {
  const result = writeUpdateManifest({
    artifactRoot,
    outputDir,
    artifacts,
    product: packageJson.build?.productName || packageJson.name,
    version: process.env.AUTOMNIA_RELEASE_VERSION || packageJson.version,
    minimumVersion: process.env.AUTOMNIA_UPDATE_MINIMUM_VERSION || '0.0.0',
    channel: process.env.AUTOMNIA_UPDATE_CHANNEL || 'stable',
    rolloutPercentage: process.env.AUTOMNIA_UPDATE_ROLLOUT_PERCENTAGE || 100,
    releaseNotesUrl: process.env.AUTOMNIA_UPDATE_RELEASE_NOTES_URL || '',
    mandatoryAfter: process.env.AUTOMNIA_UPDATE_MANDATORY_AFTER || '',
  })
  if (requireSigning && !result.signed) {
    throw new Error('Update signing is required. Configure AUTOMNIA_UPDATE_SIGNING_PRIVATE_KEY_FILE or AUTOMNIA_UPDATE_SIGNING_PRIVATE_KEY_PEM.')
  }
  console.log(`[update-manifest] wrote ${result.manifestPath}`)
  console.log(`[update-manifest] recorded ${result.manifest.artifacts.length} artifact(s)`)
  console.log(result.signed ? '[update-manifest] signed with Ed25519' : '[update-manifest] unsigned development manifest')
} catch (error) {
  console.error(`[update-manifest] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
