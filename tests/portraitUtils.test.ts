import assert from 'node:assert/strict'
import test from 'node:test'
import { agentPortraitSrc, localPortraitPathFromInput } from '../src/utils/portrait'

test('portrait helpers import only absolute local paths', () => {
  assert.equal(localPortraitPathFromInput('/Users/operator/avatar.png'), '/Users/operator/avatar.png')
  assert.equal(localPortraitPathFromInput('file:///Users/operator/avatar.png'), '/Users/operator/avatar.png')
  assert.equal(localPortraitPathFromInput('C:\\Users\\operator\\avatar.png'), 'C:\\Users\\operator\\avatar.png')
  assert.equal(localPortraitPathFromInput('\\\\server\\share\\avatar.png'), '\\\\server\\share\\avatar.png')
  assert.equal(localPortraitPathFromInput('.openclaw/avatars/agent-1.png'), '')
  assert.equal(localPortraitPathFromInput('avatars/agent-1.png'), '')
  assert.equal(localPortraitPathFromInput('https://example.test/avatar.png'), '')
})

test('portrait helpers preserve stored relative paths as agent API portraits', () => {
  assert.equal(agentPortraitSrc('agent-1', '.openclaw/avatars/agent-1.png'), '/api/party/avatar/agent-1')
  assert.equal(agentPortraitSrc(undefined, '.openclaw/avatars/agent-1.png'), '')
  assert.equal(agentPortraitSrc('agent-1', 'https://example.test/avatar.png'), 'https://example.test/avatar.png')
  assert.equal(agentPortraitSrc('agent-1', '/api/party/avatar/agent-1'), '/api/party/avatar/agent-1')
  assert.equal(agentPortraitSrc('agent-1', '/agents/default.svg'), '/agents/default.svg')
})
