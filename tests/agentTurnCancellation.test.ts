import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Express } from 'express'
import { registerAgentTurnRoutes } from '../server/routes/agentTurnRoutes'

test('a stopped, disconnected Command Console turn records a terminal result', async () => {
  const routes = new Map<string, (req: unknown, res: unknown) => unknown>()
  const app = {
    post: (path: string, handler: (req: unknown, res: unknown) => unknown) => routes.set(`POST ${path}`, handler),
    delete: (path: string, handler: (req: unknown, res: unknown) => unknown) => routes.set(`DELETE ${path}`, handler),
    get: () => undefined,
  }
  const mirrored: Array<{ event: string; data: Record<string, unknown> }> = []
  let dispatched!: () => void
  const started = new Promise<void>((resolve) => { dispatched = resolve })
  const options = {
    SSE_DELTA_CHUNK_CHARS: 10000,
    SSE_FINAL_TEXT_LIMIT: 10000,
    isValidAgentId: () => true,
    isRetiredAgentId: () => false,
    compactClawTalkConsoleValue: (value: string) => value,
    compactFinalSsePayload: (value: Record<string, unknown>) => value,
    rememberClawTalkConsoleMirror: () => undefined,
    emitClawTalkConsoleFrame: (event: string, _context: unknown, data: Record<string, unknown>) => { mirrored.push({ event, data }); return true },
    initializeSseResponse: () => undefined,
    writeSseEvent: () => undefined,
    delayMs: async () => undefined,
    redactHiddenReasoningAndSecrets: (value: string) => value,
    classifyFailureKind: (_message: string, fallback: string) => fallback,
    streamProviderAgentTurn: async (_input: unknown, _emit: unknown, signal: AbortSignal) => {
      dispatched()
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }))
      return {}
    },
  } as unknown as Parameters<typeof registerAgentTurnRoutes>[1]
  registerAgentTurnRoutes(app as unknown as Express, options)
  const responseId = crypto.randomUUID()
  const response = Object.assign(new EventEmitter(), { flushHeaders() {}, end() {} })
  const request = { body: { agent: 'agent-a', message: 'work', responseId, forceOpenClawRuntime: true }, get: () => '' }
  const run = Promise.resolve(routes.get('POST /api/openclaw/agent-turn/stream')!(request, response))
  await started
  response.emit('close')
  const cancelResponse = { getHeader() { return undefined }, setHeader() {}, status() { return this }, json(value: unknown) { return value } }
  routes.get('DELETE /api/openclaw/agent-turn/:responseId')!({ params: { responseId } }, cancelResponse)
  await run
  assert.equal(mirrored.some(({ data }) => data.fallbackPending === true), false)
  assert.equal(mirrored.at(-1)?.event, 'final')
  assert.equal(mirrored.at(-1)?.data.failureKind, 'aborted')
})
