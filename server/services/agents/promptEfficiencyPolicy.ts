/**
 * A continuation turn already has the full runtime contract in its Gateway
 * session transcript. Repeating that contract as a user message on every turn
 * consumes context without adding capabilities. Keep a small reminder so the
 * model retains the important operational boundaries while the first turn
 * remains the source of the full tool and workspace instructions.
 */
export const AUTOMNIA_CONTINUATION_PROMPT_PREFIX = [
  'Existing Automnia runtime context remains active for this session.',
  'Continue the current task with the same tools and permissions; use live tools when needed, inspect only relevant files, and report observed results.',
  'Preserve secrets and privacy. Preserve ISO-8601 timestamps, UUIDs, and numeric measurements exactly; they are not phone numbers.',
  '',
].join('\n')

export function composeAutomniaContinuationPrompt(message: string) {
  return `${AUTOMNIA_CONTINUATION_PROMPT_PREFIX}${message}`
}
