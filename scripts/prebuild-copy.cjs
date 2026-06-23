const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const vendor = path.join(root, 'vendor', 'openclaw')

// Restore node_modules if previously moved (from a cancelled build)
const moved = path.join(root, 'vendor', '_openclaw_node_modules')
if (fs.existsSync(moved) && !fs.existsSync(path.join(vendor, 'node_modules'))) {
  fs.renameSync(moved, path.join(vendor, 'node_modules'))
}

// Verify json5 is present
const json5 = path.join(vendor, 'node_modules', 'json5', 'package.json')
if (fs.existsSync(json5)) {
  console.log('[prebuild] openclaw node_modules OK, json5 present')
} else {
  console.error('[prebuild] WARNING: json5 not found at', json5)
}