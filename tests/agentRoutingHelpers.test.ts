import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLAWTALK_CORE_BRIDGE_ROUTING_HELPER,
  TELEGRAM_AGENT_ROUTING_HELPER,
} from '../server/integrations/agentRoutingHelpers'

type RouteParser = (prompt: string, aliases: unknown[]) => { agentId?: string; prompt?: string } | null
type AliasBuilder = (config: unknown, fallbackAgentId: string) => { aliases: unknown[] }
type TelegramRouteResolver = (params: Record<string, unknown>) => {
  changed: boolean
  reason?: string
  route: { agentId?: string; sessionKey?: string }
}

function routingHarness(source: string, builder: string, parser: string) {
  return new Function(`${source}\nreturn { build: ${builder}, parse: ${parser} };`)() as {
    build: AliasBuilder
    parse: RouteParser
  }
}

const config = {
  agents: {
    list: [
      { id: 'hn-coordinator', identity: { name: 'Sarah Cooper' } },
      { id: 'hn-architect', identity: { name: 'Elena Vasquez' } },
    ],
  },
}

test('channel traffic gates resolve to the server-owned license endpoint', () => {
  const processStub = {
    env: {
      CONTROL_CENTER_AGENT_TURN_STREAM_URL: 'http://127.0.0.1:4050/api/openclaw/agent-turn/stream?source=telegram',
    },
  }
  const clawTalkResolver = new Function(
    'process',
    `${CLAWTALK_CORE_BRIDGE_ROUTING_HELPER}\nreturn resolveAutomniaTrafficGateUrl`,
  )(processStub) as () => string
  const telegramResolver = new Function(
    'process',
    `${TELEGRAM_AGENT_ROUTING_HELPER}\nreturn resolveTelegramTrafficGateUrl`,
  )(processStub) as () => string

  const expected = 'http://127.0.0.1:4050/api/license/traffic-gate'
  assert.equal(clawTalkResolver(), expected)
  assert.equal(telegramResolver(), expected)
})

test('Telegram traffic gate retries transient local failures and prefers the refreshed Control Center token', async () => {
  const calls: Array<{ url: string; authorization?: string }> = []
  let attempts = 0
  const fetchStub = async (url: string, options: { headers?: Record<string, string> }) => {
    attempts += 1
    calls.push({ url, authorization: options.headers?.Authorization })
    if (attempts === 1) throw new Error('ECONNREFUSED')
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { active: true, messageTrafficAllowed: true } }),
    }
  }
  const immediateTimer = (callback: () => void) => {
    callback()
    return 0
  }
  const statusResolver = new Function(
    'process',
    'fetch',
    'setTimeout',
    'clearTimeout',
    `${TELEGRAM_AGENT_ROUTING_HELPER}\nreturn resolveTelegramTrafficGateStatus`,
  )({
    env: {
      CONTROL_CENTER_AGENT_TURN_STREAM_URL: 'http://127.0.0.1:4050/api/openclaw/agent-turn/stream',
      CONTROL_CENTER_TOKEN: 'fresh-control-center-token',
      CLAWTALK_CONTROL_CENTER_TOKEN: 'stale-parent-token',
    },
  }, fetchStub, immediateTimer, () => undefined) as () => Promise<{ allowed: boolean; transient?: boolean }>

  const result = await statusResolver()
  assert.deepEqual(result, { allowed: true, transient: false })
  assert.equal(attempts, 2)
  assert.deepEqual(calls, [
    {
      url: 'http://127.0.0.1:4050/api/license/traffic-gate',
      authorization: 'Bearer fresh-control-center-token',
    },
    {
      url: 'http://127.0.0.1:4050/api/license/traffic-gate',
      authorization: 'Bearer fresh-control-center-token',
    },
  ])
})

test('Telegram recovery delivery retries a transient Telegram send failure', async () => {
  let sends = 0
  const sendRecovery = new Function(
    'withTelegramApiErrorLogging',
    'setTimeout',
    `${TELEGRAM_AGENT_ROUTING_HELPER}\nreturn sendTelegramRecoveryMessage`,
  )(
    async (params: { fn: () => Promise<void> }) => params.fn(),
    (callback: () => void) => {
      callback()
      return 0
    },
  ) as (params: Record<string, unknown>) => Promise<boolean>

  const delivered = await sendRecovery({
    bot: {
      api: {
        sendMessage: async () => {
          sends += 1
          if (sends === 1) throw new Error('temporary Telegram transport failure')
        },
      },
    },
    runtime: {},
    chatId: 'end-user-chat',
    messageId: 1,
    text: 'Automnia is still starting. Please try again in a moment.',
  })

  assert.equal(delivered, true)
  assert.equal(sends, 2)
})

