import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { patchAutomniaCloud424FailoverSource } = require('../scripts/lib/openclaw-automnia-cloud-failover-patch.cjs') as {
  patchAutomniaCloud424FailoverSource: (source: string) => string
}

const classifierFixture = `function classifyFailoverClassificationFromHttpStatus(e, t, n, r, i, a) {
  const o = failoverReasonFromClassification(n);
  if (e === void 0 || !Number.isFinite(e)) return null;
  if (e === 503) return toReasonClassification("server_error");
  return null;
}`

test('Automnia Cloud 424 failures become model fallback signals without changing other providers', () => {
  const patched = patchAutomniaCloud424FailoverSource(classifierFixture)
  const classify = new Function(
    'failoverReasonFromClassification',
    'toReasonClassification',
    `${patched}\nreturn classifyFailoverClassificationFromHttpStatus;`,
  )(
    () => null,
    (reason: string) => ({ kind: 'reason', reason }),
  ) as (status: number, text: string, classification: unknown, providerSignal: unknown, provider: string) => unknown

  assert.deepEqual(classify(424, '', null, undefined, 'automnia-cloud'), { kind: 'reason', reason: 'server_error' })
  assert.equal(classify(424, '', null, undefined, 'another-provider'), null)
  assert.deepEqual(classify(503, '', null, undefined, 'another-provider'), { kind: 'reason', reason: 'server_error' })
})

test('Automnia Cloud 424 failover patch is idempotent and rejects changed classifier contracts', () => {
  const once = patchAutomniaCloud424FailoverSource(classifierFixture)
  const twice = patchAutomniaCloud424FailoverSource(once)
  assert.equal(twice, once)
  assert.throws(() => patchAutomniaCloud424FailoverSource('function unrelated() {}'), /classifier was not found/)
})
