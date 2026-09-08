import { memo } from 'react'
import type { ReactNode } from 'react'
import { safeMarkdownUrl } from '../../utils/markdownUrl'

function inline(text: string): ReactNode {
  if (text.length > 16_384) return text
  const parts: ReactNode[] = []
  const pattern = /`([^`\n]{1,2048})`|\*\*([^*\n]{1,2048})\*\*|\[([^\]\n]{1,200})\]\(([^)\s]{1,2048})\)/g
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) parts.push(text.slice(offset, match.index))
    if (match[1]) parts.push(<code key={match.index} className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[0.92em]">{match[1]}</code>)
    else if (match[2]) parts.push(<strong key={match.index} className="font-semibold text-slate-100">{match[2]}</strong>)
    else {
      const href = safeMarkdownUrl(match[4])
      parts.push(href ? <a key={match.index} href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-200 underline decoration-cyan-200/40 underline-offset-2">{match[3]}</a> : match[0])
    }
    offset = match.index + match[0].length
  }
  parts.push(text.slice(offset))
  return parts
}

function listLine(line: string) {
  const match = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/)
  return match ? { indent: match[1].replace(/\t/g, '  ').length, ordered: /^\d/.test(match[2]), number: Number.parseInt(match[2], 10), text: match[3] } : null
}

function readList(lines: string[], start: number, depth = 0): { block: ReactNode; next: number } {
  const first = listLine(lines[start])!
  if (depth >= 20) return { block: <p key={start}>{lines[start]}</p>, next: start + 1 }
  const items: ReactNode[] = []
  let index = start
  while (index < lines.length) {
    const entry = listLine(lines[index])
    if (!entry || entry.indent !== first.indent || entry.ordered !== first.ordered) break
    const key = index++
    const children: ReactNode[] = []
    while (index < lines.length && (listLine(lines[index])?.indent ?? -1) > first.indent) {
      const child = readList(lines, index, depth + 1)
      children.push(child.block)
      index = child.next
    }
    items.push(<li key={key}>{inline(entry.text)}{children}</li>)
  }
  return { block: first.ordered ? <ol key={start} start={first.number} className="my-2 list-decimal space-y-1 pl-5">{items}</ol> : <ul key={start} className="my-2 list-disc space-y-1 pl-5">{items}</ul>, next: index }
}

export const ResponseMarkdown = memo(function ResponseMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 2000) return <div className="whitespace-pre-wrap break-words">{text}</div>
  const blocks: ReactNode[] = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    const key = index
    if (!line.trim()) { index += 1; continue }
    const fence = line.match(/^\s*(`{3,}|~{3,})([\w+-]*)\s*$/)
    if (fence) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) body.push(lines[index++])
      if (index < lines.length) index += 1
      blocks.push(<figure key={key} className="my-3 min-w-0 overflow-hidden rounded-lg border border-white/15 bg-black/30">
        {fence[2] && <figcaption className="border-b border-white/10 px-3 py-1.5 font-mono text-[11px] text-slate-400">{fence[2]}</figcaption>}
        <pre tabIndex={0} aria-label={fence[2] ? `${fence[2]} code` : 'Code'} className="max-w-full overflow-x-auto whitespace-pre p-3 font-mono text-[12px] leading-relaxed text-slate-200"><code>{body.join('\n')}</code></pre>
      </figure>)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) { blocks.push(<div key={key} role="heading" aria-level={Math.min(6, heading[1].length + 2)} className="mb-2 mt-4 font-semibold text-slate-100">{inline(heading[2])}</div>); index += 1; continue }
    if (listLine(line)) {
      const list = readList(lines, index)
      blocks.push(list.block)
      index = list.next
      continue
    }
    if (line.startsWith('> ')) { blocks.push(<blockquote key={key} className="my-2 border-l-2 border-cyan-300/30 pl-3 text-slate-400">{inline(line.slice(2))}</blockquote>); index += 1; continue }
    blocks.push(<p key={key} className="my-2 whitespace-pre-wrap break-words">{inline(line)}</p>)
    index += 1
  }
  return <div className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{blocks}</div>
})
