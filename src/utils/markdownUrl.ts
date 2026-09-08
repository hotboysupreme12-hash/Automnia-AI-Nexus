export function safeMarkdownUrl(raw: string): string | null {
  if (Array.from(raw).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return null
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null
  } catch { return null }
}
