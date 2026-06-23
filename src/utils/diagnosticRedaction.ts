const DEFAULT_DIAGNOSTIC_TEXT_LIMIT = 500

const SAFE_DIAGNOSTIC_PAYLOAD_KEYS = new Set([
  'agent',
  'agentId',
  'buffered',
  'chunked',
  'code',
  'elapsedSeconds',
  'failureKind',
  'id',
  'keepAlive',
  'label',
  'liveTokens',
  'mode',
  'model',
  'modelId',
  'ok',
  'parentId',
  'provider',
  'reason',
  'runId',
  'sessionId',
  'sessionKey',
  'toolId',
  'transport',
])

export function compactDiagnosticText(value: string, max = 140): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}...` : clean
}

function redactDiagnosticPhoneLikeText(match: string): string {
  const digits = match.replace(/\D/g, '')
  if (digits.length < 10) return match
  if (/^\d{4}[-/]\d{2}[-/]\d{2}(?:$|[T\s])/u.test(match.trim())) return match
  return '[redacted-phone]'
}

export function applyDiagnosticRedactions(value?: string): string {
  const clean = value?.trim()
  if (!clean) return ''
  return clean
    .replace(/<\s*(?:thinking|reasoning|chain[-_\s]*of[-_\s]*thought)\b[\s\S]*?<\s*\/\s*(?:thinking|reasoning|chain[-_\s]*of[-_\s]*thought)\s*>/gi, '[hidden reasoning removed]')
    .replace(/\b(?:thinking|reasoning|chain[-_\s]*of[-_\s]*thought)\s*[:=]\s*["']?[^"'\n]{8,}/gi, 'reasoning=[redacted]')
    .replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:Cookie|Set-Cookie)\s*:\s*[^\n]+/gi, 'Cookie: [redacted]')
    .replace(/\b(token|api[-_\s]?key|password|secret|authorization|cookie|session)\s*[:=]\s*["']?[^"',\s]+/gi, '$1=[redacted]')
    .replace(/\b(?:sk|rk|pk|xox[baprs]?|gh[pousr])-[A-Za-z0-9_-]{12,}\b/g, '[redacted-secret]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, redactDiagnosticPhoneLikeText)
    .replace(/\b(?:[A-Za-z]:\\Users\\)[^\\\s]+/g, '%USERPROFILE%')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[redacted]')
    .replace(/\bdata:[^,\s]+;base64,[A-Za-z0-9+/=]{32,}/gi, 'data:[redacted]')
}

export function redactDiagnosticText(value?: string, max = DEFAULT_DIAGNOSTIC_TEXT_LIMIT): string {
  return compactDiagnosticText(applyDiagnosticRedactions(value), max)
}

export function safeDiagnosticPayload(raw: Record<string, unknown> = {}): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!SAFE_DIAGNOSTIC_PAYLOAD_KEYS.has(key)) continue
    if (typeof value === 'string') payload[key] = redactDiagnosticText(value, 180)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) payload[key] = value
  }
  return Object.keys(payload).length ? payload : undefined
}
