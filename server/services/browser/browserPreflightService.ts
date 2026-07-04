export type BrowserPreflightReason =
  | 'ready'
  | 'browser_plugin_disabled'
  | 'gateway_unhealthy'
  | 'relay_unreachable'
  | 'browser_probe_failed'

export type BrowserPreflightResult = {
  ok: boolean
  reason: BrowserPreflightReason
  message: string
  detail?: string
}

export type BrowserPluginStatus = {
  enabled: boolean
  detail?: string
}

export type BrowserGatewayRestartResult = {
  restarted: boolean
  detail: string
}

export type BrowserRelayStartResult = {
  started: boolean
  detail: string
}

export type BrowserToolProbeResult = {
  ok: boolean
  detail: string
}

export type BrowserPreflightServiceOptions = {
  ensureOpenclawAgentRunConfigDefaults: () => Promise<unknown>
  getOpenClawPluginEnabled: (pluginId: string) => Promise<BrowserPluginStatus>
  repairGatewayTokenConfigSync: () => { repaired: boolean; detail?: string }
  ensureGatewayRunning: () => Promise<unknown>
  startGatewayHealthMonitor: () => void
  isGatewayHealthy: () => Promise<boolean>
  tryRestartGatewayService: (options: { reason: string }) => Promise<BrowserGatewayRestartResult>
  tryStartBrowserRelayWithRepair: () => Promise<BrowserRelayStartResult>
  runBrowserToolProbe: (agentId: string) => Promise<BrowserToolProbeResult>
  tryReleaseBrowserRelayPort: () => Promise<{ released: boolean; detail: string }>
  hasBrowserRelayPortConflict: (detail: string) => boolean
  hasNoAttachedBrowserTab: (detail: string) => boolean
  redactSensitiveText: (value: string) => string
  delayMs?: (ms: number) => Promise<unknown>
  now?: () => number
  gatewayRecoveryWaitMs?: number
  gatewayRecoveryPollMs?: number
}

function defaultDelayMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeDetail(value: unknown, redactSensitiveText: (value: string) => string) {
  return redactSensitiveText(typeof value === 'string' ? value : String(value ?? '')).trim()
}

function detailOrFallback(value: unknown, fallback: string, redactSensitiveText: (value: string) => string) {
  return sanitizeDetail(value, redactSensitiveText) || fallback
}

function joinDetails(parts: Array<unknown>, redactSensitiveText: (value: string) => string) {
  const detail = parts
    .map((part) => sanitizeDetail(part, redactSensitiveText))
    .filter(Boolean)
    .join('\n')
  return detail || undefined
}

function normalizeRelayStartResult(value: unknown, redactSensitiveText: (value: string) => string): BrowserRelayStartResult {
  if (!value || typeof value !== 'object') {
    return {
      started: false,
      detail: 'Browser relay returned an invalid preflight payload.',
    }
  }

  const record = value as { started?: unknown; detail?: unknown }
  if (typeof record.started !== 'boolean') {
    return {
      started: false,
      detail: detailOrFallback(record.detail, 'Browser relay returned an invalid preflight payload.', redactSensitiveText),
    }
  }

  return {
    started: record.started,
    detail: detailOrFallback(record.detail, 'browser relay bootstrap did not produce diagnostic output.', redactSensitiveText),
  }
}

