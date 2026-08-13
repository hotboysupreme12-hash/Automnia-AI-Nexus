#!/usr/bin/env node
const path = require('node:path')
const { verifyUpdateManifest } = require('./lib/update-manifest.cjs')

const root = path.resolve(__dirname, '..')
const artifactRoot = path.resolve(process.env.AUTOMNIA_RELEASE_ARTIFACT_ROOT || path.join(root, 'release'))
const outputDir = path.resolve(process.env.AUTOMNIA_UPDATE_OUTPUT_DIR || path.join(artifactRoot, 'updates'))
const requireSigning = /^(1|true|yes)$/i.test(String(process.env.AUTOMNIA_UPDATE_REQUIRE_SIGNING || process.env.AUTOMNIA_UPDATE_REQUIRE_SIGNING || ''))

try {
  const result = verifyUpdateManifest({
    artifactRoot,
    manifestPath: process.env.AUTOMNIA_UPDATE_MANIFEST_PATH || path.join(outputDir, 'update-manifest.json'),
    signaturePath: process.env.AUTOMNIA_UPDATE_SIGNATURE_PATH || path.join(outputDir, 'update-manifest.json.sig'),
    publicKeyPath: process.env.AUTOMNIA_UPDATE_PUBLIC_KEY_PATH || path.join(outputDir, 'update-manifest-public-key.pem'),
    requireSigning,
  })
  console.log(`[update-verify] verified ${result.artifactCount} artifact(s)`)
  console.log(result.signed ? '[update-verify] Ed25519 signature verified' : '[update-verify] unsigned manifest accepted for non-public validation')
} catch (error) {
  console.error(`[update-verify] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