test('Telegram routes slash and at commands with compact names and compact agent ids', () => {
  const harness = routingHarness(
    TELEGRAM_AGENT_ROUTING_HELPER,
    'buildTelegramAgentAliases',
    'parseTelegramAgentRoutePrefix',
  )
  const aliases = harness.build(config, 'hn-coordinator').aliases

  assert.deepEqual(harness.parse('/SarahCooper: status', aliases), {
    mode: '/',
    alias: 'SarahCooper',
    agentId: 'hn-coordinator',
    prompt: 'status',
  })
  assert.deepEqual(harness.parse('@hnarchitect draft the plan', aliases), {
    mode: '@',
    alias: 'hnarchitect',
    agentId: 'hn-architect',
    prompt: 'draft the plan',
  })
  assert.deepEqual(harness.parse('\\SarahCooper: status', aliases), {
    mode: '/',
    alias: 'SarahCooper',
    agentId: 'hn-coordinator',
    prompt: 'status',
  })
})

test('Telegram slash routing remains sticky while at-routing is a one-shot override', () => {
  const routeResolver = new Function(`
    function normalizeAccountId(value) { return String(value || 'default') }
    function normalizeLowercaseStringOrEmpty(value) { return String(value || '').trim().toLowerCase() }
    function resolveAgentConfig(config, agentId) {
      return (config.agents?.list || []).find((agent) => agent.id === agentId) || {}
    }
    ${TELEGRAM_AGENT_ROUTING_HELPER}
    return resolveTelegramAgentRouteForMessage
  `)() as TelegramRouteResolver

  const routingConfig = {
    agents: {
      defaults: { model: { primary: 'openai/gpt-5.5' } },
      list: [
        { id: 'hn-coordinator', identity: { name: 'Sarah Cooper', role: 'Coordinator' } },
        { id: 'hn-architect', identity: { name: 'Elena Vasquez', role: 'Architect' } },
        { id: 'hn-crypto-lead', identity: { name: 'Marcus Chen', role: 'Lead Alpha Hunter' }, model: { primary: 'openai/gpt-5.5' } },
      ],
    },
    session: { dmScope: 'per-channel-peer' },
  }
  const base = {
    cfg: routingConfig,
    route: { agentId: 'hn-coordinator' },
    accountId: 'default',
    chatId: '8808849437',
    senderId: '8808849437',
    isGroup: false,
  }
  const routeState = globalThis as typeof globalThis & { __openclawTelegramAgentRoutes?: unknown }
  delete routeState.__openclawTelegramAgentRoutes
  try {
    const selected = routeResolver({ ...base, rawBody: '/Marcus status', bodyText: '/Marcus status' })
    assert.equal(selected.reason, 'sticky')
    assert.equal(selected.route.agentId, 'hn-crypto-lead')
    assert.equal(selected.route.sessionKey, 'agent:hn-crypto-lead:telegram:direct:8808849437')

    const stickyFollowUp = routeResolver({ ...base, rawBody: 'who are you?', bodyText: 'who are you?' })
    assert.equal(stickyFollowUp.reason, 'sticky')
    assert.equal(stickyFollowUp.route.agentId, 'hn-crypto-lead')

    const oneShot = routeResolver({ ...base, rawBody: '@Elena who are you?', bodyText: '@Elena who are you?' })
    assert.equal(oneShot.reason, 'one-shot-fresh')
    assert.equal(oneShot.route.agentId, 'hn-architect')
    assert.match(String(oneShot.route.sessionKey), /^agent:hn-architect:telegram:direct:8808849437:fresh:/)

    const stickyAfterMention = routeResolver({ ...base, rawBody: 'continue', bodyText: 'continue' })
    assert.equal(stickyAfterMention.reason, 'sticky')
    assert.equal(stickyAfterMention.route.agentId, 'hn-crypto-lead')

    // The resolver builds its aliases from the config supplied for each
    // message. This mirrors a newly recruited agent becoming available to a
    // running Gateway without hard-coding a roster in the channel patch.
    const futureAgentConfig = {
      ...routingConfig,
      agents: {
        ...routingConfig.agents,
        list: [
          ...routingConfig.agents.list,
          { id: 'research-nova', identity: { name: 'Nova Research', role: 'Research Analyst' }, model: { primary: 'openai/gpt-5.5' } },
        ],
      },
    }
    const futureSticky = routeResolver({ ...base, cfg: futureAgentConfig, rawBody: '\\NovaResearch status', bodyText: '\\NovaResearch status' })
    assert.equal(futureSticky.reason, 'sticky')
    assert.equal(futureSticky.route.agentId, 'research-nova')

    const futureOneShot = routeResolver({ ...base, cfg: futureAgentConfig, rawBody: '@research-nova who are you?', bodyText: '@research-nova who are you?' })
    assert.equal(futureOneShot.reason, 'one-shot-fresh')
    assert.equal(futureOneShot.route.agentId, 'research-nova')
  } finally {
    delete routeState.__openclawTelegramAgentRoutes
  }
})

