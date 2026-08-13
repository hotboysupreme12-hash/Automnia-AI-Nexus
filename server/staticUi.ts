import type { Express, Request, Response } from 'express'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { setStaticSecurityHeaders } from './controlPlaneHttp'

type StaticUiOptions = {
  staticDir?: string
  contentTypeFromExt: (filePath: string) => string
  isInsidePath: (parent: string, candidate: string) => boolean
}

type SafeStaticFile = {
  filePath: string
  stat: Awaited<ReturnType<Awaited<ReturnType<typeof fs.open>>['stat']>>
}

export function registerStaticUi(app: Express, options: StaticUiOptions) {
  const staticRoot = options.staticDir ? path.resolve(options.staticDir) : ''
  let staticRootRealPathPromise: Promise<string> | null = null

  const decodedRequestPathname = (value: string) => {
    try {
      return decodeURIComponent(value || '/')
    } catch {
      return value || '/'
    }
  }

  const staticCandidatePathFromRequest = (requestPath: string) => {
    if (!staticRoot) return null
    const decoded = decodedRequestPathname(requestPath).replace(/\\/g, '/')
    if (decoded.includes('\0')) return null
    const segments = decoded.split('/').filter(Boolean)
    if (segments.some((segment) => segment === '..')) return null
    const normalized = path.posix.normalize(decoded.startsWith('/') ? decoded : `/${decoded}`)
    const relativePath = normalized === '/' ? 'index.html' : normalized.replace(/^\/+/, '')
    const candidate = path.resolve(staticRoot, relativePath)
    return options.isInsidePath(staticRoot, candidate) ? candidate : null
  }

  const staticRequestShouldFallbackToIndex = (requestPath: string) => {
    const decoded = decodedRequestPathname(requestPath).replace(/\\/g, '/')
    return !path.extname(decoded)
  }

  // Vite fingerprints lazy chunks. During a local desktop rebuild the
  // renderer can still hold an older index.html while the server is already
  // serving the new dist directory. Resolve that short-lived version skew by
  // matching a missing hashed asset to the current asset with the same logical
  // name. This keeps a workspace switch from turning into a renderer crash.
  const versionedAssetFallbackPath = async (requestPath: string) => {
    if (!staticRoot) return null
    const decoded = decodedRequestPathname(requestPath).replace(/\\/g, '/')
    if (!decoded.startsWith('/assets/')) return null
    const filename = path.posix.basename(decoded)
    const match = filename.match(/^(.+)-([A-Za-z0-9_-]+)(\.[A-Za-z0-9]+)$/)
    if (!match) return null

    const assetRoot = path.resolve(staticRoot, 'assets')
    if (!options.isInsidePath(staticRoot, assetRoot)) return null
    const logicalPrefix = `${match[1]}-`
    const extension = match[3]
    const entries = await fs.readdir(assetRoot, { withFileTypes: true }).catch(() => [])
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(logicalPrefix) && entry.name.endsWith(extension))
      .map((entry) => path.resolve(assetRoot, entry.name))
      .filter((candidate) => options.isInsidePath(assetRoot, candidate))
    return candidates.length === 1 ? candidates[0] : null
  }

  const staticRootRealPath = async () => {
    if (!staticRoot) return ''
    staticRootRealPathPromise ||= fs.realpath(staticRoot)
    return staticRootRealPathPromise
  }

  const safeOpenStaticFile = async (filePath: string): Promise<SafeStaticFile | null> => {
    if (!staticRoot || !options.isInsidePath(staticRoot, filePath)) return null
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null
    try {
      handle = await fs.open(filePath, 'r')
      const stat = await handle.stat()
      if (!stat.isFile()) return null
      const rootRealPath = await staticRootRealPath()
      const realFilePath = await fs.realpath(filePath)
      if (!options.isInsidePath(rootRealPath, realFilePath)) return null
      return { filePath: realFilePath, stat }
    } catch {
      return null
    } finally {
      if (handle) await handle.close().catch(() => undefined)
    }
  }

  const streamSafeStaticFile = (req: Request, res: Response, file: SafeStaticFile) => {
    res.status(200)
    setStaticSecurityHeaders(res, file.filePath)
    res.setHeader('Content-Type', options.contentTypeFromExt(file.filePath))
    res.setHeader('Content-Length', String(file.stat.size))
    if (req.method === 'HEAD') {
      res.end()
      return
    }

    const stream = createReadStream(file.filePath)
    res.on('close', () => {
      if (!res.writableEnded) stream.destroy()
    })
    stream.on('error', (error) => {
      if (!res.headersSent) {
        res.status(500).type('text/plain').send('Static asset read failed')
        return
      }
      res.destroy(error instanceof Error ? error : undefined)
    })
    stream.pipe(res)
  }

  if (staticRoot) {
    app.use((req, res, next) => {
      if (!req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store')
      next()
    })
    app.use(async (req, res, next) => {
      if (req.path.startsWith('/api') || (req.method !== 'GET' && req.method !== 'HEAD')) {
        next()
        return
      }

      const candidate = staticCandidatePathFromRequest(req.path)
      if (!candidate) {
        res.status(400).type('text/plain').send('Invalid static asset path')
        return
      }

      let file = await safeOpenStaticFile(candidate)
      if (!file) {
        const fallback = await versionedAssetFallbackPath(req.path)
        if (fallback) file = await safeOpenStaticFile(fallback)
      }
      if (!file && staticRequestShouldFallbackToIndex(req.path) && req.accepts('html')) {
        file = await safeOpenStaticFile(path.join(staticRoot, 'index.html'))
      }
      if (!file) {
        res.status(404).type('text/plain').send('Not found')
        return
      }
      streamSafeStaticFile(req, res, file)
    })
  }

  return { staticRoot }
}
