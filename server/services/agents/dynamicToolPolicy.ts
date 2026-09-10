// Tool authorization and model-visible schemas are separate. Full permission
// grants the catalog; Tool Search exposes schemas only when they are needed.
export const DYNAMIC_TOOL_SEARCH = { enabled: true, mode: 'tools' as const, searchDefaultLimit: 3, maxSearchLimit: 8 }

// The safe starting surface for a newly recruited or restricted agent. The
// operator can replace this list in Permissions; it is never re-applied once
// an explicit allow/deny policy exists.
export const BASIC_RESTRICTED_TOOLS = ['read', 'write', 'edit', 'apply_patch', 'session_status'] as const

export function restrictedToolDefaults<T extends { allow?: string[]; deny?: string[]; profile?: string }>(policy: T): T {
  if ((policy.allow?.length || 0) > 0 || (policy.deny?.length || 0) > 0) return policy
  return { ...policy, profile: policy.profile || 'full', allow: [...BASIC_RESTRICTED_TOOLS] }
}

export function fullAccessToolPolicy<T extends { exec?: { security?: string; ask?: string }; profile?: string; allow?: string[]; alsoAllow?: string[]; deny?: string[]; byProvider?: unknown; sandbox?: unknown }>(policy: T): T {
  if (policy.exec?.security !== 'full' || policy.exec?.ask !== 'off') return policy
  const next = { ...policy, profile: 'full' }
  delete next.allow
  delete next.alsoAllow
  delete next.deny
  delete next.byProvider
  delete next.sandbox
  return next
}
