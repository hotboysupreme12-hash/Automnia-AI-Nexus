#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const root = process.cwd()
const distDir = path.resolve(root, process.env.DYSTOPAI_BUNDLE_DIR || 'dist')
const indexPath = path.join(distDir, 'index.html')

if (!fs.existsSync(indexPath)) {
  throw new Error(`Missing production bundle at ${indexPath}. Run npm run build:client first.`)
}

const html = fs.readFileSync(indexPath, 'utf8')
const assetPath = (url) => path.join(distDir, url.replace(/^\//, ''))
const scriptUrls = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)].map((match) => match[1])
const styleUrls = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/gi)].map((match) => match[1])

if (!scriptUrls.length) throw new Error('Production index.html does not reference an entry JavaScript bundle.')
if (!styleUrls.length) throw new Error('Production index.html does not reference a stylesheet bundle.')

const allAssets = fs.readdirSync(path.join(distDir, 'assets'))
  .map((name) => path.join(distDir, 'assets', name))
  .filter((filePath) => fs.statSync(filePath).isFile())
const allJs = allAssets.filter((filePath) => filePath.endsWith('.js'))
const allCss = allAssets.filter((filePath) => filePath.endsWith('.css'))
const entryJs = scriptUrls.map(assetPath)
const entryCss = styleUrls.map(assetPath)

for (const filePath of [...entryJs, ...entryCss]) {
  if (!fs.existsSync(filePath)) throw new Error(`Bundle index references missing asset: ${path.relative(root, filePath)}`)
}

const sum = (files, measure) => files.reduce((total, filePath) => total + measure(fs.readFileSync(filePath)), 0)
const rawBytes = (buffer) => buffer.length
const gzipBytes = (buffer) => gzipSync(buffer, { level: 9 }).length
const metrics = {
  entryJsBytes: sum(entryJs, rawBytes),
  entryJsGzipBytes: sum(entryJs, gzipBytes),
  entryCssBytes: sum(entryCss, rawBytes),
  entryCssGzipBytes: sum(entryCss, gzipBytes),
  totalJsBytes: sum(allJs, rawBytes),
  totalJsGzipBytes: sum(allJs, gzipBytes),
}

const numberEnv = (key, fallback) => {
  const value = Number(process.env[key] || fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive byte count.`)
  return value
}
const budgets = {
  entryJsBytes: numberEnv('DYSTOPAI_BUDGET_ENTRY_JS_BYTES', 525_000),
  entryJsGzipBytes: numberEnv('DYSTOPAI_BUDGET_ENTRY_JS_GZIP_BYTES', 165_000),
  entryCssBytes: numberEnv('DYSTOPAI_BUDGET_ENTRY_CSS_BYTES', 1_050_000),
  entryCssGzipBytes: numberEnv('DYSTOPAI_BUDGET_ENTRY_CSS_GZIP_BYTES', 145_000),
  totalJsBytes: numberEnv('DYSTOPAI_BUDGET_TOTAL_JS_BYTES', 850_000),
  totalJsGzipBytes: numberEnv('DYSTOPAI_BUDGET_TOTAL_JS_GZIP_BYTES', 265_000),
}

const format = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`
const failures = []
for (const [metric, actual] of Object.entries(metrics)) {
  const budget = budgets[metric]
  if (actual > budget) failures.push(`${metric}: ${format(actual)} exceeds ${format(budget)}`)
}

console.log(JSON.stringify({
  entryScripts: scriptUrls,
  entryStyles: styleUrls,
  metrics,
  budgets,
}, null, 2))

if (failures.length) {
  throw new Error(`Production bundle budget exceeded:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
}

console.log('production bundle budget contract ok')
