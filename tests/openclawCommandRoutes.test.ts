import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import express from 'express'
import {
  parseGatewaySummaryStdout,
  redactSensitiveCommandArgs,
  registerOpenClawCommandRoutes,
  sanitizeSummaryConfigValue,
  stripAnsiCodes,
  type OpenClawCommandRoutesOptions,
} from '../server/routes/openclawCommandRoutes'
import { applyDiagnosticRedactions } from '../src/utils/diagnosticRedaction'

const redactSensitiveText = (value: string) =>
  applyDiagnosticRedactions(stripAnsiCodes(value || ''))

async function withOpenClawCommandServer<T>(
  overrides: Partial<OpenClawCommandRoutesOptions>,
  run: (ctx: {
    baseUrl: string
    gatewayLogs: Array<{ stream: string; message: string }>
    openClawCalls: Array<{ args: string[]; timeoutMs?: number }>
  }) => Promise<T>,
): Promise<T> {
  const gatewayLogs: Array<{ stream: string; message: string }> = []
  const openClawCalls: Array<{ args: string[]; timeoutMs?: number }> = []

  const app = express()
  app.use(express.json())

  const defaultOptions: OpenClawCommandRoutesOptions = {
    activeShifts: () => [{ id: 'shift-1' }],
    getPartyMembers: async () => [{ id: 'hn-architect', name: 'Elena Vasquez' }],
    invalidateRuntimeStatusCache: () => undefined,
    listMissionViews: () => [],
    listPluginControls: async () => ({
      plugins: [],
      configPath: '/tmp/openclaw.json',
      cache: { source: 'openclaw', refreshedAt: 1, refreshing: false },
    }),
    missionFeed: () => [],
    openclawConfigPath: '/tmp/openclaw.json',
    parseOpenClawCommandInput: (input) => input.trim().split(/\s+/).filter(Boolean),
    pluginCommandResult: (args, result) => ({
      command: `openclaw ${args.join(' ')}`,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    }),
    pluginCommandString: (args) => `openclaw ${args.join(' ')}`,
    pushGatewayLog: (stream, message) => {
      gatewayLogs.push({ stream, message })
    },
    redactSensitiveText,
    runOpenClaw: async (args, timeoutMs) => {
      openClawCalls.push({ args, timeoutMs })
      return { stdout: '{}', stderr: '', code: 0, elapsedMs: 12 }
    },
    ...overrides,
  }

  registerOpenClawCommandRoutes(app, defaultOptions)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    return await run({ baseUrl, gatewayLogs, openClawCalls })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

test('parseGatewaySummaryStdout parses clean, ANSI-wrapped, and diagnostic-prefixed JSON without throwing on non-JSON output', () => {
  assert.deepEqual(parseGatewaySummaryStdout('{"port":3400,"bind":"loopback"}\n'), {
    port: 3400,
    bind: 'loopback',
  })
  assert.deepEqual(
    parseGatewaySummaryStdout('\u001b[33m[warn] ExperimentalWarning\u001b[0m\n{\n  "port": 3401\n}\n'),
    { port: 3401 },
  )
  assert.equal(parseGatewaySummaryStdout('gateway config key is unset'), null)
  assert.equal(parseGatewaySummaryStdout('   '), null)
})

test('sanitizeSummaryConfigValue redacts sensitive nested keys and embedded bearer/API secrets while preserving safe fields', () => {
  const input = {
    port: 3400,
    bind: '127.0.0.1',
    auth: {
      token: 'oc_live_super_secret_gateway_token_12345',
      signingKey: 'raw-signing-secret',
      emptyToken: '',
      mode: 'local',
    },
    note: 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456',
  }
  const sanitized = sanitizeSummaryConfigValue(input, redactSensitiveText) as Record<string, unknown>
  assert.equal(sanitized.port, 3400)
  assert.equal(sanitized.bind, '127.0.0.1')
  const auth = sanitized.auth as Record<string, unknown>
  assert.equal(auth.token, '[redacted]')
  assert.equal(auth.signingKey, '[redacted]')
  assert.equal(auth.emptyToken, '')
  assert.equal(auth.mode, 'local')
  assert.ok(!String(sanitized.note).includes('sk-abcdefghijklmnopqrstuvwxyz123456'))
})

test('redactSensitiveCommandArgs masks inline secret flags, split secret flags, and config set secret values', () => {
  assert.deepEqual(
    redactSensitiveCommandArgs(['gateway', '--token', 'raw-token-999', '--port', '3400'], redactSensitiveText),
    ['gateway', '--token', '[redacted]', '--port', '3400'],
  )
  assert.deepEqual(
    redactSensitiveCommandArgs(['login', '--api-key=my-secret-value'], redactSensitiveText),
    ['login', '--api-key=[redacted]'],
  )
  assert.deepEqual(
    redactSensitiveCommandArgs(['config', 'set', 'gateway.auth.token', 'super-secret-value'], redactSensitiveText),
    ['config', 'set', 'gateway.auth.token', '[redacted]'],
  )
})

test('GET /api/openclaw/summary applies bounded subcommand timeouts, survives non-JSON stdout, and redacts gateway/status/cron secrets', async () => {
  await withOpenClawCommandServer(
    {
      runOpenClaw: async (args, timeoutMs) => {
        if (args[0] === 'status') {
          assert.equal(timeoutMs, 90_000)
          return { stdout: 'Gateway active | Authorization: Bearer secret-bearer-xyz987654321', stderr: '', code: 0 }
        }
        if (args[0] === 'config') {
          assert.equal(timeoutMs, 30_000)
          return {
            stdout: '[info] loading config\n{"port":3400,"auth":{"token":"gw-secret-token-abc","password":"pw-123"},"host":"127.0.0.1"}',
            stderr: '',
            code: 0,
          }
        }
        assert.equal(timeoutMs, 30_000)
        return { stdout: 'job-1 --api-key=sk-1234567890abcdefghijklmnop', stderr: '', code: 0 }
      },
    },
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/openclaw/summary`)
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.ok, true)
      assert.equal(body.data.gateway.port, 3400)
      assert.equal(body.data.gateway.host, '127.0.0.1')
      assert.equal(body.data.gateway.auth.token, '[redacted]')
      assert.equal(body.data.gateway.auth.password, '[redacted]')
      assert.ok(!String(body.data.status).includes('secret-bearer-xyz987654321'))
      assert.ok(!String(body.data.cron).includes('sk-1234567890abcdefghijklmnop'))
    },
  )

  await withOpenClawCommandServer(
    {
      runOpenClaw: async (args) => {
        if (args[0] === 'config') {
          return { stdout: 'WARN: gateway section not configured (plain text)', stderr: '', code: 0 }
        }
        return { stdout: 'ok', stderr: '', code: 0 }
      },
    },
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/openclaw/summary`)
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.ok, true)
      assert.equal(body.data.gateway, null)
    },
  )
})

