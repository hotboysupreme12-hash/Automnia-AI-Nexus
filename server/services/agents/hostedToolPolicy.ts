const LEGACY_HOSTED_TOOLS = ['read', 'write', 'edit', 'exec', 'process', 'cron', 'memory_get', 'session_status']

/** Remove only Automnia's generated budget restriction, preserving operator policies. */
export function removeGeneratedHostedToolAllowlist<T extends { allow?: string[] }>(policy: T): T {
  if (!policy.allow || policy.allow.length !== LEGACY_HOSTED_TOOLS.length
    || !LEGACY_HOSTED_TOOLS.every((tool) => policy.allow?.includes(tool))) return policy
  const next = { ...policy }
  delete next.allow
  return next
}