export function createBrowserPreflightService(options: BrowserPreflightServiceOptions) {
  const delayMs = options.delayMs || defaultDelayMs
  const now = options.now || Date.now
  const gatewayRecoveryWaitMs = options.gatewayRecoveryWaitMs ?? 7000
  const gatewayRecoveryPollMs = options.gatewayRecoveryPollMs ?? 900
  const redact = options.redactSensitiveText

  const probeGatewayHealth = async () => {
    const gatewayOk = await options.isGatewayHealthy()
    return {
      gatewayOk,
      gatewayNormalized: gatewayOk ? 'gateway health ok (http)' : 'gateway /health did not respond',
      code: gatewayOk ? 0 : 1,
    }
  }

  const waitForGatewayHealthy = async (maxMs: number) => {
    const started = now()
    let lastDetail = ''
    while (now() - started < maxMs) {
      const probe = await probeGatewayHealth()
      lastDetail = probe.gatewayNormalized
      if (probe.gatewayOk) return { ok: true, detail: probe.gatewayNormalized }
      await delayMs(gatewayRecoveryPollMs)
    }
    return { ok: false, detail: lastDetail }
  }

  const startBrowserRelay = async () => normalizeRelayStartResult(await options.tryStartBrowserRelayWithRepair(), redact)

  async function checkBrowserPreflight(agentId?: string): Promise<BrowserPreflightResult> {
    await options.ensureOpenclawAgentRunConfigDefaults().catch(() => undefined)
    const browserPlugin = await options.getOpenClawPluginEnabled('browser')
    if (!browserPlugin.enabled) {
      return {
        ok: false,
        reason: 'browser_plugin_disabled',
        message: 'Browser preflight skipped: the OpenClaw browser plugin is disabled.',
        detail: sanitizeDetail(browserPlugin.detail, redact),
      }
    }

    const configRepair = options.repairGatewayTokenConfigSync()
    await options.ensureGatewayRunning()
    options.startGatewayHealthMonitor()

    let firstProbe = await probeGatewayHealth()
    if (!firstProbe.gatewayOk && /token_missing|gateway token missing|unauthorized/i.test(firstProbe.gatewayNormalized)) {
      options.repairGatewayTokenConfigSync()
      firstProbe = await probeGatewayHealth()
    }

    const gatewayNormalized = firstProbe.gatewayNormalized
    const gatewayOk = firstProbe.gatewayOk
    if (!gatewayOk) {
      const recovered = await options.tryRestartGatewayService({ reason: 'browser relay gateway recovery' })
      const recheck = await waitForGatewayHealthy(gatewayRecoveryWaitMs)
      if (recheck.ok) {
        const browserStartedAfterRecovery = await startBrowserRelay()
        if (browserStartedAfterRecovery.started) {
          return {
            ok: true,
            reason: 'ready',
            message: 'Browser relay preflight passed after gateway recovery.',
            detail: joinDetails([
              configRepair.repaired ? `[gateway-token-autofix] ${configRepair.detail}` : '',
              `Gateway recovered and browser service started.\n${browserStartedAfterRecovery.detail}`,
            ], redact),
          }
        }
      }

      return {
        ok: false,
        reason: 'gateway_unhealthy',
        message: 'Browser preflight failed: OpenClaw gateway is not healthy. Start a single gateway instance and retry.',
        detail: joinDetails([
          configRepair.repaired ? `[gateway-token-autofix] ${configRepair.detail}` : '',
          gatewayNormalized || `gateway health exit code ${firstProbe.code}`,
          recovered.detail ? `recovery: ${recovered.detail}` : '',
        ], redact) || `gateway health exit code ${firstProbe.code}`,
      }
    }

    const started = await startBrowserRelay()
    if (!started.started) {
      const startDetail = started.detail || 'browser relay bootstrap did not produce diagnostic output.'
      const attachHint = options.hasNoAttachedBrowserTab(startDetail)
        ? 'Relay process is up but no tab is attached. Click the OpenClaw/Clawdbot extension icon on any Chrome tab, then retry.'
        : 'Browser service did not become ready after bootstrap.'

      return {
        ok: false,
        reason: 'relay_unreachable',
        message: 'Browser preflight failed: OpenClaw browser service is unreachable. Start or attach the browser runtime, then retry.',
        detail: joinDetails([attachHint, startDetail], redact),
      }
    }

    if (agentId) {
      let probe = await options.runBrowserToolProbe(agentId)
      if (!probe.ok && options.hasBrowserRelayPortConflict(probe.detail)) {
        const released = await options.tryReleaseBrowserRelayPort()
        if (released.released) {
          probe = await options.runBrowserToolProbe(agentId)
        }
      }

      if (!probe.ok) {
        return {
          ok: true,
          reason: 'ready',
          message: 'Browser relay preflight passed with probe warning. Proceeding with execution.',
          detail: joinDetails([`probe-warning: ${probe.detail}`], redact),
        }
      }
    }

    return {
      ok: true,
      reason: 'ready',
      message: 'Browser relay preflight passed.',
      detail: joinDetails([
        configRepair.repaired ? `[gateway-token-autofix] ${configRepair.detail}` : '',
        `Gateway health OK and browser bootstrap succeeded.\n${started.detail}`,
      ], redact),
    }
  }

  return { checkBrowserPreflight }
}