test('Telegram native /agents lists configured agents and persists a per-chat selection', () => {
  const commandResolver = new Function(`
    function normalizeAccountId(value) { return String(value || 'default') }
    function normalizeLowercaseStringOrEmpty(value) { return String(value || '').trim().toLowerCase() }
    function resolveAgentConfig(config, agentId) {
      return (config.agents?.list || []).find((agent) => agent.id === agentId) || {}
    }
    ${TELEGRAM_AGENT_ROUTING_HELPER}
    return resolveTelegramAgentsCommandResponse
  `)() as (params: Record<string, unknown>) => string

  const routeState = globalThis as typeof globalThis & { __openclawTelegramAgentRoutes?: unknown }
  delete routeState.__openclawTelegramAgentRoutes
  const routingConfig = {
    agents: {
      defaults: { model: { primary: 'openai/gpt-5.5' } },
      list: [
        { id: 'hn-coordinator', identity: { name: 'Sarah Cooper', role: 'Coordinator' } },
        { id: 'hn-architect', identity: { name: 'Elena Vasquez', role: 'Architect' }, model: { primary: 'openai/gpt-5.5' } },
      ],
    },
  }
  const base = {
    cfg: routingConfig,
    accountId: 'default',
    chatId: 'telegram-chat-1',
    resolvedThreadId: undefined,
    dmThreadId: undefined,
    isGroup: false,
    routeAgentId: 'hn-coordinator',
  }
  try {
    const listed = commandResolver({ ...base, rawText: '' })
    assert.match(listed, /Sarah Cooper — hn-coordinator/)
    assert.match(listed, /Elena Vasquez — hn-architect/)
    assert.match(listed, /Active: hn-coordinator/)

    const selected = commandResolver({ ...base, rawText: 'ElenaVasquez' })
    assert.match(selected, /Telegram agent selected: Elena Vasquez \(hn-architect\)/)

    const afterSelection = commandResolver({ ...base, rawText: '' })
    assert.match(afterSelection, /Active: hn-architect/)
    assert.match(afterSelection, /✓ Elena Vasquez — hn-architect/)

    const reset = commandResolver({ ...base, rawText: 'reset' })
    assert.match(reset, /Telegram agent reset/)
    const afterReset = commandResolver({ ...base, rawText: '' })
    assert.match(afterReset, /Active: hn-coordinator/)
  } finally {
    delete routeState.__openclawTelegramAgentRoutes
  }
})

test('Telegram identity replies are verified against the selected agent profile before delivery', () => {
  const guard = new Function(`
    function normalizeAccountId(value) { return String(value || 'default') }
    function normalizeLowercaseStringOrEmpty(value) { return String(value || '').trim().toLowerCase() }
    function resolveAgentConfig(config, agentId) {
      return (config.agents?.list || []).find((agent) => agent.id === agentId) || {}
    }
    ${TELEGRAM_AGENT_ROUTING_HELPER}
    return applyTelegramVerifiedIdentityDeliveryGuard
  `)() as (params: Record<string, unknown>) => { text?: string }

  const guarded = guard({
    payload: { text: 'I am Codex, your coding assistant.' },
    info: { kind: 'final' },
    prompt: 'who are you?',
    agentId: 'hn-crypto-lead',
    config: {
      agents: {
        list: [{
          id: 'hn-crypto-lead',
          identity: { name: 'Marcus Chen', role: 'Lead Alpha Hunter' },
          model: { primary: 'openai/gpt-5.5' },
        }],
      },
    },
  })

  assert.equal(guarded.text, 'I am Marcus Chen, Lead Alpha Hunter (agent id: hn-crypto-lead). I am the Automnia agent selected for this Telegram message.')
})

