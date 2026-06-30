import path from 'node:path'

export type SafePathFlavor = 'posix' | 'win32'

export type SafePathOptions = {
  flavor?: SafePathFlavor
}

type SafePathInternals = {
  flavor: SafePathFlavor
  pathApi: typeof path.posix
}

function defaultSafePathFlavor(): SafePathFlavor {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

function safePathInternals(options: SafePathOptions = {}): SafePathInternals {
  const flavor = options.flavor || defaultSafePathFlavor()
  return {
    flavor,
    pathApi: flavor === 'win32' ? path.win32 : path.posix,
  }
}

function resolvedComparisonPath(value: string, options: SafePathOptions = {}) {
  const { flavor, pathApi } = safePathInternals(options)
  const resolved = pathApi.resolve(value)
  return flavor === 'win32' ? resolved.toLowerCase() : resolved
}

export function samePath(left: string, right: string, options: SafePathOptions = {}) {
  return resolvedComparisonPath(left, options) === resolvedComparisonPath(right, options)
}

export function isPathUnder(baseDir: string, targetPath: string, options: SafePathOptions = {}) {
  const { pathApi } = safePathInternals(options)
  const base = resolvedComparisonPath(baseDir, options)
  const target = resolvedComparisonPath(targetPath, options)
  const relative = pathApi.relative(base, target)
  return (
    relative === '' ||
    (
      !pathApi.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${pathApi.sep}`)
    )
  )
}

export function isInsidePath(parent: string, candidate: string, options: SafePathOptions = {}) {
  return isPathUnder(parent, candidate, options)
}

export function assertPathUnder(baseDir: string, targetPath: string, options: SafePathOptions = {}) {
  if (!isPathUnder(baseDir, targetPath, options)) {
    throw new Error('Path resolved outside the approved root.')
  }
}

export function createSafePathService(options: SafePathOptions = {}) {
  return {
    assertPathUnder: (baseDir: string, targetPath: string) => assertPathUnder(baseDir, targetPath, options),
    isInsidePath: (parent: string, candidate: string) => isInsidePath(parent, candidate, options),
    isPathUnder: (baseDir: string, targetPath: string) => isPathUnder(baseDir, targetPath, options),
    samePath: (left: string, right: string) => samePath(left, right, options),
  }
}

export type SafePathService = ReturnType<typeof createSafePathService>
