/**
 * Some plugin changes alter process-lifetime registries rather than settings
 * the gateway can safely hot-reload.  Those plugins must restart before a
 * subsequent turn is allowed to select their runtime.
 */
export function pluginToggleRequiresGatewayRestart(pluginId: string): boolean {
  return pluginId.trim().toLowerCase() === 'codex'
}