test('POST /api/openclaw/command blocks control characters and redacts secrets from gateway logs, command result, and cliError', async () => {
  await withOpenClawCommandServer(
    {
      runOpenClaw: async (args) => {
        // Real underlying CLI still receives unredacted args so legitimate operator commands work
        assert.deepEqual(args, ['config', 'set', 'gateway.auth.token', 'my-raw-gateway-secret'])
        return {
          stdout: 'Saved token Bearer sk-secretstdouttoken1234567890',
          stderr: 'Debug api_key=sk-secretstderrtoken1234567890',
          code: 0,
          elapsedMs: 25,
        }
      },
      listPluginControls: async () => {
        throw new Error('plugin refresh failed: Authorization: Bearer sk-pluginerrorsecret1234567890')
      },
    },
    async ({ baseUrl, gatewayLogs }) => {
      const controlCharRes = await fetch(`${baseUrl}/api/openclaw/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'status\u0000--json' }),
      })
      assert.equal(controlCharRes.status, 400)
      assert.equal((await controlCharRes.json()).error.code, 'invalid_payload')

      const okRes = await fetch(`${baseUrl}/api/openclaw/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'config set gateway.auth.token my-raw-gateway-secret' }),
      })
      assert.equal(okRes.status, 200)
      const body = await okRes.json()
      assert.equal(body.ok, true)

      const serializedResponse = JSON.stringify(body)
      assert.ok(!serializedResponse.includes('my-raw-gateway-secret'))
      assert.ok(!serializedResponse.includes('sk-secretstdouttoken1234567890'))
      assert.ok(!serializedResponse.includes('sk-secretstderrtoken1234567890'))
      assert.ok(!serializedResponse.includes('sk-pluginerrorsecret1234567890'))

      const combinedLogs = gatewayLogs.map((entry) => entry.message).join('\n')
      assert.ok(!combinedLogs.includes('my-raw-gateway-secret'))
      assert.ok(!combinedLogs.includes('sk-secretstdouttoken1234567890'))
      assert.ok(!combinedLogs.includes('sk-secretstderrtoken1234567890'))
    },
  )
})
