import { readFileSync } from 'node:fs'
import path from 'node:path'

function samePath(left: string, right: string) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

/**
 * Returns true when a staged managed-runtime plugin has the same official
 * plugin ID and package name as the copy bundled with the active OpenClaw
 * host. The staged copy is redundant in `plugins.load.paths`, even when its
 * runtime version lags or leads the packaged host; keeping it there makes
 * OpenClaw load it as an untrusted config plugin instead of its trusted bundle.
 */
export function isEquivalentManagedRuntimeBundledPluginPath(
  candidatePath: string,
  pluginId: string,
  packagedOpenClawRoot: string,
) {
  if (!candidatePath || !pluginId || !packagedOpenClawRoot) return false

  const resolvedCandidate = path.resolve(candidatePath)
  const managedRuntimeRoot = path.resolve(resolvedCandidate, '..', '..', '..')
  if (!/[\\/]runtimes[\\/]openclaw[\\/]/i.test(managedRuntimeRoot)) return false

  // Do not infer trust from a matching folder name alone. The load path must
  // be the expected extension folder within the staged runtime.
  if (!samePath(resolvedCandidate, path.join(managedRuntimeRoot, 'dist', 'extensions', pluginId))) return false

  try {
    const packagedHost = JSON.parse(readFileSync(path.join(packagedOpenClawRoot, 'package.json'), 'utf8'))
    const managedHost = JSON.parse(readFileSync(path.join(managedRuntimeRoot, 'package.json'), 'utf8'))
    if (packagedHost.name !== 'openclaw' || managedHost.name !== 'openclaw') return false

    const readPluginIdentity = (root: string) => {
      const manifest = JSON.parse(readFileSync(path.join(root, 'openclaw.plugin.json'), 'utf8'))
      const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
      if (
        manifest.id !== pluginId ||
        typeof packageJson.name !== 'string'
      ) return null
      return { name: packageJson.name }
    }

    const bundled = readPluginIdentity(path.join(packagedOpenClawRoot, 'dist', 'extensions', pluginId))
    const managed = readPluginIdentity(resolvedCandidate)
    return Boolean(bundled && managed && bundled.name === managed.name)
  } catch {
    // Incomplete or malformed package metadata must never cause an external
    // plugin path to be treated as a bundled trusted plugin.
    return false
  }
}
