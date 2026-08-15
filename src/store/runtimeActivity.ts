import { redactDiagnosticText, safeDiagnosticPayload } from '../utils/diagnosticRedaction'
import type { AgentActivitySeverity, AgentActivitySurface, AgentActivityType } from '../types/nexus'

export function compactLine(value: string, max = 140): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1).trim() + '...' : clean
}

export function redactActivityText(value: string, max = 500): string {
  return redactDiagnosticText(value, max)
}

export function safeActivityPayload(raw: Record<string, unknown> = {}): Record<string, unknown> | undefined {
  return safeDiagnosticPayload(raw)
}

export function activityTypeForOperationalText(rawText: string, eventName = 'progress'): AgentActivityType {
  const text = rawText.toLowerCase()
  if (eventName === 'error') return 'run.failed'
  if (eventName === 'final') return 'run.finished'
  if (/\b(waiting|pending approval|approval required|blocked by approval)\b/.test(text)) return 'approval.pending'
  if (/\b(compact|compaction|context.*overflow|context.*prun)\b/.test(text)) return 'run.compacting_context'
  if (/\b(retry|retrying|fallback|recover)\b/.test(text)) return 'run.retrying'
  if (/\b(browser).*\b(fail|error|unreachable|disconnect|timeout|conflict)\b/.test(text)) return 'browser.error'
  if (/\b(browser|chrome|tab|page)\b.*\b(navigate|visit|load|open)\b|\b(navigate|visit|load|open)\b.*\b(browser|chrome|tab|page|url)\b/.test(text)) return 'browser.navigating'
  if (/\b(browser|snapshot|page)\b.*\b(read|inspect|extract|snapshot)\b|\b(read|inspect|extract|snapshot)\b.*\b(page|browser)\b/.test(text)) return 'browser.reading'
  if (/\b(click|press button|select)\b/.test(text)) return 'browser.clicking'
  if (/\b(type|fill|input)\b/.test(text)) return 'browser.typing'
  if (/\b(download)\b/.test(text)) return 'browser.downloading'
  if (/\b(browser|chrome|relay|cdp)\b/.test(text)) return 'browser.opening'
  if (/\b(tool).*\b(fail|error|blocked|refusal|denied)\b/.test(text)) return 'tool.error'
  if (/\b(tool).*\b(done|complete|finished)\b/.test(text)) return 'tool.finished'
  if (/\b(tool|mcp|plugin)\b/.test(text)) return 'tool.progress'
  if (/\b(command|shell|exec|child process|openclaw process)\b.*\b(fail|error|exit code [1-9])\b/.test(text)) return 'command.failed'
  if (/\b(command|shell|exec|child process|openclaw process)\b/.test(text)) return 'command.started'
  if (/\b(reading|searching|inspecting|scanning)\b.*\b(file|project|workspace|repo)\b|\b(file|project|workspace|repo)\b.*\b(reading|searching|inspecting|scanning)\b/.test(text)) return 'file.reading'
  if (/\b(writing|patching|editing|applying patch)\b/.test(text)) return text.includes('patch') ? 'file.patching' : 'file.writing'
  if (/\b(final|finalizing|preparing final|returned a final)\b/.test(text)) return 'agent.finalizing'
  if (/\b(started|handoff|accepted|selected)\b/.test(text)) return 'run.started'
  if (/\b(waiting)\b/.test(text)) return 'agent.waiting'
  return 'agent.working'
}

export function severityForActivity(type: string, payload?: Record<string, unknown>): AgentActivitySeverity {
  if (type.endsWith('.error') || type.endsWith('.failed') || payload?.ok === false) return 'error'
  if (type.endsWith('.warning') || type.endsWith('.blocked') || type === 'approval.pending') return 'warning'
  if (type.endsWith('.finished') || type.endsWith('.final') || type === 'gateway.health.ok') return 'success'
  return 'info'
}

export function surfaceForActivity(type: string): AgentActivitySurface {
  if (type.startsWith('message.')) return 'activity'
  if (type.startsWith('tool.') || type.startsWith('browser.') || type.startsWith('command.') || type.startsWith('approval.')) return 'both'
  return 'activity'
}
