export const CONVERSATION_TRUNCATION_MARKER = '\n[Content shortened to fit the conversation context limit.]\n'

type ConversationMessage = { role: 'user' | 'assistant'; content: string; reasoningContent?: string }

function shorten(value: string, limit: number) {
  if (value.length <= limit) return value
  if (limit <= CONVERSATION_TRUNCATION_MARKER.length) return CONVERSATION_TRUNCATION_MARKER.slice(0, limit)
  const retained = limit - CONVERSATION_TRUNCATION_MARKER.length
  const tail = Math.floor(retained / 2)
  return value.slice(0, Math.ceil(retained / 2)) + CONVERSATION_TRUNCATION_MARKER + (tail ? value.slice(-tail) : '')
}

export function boundConversationMessages<T extends ConversationMessage>(messages: T[], maxMessages: number, maxChars: number): T[] {
  const messageLimit = Number.isFinite(maxMessages) ? Math.max(1, Math.floor(maxMessages)) : 8
  const charLimit = Number.isFinite(maxChars) ? Math.max(1, Math.floor(maxChars)) : 32000
  const size = (items: T[]) => items.reduce((total, item) => total + item.content.length + (item.reasoningContent?.length || 0), 0)
  let next = messages.filter((message) => message.content.trim() || message.reasoningContent?.trim()).slice(-messageLimit)
  while (next.length > 2 && size(next) > charLimit) next = next.slice(2)
  if (size(next) <= charLimit) return next
  // Visible answers and the newest request take precedence over old reasoning.
  next = next.map((message) => ({ ...message, reasoningContent: undefined }))
  if (size(next) <= charLimit) return next
  let remaining = charLimit
  return next.map((message, index) => {
    const budget = Math.min(message.content.length, Math.floor(remaining / (next.length - index)))
    remaining -= budget
    return { ...message, content: shorten(message.content, budget) }
  })
}
