export function safeMarkdownUrl(raw: string): string | null {
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code <= 32 || code === 127) return null
  }
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null
  } catch { return null }
}
