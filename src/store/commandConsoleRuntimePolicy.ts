import type { ThinkingLevel } from '../types/nexus'

const COMPLEX_INTERACTIVE_WORK = /\b(?:analy[sz]e|architecture|audit|benchmark|build|browse|debug|deploy|design|diagnos(?:e|is)|edit|implement|inspect|investigat(?:e|ion)|migrat(?:e|ion)|plan|profile|refactor|research|review|run|search|test|troubleshoot|update|verify|write)\b|\b(?:api|browser|code|command|config(?:uration)?|database|file|folder|log|repo(?:sitory)?|terminal|tool|workspace)\b/i

/**
 * The Command Console is an interactive surface: routine questions should
 * start responding immediately, but involved requests still receive enough
 * reasoning budget to plan and use tools safely. This controls reasoning only;
 * it never removes the OpenClaw tool set from the turn.
 */
export function resolveInteractiveConsoleThinking(message: string): ThinkingLevel {
  const text = message.trim()
  if (!text) return 'off'

  const hasCodeOrStructuredTask = /```|\n\s*(?:[-*]|\d+\.)\s+/.test(text)
  const isLongRequest = text.length >= 420
  return hasCodeOrStructuredTask || isLongRequest || COMPLEX_INTERACTIVE_WORK.test(text)
    ? 'low'
    : 'off'
}
