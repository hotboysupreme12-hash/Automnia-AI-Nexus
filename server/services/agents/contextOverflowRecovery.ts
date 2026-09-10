/** Only match provider/runtime errors, not generic advice to start a new chat. */
export function isContextOverflowReply(text: string): boolean {
  return /context[_ -](?:overflow|length[_ -]exceeded|window[_ -]exceeded)|prompt (?:is )?too (?:large|long)|request_too_large|maximum context length|input (?:token count exceeds the maximum number of input tokens|exceeds the maximum number of tokens|too long for the model)/i.test(text)
}

export function isContextOverflowResult(result: { code: number; stdout: string; stderr: string }, reply: string): boolean {
  // Successful replies can discuss this error. Require an error-shaped prefix
  // in that case, and never inspect echoed requests or diagnostics in stdout.
  if (result.code === 0) {
    return /^(?:(?:error|bad request|400)[:\s-]*)?(?:context[_ -](?:overflow|length[_ -]exceeded|window[_ -]exceeded)|prompt (?:is )?too (?:large|long)|request_too_large|maximum context length|input (?:token count exceeds|exceeds the maximum|too long for the model))/i.test(reply.trim())
  }
  return isContextOverflowReply(reply) || isContextOverflowReply(result.stderr)
}

export const CONTEXT_OVERFLOW_CONTINUATION = [
  'The previous turn exceeded the model context limit. This is an automatic continuation in a fresh session.',
  'Inspect durable workspace progress and available memory before acting. Preserve completed work and verify whether actions already happened before repeating them.',
  'Continue the user request below; earlier conversation context may no longer be available.',
].join('\n')
