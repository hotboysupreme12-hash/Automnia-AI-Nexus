import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const distRoot = path.resolve('vendor/openclaw/dist')
const bundles = readdirSync(distRoot).filter((name) => /^settled-turn-finalization-result-.*\.js$/.test(name))
assert.equal(bundles.length, 1, 'OpenClaw must expose one settled-turn finalization result bundle')

const { n: projectSettledTurnFinalizationAttemptResult } = await import(pathToFileURL(path.join(distRoot, bundles[0])).href)

function assistant(text = 'The completed result is available.') {
  return {
    role: 'assistant',
    stopReason: 'stop',
    content: [{ type: 'text', text }],
  }
}

function baseResult() {
  return {
    terminal: { kind: 'ok' },
    compactionCount: 0,
    currentAttemptCompletedAssistant: assistant(),
    toolMetas: [],
    itemLifecycle: { startedCount: 0, completedCount: 0, activeCount: 0 },
    replayMetadata: { hadPotentialSideEffects: false, replaySafe: true },
    currentAttemptReplayMetadata: { hadPotentialSideEffects: false, replaySafe: true },
    clientToolCalls: [],
    acceptedSessionSpawns: [],
    didSendViaMessagingTool: false,
    didDeliverSourceReplyViaMessageTool: false,
    didSendDeterministicApprovalPrompt: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    messagingToolSourceReplyPayloads: [],
    toolMediaUrls: [],
    hostOwnedToolMediaUrls: [],
    successfulCronAdds: 0,
    yieldDetected: false,
  }
}

const clean = projectSettledTurnFinalizationAttemptResult(baseResult())
assert.equal(clean.assistant.content[0].text, 'The completed result is available.')

const rejectedToolRecovery = projectSettledTurnFinalizationAttemptResult({
  ...baseResult(),
  currentAttemptCompletedAssistant: assistant('The completed result survived the recovery pass.'),
  toolMetas: [{ toolName: 'exec', toolCallId: 'recovery-1', isError: true, replaySafe: true }],
  itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
  lastToolError: { toolName: 'exec', error: 'Tool unavailable during tool-disabled recovery.' },
})
assert.equal(rejectedToolRecovery.assistant.content[0].text, 'The completed result survived the recovery pass.')

assert.throws(
  () => projectSettledTurnFinalizationAttemptResult({
    ...baseResult(),
    toolMetas: [{ toolName: 'exec', toolCallId: 'recovery-2', isError: false, replaySafe: false }],
    itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
    replayMetadata: { hadPotentialSideEffects: true, replaySafe: false },
  }),
  /Settled-turn finalization attempt reported capability activity/,
)

console.log('settled-turn finalization smoke passed')
