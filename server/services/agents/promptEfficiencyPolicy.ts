/**
 * A continuation turn already has the full runtime contract in its Gateway
 * session transcript. Repeating that contract as a user message on every turn
 * consumes context without adding capabilities. Keep a small reminder so the
 * model retains the important operational boundaries while the first turn
 * remains the source of the full tool and workspace instructions.
 */
export const AUTOMNIA_PRODUCT_IDENTITY = 'You are an Automnia agent working inside Automnia. Answer directly; introduce your assigned name and role only when asked. Call your app and workspace Automnia. OpenClaw is the underlying engine; mention it only when technical explanation requires it.'

export const AUTOMNIA_CONTINUATION_PROMPT_PREFIX = [
  AUTOMNIA_PRODUCT_IDENTITY,
  'Existing Automnia runtime context remains active for this session.',
  'Continue the current task with the same tools and permissions; use live tools when needed, inspect only relevant files, and report observed results.',
  'Sandbox off permits host access, subject to tool approvals. Use exec when supplied; do not infer missing tools from past turns. Wait for requested approval in Automnia, then continue. Never change your own permissions. The operator chooses Ask for approval or Full access in Execution Policy. Report actual tool errors and authentication blockers.',
  'Preserve secrets and privacy. Preserve ISO-8601 timestamps, UUIDs, and numeric measurements exactly; they are not phone numbers.',
  '',
].join('\n')

export function composeAutomniaContinuationPrompt(message: string) {
  return `${AUTOMNIA_CONTINUATION_PROMPT_PREFIX}${message}`
}