test('Telegram model callbacks are locked to Automnia credits for Starter runtime config', () => {
  const selectionAllowed = new Function(`
    ${TELEGRAM_AGENT_ROUTING_HELPER}
    return telegramCreditsOnlyModelSelectionAllowed
  `)() as (config: unknown, callback: unknown) => boolean

  const starterConfig = { env: { vars: { AUTOMNIA_CREDITS_ONLY: '1' } } }
  assert.equal(selectionAllowed(starterConfig, { type: 'select', provider: 'automnia-cloud', model: 'gemini-3.7-flash' }), true)
  assert.equal(selectionAllowed(starterConfig, { type: 'select', provider: 'google', model: 'gemini-2.5-pro' }), false)
  assert.equal(selectionAllowed(starterConfig, { type: 'select', provider: 'openai', model: 'gpt-5.5' }), false)
  assert.equal(selectionAllowed({}, { type: 'select', provider: 'google', model: 'gemini-2.5-pro' }), true)
})

test('Telegram Automnia model detection does not leak a regex flag as a variable', () => {
  const isAutomniaCreditsModel = new Function(`
    ${TELEGRAM_AGENT_ROUTING_HELPER}
    return isTelegramAutomniaCreditsModel
  `)() as (value: unknown) => boolean

  assert.equal(isAutomniaCreditsModel('automnia-cloud/gemini-3.7-flash'), true)
  assert.equal(isAutomniaCreditsModel('openai/gpt-5.5'), false)
})

test('Telegram model menus expose only Automnia credits for Starter runtime config', () => {
  const restrictModelData = new Function(`
    ${TELEGRAM_AGENT_ROUTING_HELPER}
    return telegramCreditsOnlyModelData
  `)() as (config: unknown, data: { byProvider: Map<string, Set<string>>; providers: string[] }) => {
    byProvider: Map<string, Set<string>>
    providers: string[]
  }

  const restricted = restrictModelData(
    { env: { vars: { AUTOMNIA_CREDITS_ONLY: '1' } } },
    { byProvider: new Map([['google', new Set(['gemini-2.5-pro'])]]), providers: ['google'] },
  )
  assert.deepEqual(restricted.providers, ['automnia-cloud'])
  assert.deepEqual(Array.from(restricted.byProvider.get('automnia-cloud') || []), ['gemini-3.7-flash'])
})

test('Telegram route construction is self-contained in the injected runtime bundle', () => {
  const routeBuilder = new Function(`
    function normalizeAccountId(value) { return String(value || 'default') }
    function resolveAgentConfig() { return {} }
    function normalizeLowercaseStringOrEmpty(value) { return String(value || '').trim().toLowerCase() }
    ${TELEGRAM_AGENT_ROUTING_HELPER}
    return buildTelegramRouteForAgent
  `)() as (params: Record<string, unknown>, agentId: string, options?: Record<string, unknown>) => Record<string, unknown>

  const route = routeBuilder({
    isGroup: false,
    chatId: '12345',
    senderId: '12345',
    accountId: 'default',
    cfg: { session: {} },
    route: { agentId: 'hn-coordinator' },
  }, 'hn-architect')

  assert.equal(route.agentId, 'hn-architect')
  assert.equal(route.sessionKey, 'agent:hn-architect:main')
})

test('Telegram route construction retains direct-message peer scope without external bundle helpers', () => {
  const routeBuilder = new Function(`
    function normalizeAccountId(value) { return String(value || 'default') }
    function resolveAgentConfig() { return {} }
    function normalizeLowercaseStringOrEmpty(value) { return String(value || '').trim().toLowerCase() }
    ${TELEGRAM_AGENT_ROUTING_HELPER}
    return buildTelegramRouteForAgent
  `)() as (params: Record<string, unknown>, agentId: string, options?: Record<string, unknown>) => Record<string, unknown>

  const route = routeBuilder({
    isGroup: false,
    chatId: '12345',
    senderId: '67890',
    accountId: 'default',
    cfg: { session: { dmScope: 'per-channel-peer' } },
    route: { agentId: 'hn-coordinator' },
  }, 'hn-architect')

  assert.equal(route.sessionKey, 'agent:hn-architect:telegram:direct:67890')
})

test('ClawTalk routes slash and at commands with the same compact aliases', () => {
  const harness = routingHarness(
    CLAWTALK_CORE_BRIDGE_ROUTING_HELPER,
    'buildClawTalkAgentAliases',
    'parseClawTalkRoutePrefix',
  )
  const aliases = harness.build(config, 'hn-coordinator').aliases

  assert.deepEqual(harness.parse('/ElenaVasquez: review this', aliases), {
    mode: '/',
    alias: 'ElenaVasquez',
    agentId: 'hn-architect',
    prompt: 'review this',
  })
  assert.deepEqual(harness.parse('@architect answer this once', aliases), {
    mode: '@',
    alias: 'architect',
    agentId: 'hn-architect',
    prompt: 'answer this once',
  })
})
