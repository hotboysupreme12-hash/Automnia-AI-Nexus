import type { Express } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'

type SseWritable = {
  write: (chunk: string) => unknown
}

type SseResponse = SseWritable & {
  writeHead: (status: number, headers: Record<string, string>) => unknown
  flushHeaders?: () => void
  on: (event: 'close', listener: () => void) => unknown
}

type ClawTalkConsoleClient = SseWritable & {
  closed: boolean
}

type ClawTalkConsoleFinalInput = {
  agentId: string
  sessionKey: string
  prompt: string
  reply: string
  ok: boolean
  transport: string
  buffered: boolean
  liveTokens: boolean
}

type ClawTalkConsoleRoutesOptions = {
  clawTalkConsoleClients: Map<string, ClawTalkConsoleClient>
  clawTalkConsoleEvents: Array<Record<string, unknown>>
  initializeSseResponse: (res: SseResponse) => void
  isRetiredAgentId: (agentId: string | undefined) => boolean
  isValidAgentId: (agentId: string) => boolean
  recordClawTalkConsoleFinal: (input: ClawTalkConsoleFinalInput) => { emitted: boolean; clawTalkRunId: string }
  writeSseEvent: (res: SseWritable, event: string, data: Record<string, unknown>) => void
}

export function registerClawTalkConsoleRoutes(app: Express, options: ClawTalkConsoleRoutesOptions) {
  app.get('/api/openclaw/clawtalk-console/stream', (_req, res) => {
    options.initializeSseResponse(res)
    const clientId = randomUUID()
    const client = { write: (chunk: string) => res.write(chunk), closed: false }
    options.clawTalkConsoleClients.set(clientId, client)

    for (const event of [...options.clawTalkConsoleEvents].reverse()) {
      const eventName = typeof event.event === 'string' && event.event.trim() ? event.event.trim() : 'message'
      options.writeSseEvent(res, eventName, event)
    }

    const heartbeat = setInterval(() => {
      if (client.closed) return
      options.writeSseEvent(res, 'heartbeat', { at: new Date().toISOString() })
    }, 20_000)
    heartbeat.unref?.()

    res.on('close', () => {
      client.closed = true
      clearInterval(heartbeat)
      options.clawTalkConsoleClients.delete(clientId)
    })
  })

  app.post('/api/openclaw/clawtalk-console/final', (req, res) => {
    const schema = z.object({
      source: z.literal('clawtalk').optional(),
      agent: z.string().min(1),
      sessionKey: z.string().min(1).optional(),
      prompt: z.string().optional(),
      reply: z.string().optional(),
      text: z.string().optional(),
      ok: z.boolean().optional(),
      transport: z.string().optional(),
      buffered: z.boolean().optional(),
      liveTokens: z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return apiFailure(res, 400, 'invalid_payload', 'Invalid payload', parsed.error.flatten())

    try {
      const agentId = parsed.data.agent.trim()
      if (!options.isValidAgentId(agentId) || options.isRetiredAgentId(agentId)) {
        return apiFailure(res, 400, 'invalid_payload', 'Invalid or retired agent id.')
      }
      const result = options.recordClawTalkConsoleFinal({
        agentId,
        sessionKey: parsed.data.sessionKey?.trim() || `clawtalk:${agentId}`,
        prompt: parsed.data.prompt?.trim() || 'ClawTalk message',
        reply: (parsed.data.reply || parsed.data.text || '').trim(),
        ok: parsed.data.ok !== false,
        transport: parsed.data.transport?.trim() || 'clawtalk-control-center',
        buffered: parsed.data.buffered ?? true,
        liveTokens: parsed.data.liveTokens ?? false,
      })

      return apiSuccess(res, { ok: true, deduped: !result.emitted, clawTalkRunId: result.clawTalkRunId })
    } catch (error) {
      return apiFailure(res, 500, 'clawtalk_console_failed', 'Failed to record ClawTalk final event', String(error))
    }
  })
}
