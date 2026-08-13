import fs from 'node:fs/promises'
import path from 'node:path'

const DOCS_ROOT = 'https://docs.openclaw.ai'
const OUT_DIR = path.resolve('docs/openclaw-latest')
const PAGES_DIR = path.join(OUT_DIR, 'pages')

function unique(values) {
  return Array.from(new Set(values))
}

function pageUrlToOutputPath(rawUrl) {
  const url = new URL(rawUrl)
  let pathname = url.pathname.replace(/\/+$/u, '')
  if (!pathname || pathname === '/') pathname = '/index'
  if (!pathname.endsWith('.md')) pathname += '.md'
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/gu, '_'))
  return path.join(PAGES_DIR, ...segments)
}

function markdownUrlFor(rawUrl) {
  const url = new URL(rawUrl)
  url.hash = ''
  url.search = ''
  if (!url.pathname.endsWith('.md')) url.pathname = `${url.pathname.replace(/\/+$/u, '') || '/index'}.md`
  return url.toString()
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      accept: url.endsWith('.xml') ? 'application/xml,text/xml,*/*' : 'text/markdown,text/plain,*/*',
      'user-agent': 'automnia-openclaw-docs-sync/1.0',
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return await res.text()
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
}

function normalizeMarkdownText(text) {
  return text.replace(/[ \t]+$/gmu, '')
}

function extractOpenClawDocUrls(text) {
  const urls = []
  const pattern = /https:\/\/docs\.openclaw\.ai\/[^\s)>\]]+/gu
  for (const match of text.matchAll(pattern)) {
    const raw = match[0].replace(/[.,;:!?]+$/u, '')
    const url = new URL(raw)
    if (url.pathname === '/llms.txt' || url.pathname === '/llms-full.txt') continue
    if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') continue
    if (/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js)$/iu.test(url.pathname)) continue
    const normalizedPath = (url.pathname.endsWith('.md') ? url.pathname.slice(0, -3) : url.pathname).replace(/\/+$/u, '') || '/'
    urls.push(`${url.origin}${normalizedPath}`)
  }
  return unique(urls).sort()
}

async function main() {
  const startedAt = new Date().toISOString()
  await fs.mkdir(OUT_DIR, { recursive: true })
  await fs.rm(PAGES_DIR, { recursive: true, force: true })
  await fs.mkdir(PAGES_DIR, { recursive: true })

  const indexText = normalizeMarkdownText(await fetchText(`${DOCS_ROOT}/llms.txt`))
  await writeText(path.join(OUT_DIR, 'llms.txt'), indexText)

  const fullText = normalizeMarkdownText(await fetchText(`${DOCS_ROOT}/llms-full.txt`))
  await writeText(path.join(OUT_DIR, 'llms-full.txt'), fullText)

  const sitemapText = await fetchText(`${DOCS_ROOT}/sitemap.xml`)
  await writeText(path.join(OUT_DIR, 'sitemap.xml'), sitemapText)

  const robotsText = await fetchText(`${DOCS_ROOT}/robots.txt`)
  await writeText(path.join(OUT_DIR, 'robots.txt'), robotsText)

  const pageUrls = extractOpenClawDocUrls(indexText)
  const pages = []
  const failures = []
  const concurrency = 8
  let cursor = 0

  async function worker() {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= pageUrls.length) return
      const sourceUrl = pageUrls[index]
      const markdownUrl = markdownUrlFor(sourceUrl)
      const outPath = pageUrlToOutputPath(sourceUrl)
      try {
        const text = normalizeMarkdownText(await fetchText(markdownUrl))
        await writeText(outPath, text)
        pages.push({
          sourceUrl,
          markdownUrl,
          path: path.relative(OUT_DIR, outPath).replace(/\\/gu, '/'),
          bytes: Buffer.byteLength(text, 'utf8'),
        })
      } catch (error) {
        failures.push({
          sourceUrl,
          markdownUrl,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  pages.sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl))
  failures.sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl))

  const manifest = {
    source: DOCS_ROOT,
    syncedAt: startedAt,
    pageCount: pages.length,
    failureCount: failures.length,
    pages,
    failures,
  }
  await writeText(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const readme = [
    '# OpenClaw Docs Snapshot',
    '',
    `Synced from ${DOCS_ROOT} at ${startedAt}.`,
    '',
    '- `llms.txt` is the live docs map used for discovery.',
    '- `llms-full.txt` is the full LLM-oriented docs export.',
    '- `pages/` contains one Markdown file per discovered docs page.',
    '- `manifest.json` records source URLs, local paths, byte counts, and fetch failures.',
    '',
    'Refresh with:',
    '',
    '```bash',
    'node scripts/sync-openclaw-docs.mjs',
    '```',
    '',
    `Downloaded pages: ${pages.length}`,
    `Failed pages: ${failures.length}`,
    '',
  ].join('\n')
  await writeText(path.join(OUT_DIR, 'README.md'), readme)

  console.log(`Downloaded ${pages.length} OpenClaw docs pages into ${OUT_DIR}`)
  if (failures.length) {
    console.warn(`Failed to download ${failures.length} pages; see manifest.json`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
