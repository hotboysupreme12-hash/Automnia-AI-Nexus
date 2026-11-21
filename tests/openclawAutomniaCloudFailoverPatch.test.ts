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

test('Automnia Cloud shared billing denials stop, while recoverable 424s still reach model fallback', () => {
  const patched = patchAutomniaCloud424FailoverSource(classifierFixture)
  const classify = new Function(
    'failoverReasonFromClassification',
    'toReasonClassification',
    `${patched}\nreturn classifyFailoverClassificationFromHttpStatus;`,
  )(
    () => null,
    (reason: string) => ({ kind: 'reason', reason }),
  ) as (status: number, text: string, classification: unknown, providerSignal: unknown, provider: string) => unknown

  assert.deepEqual(classify(424, '{"code":"hosted_billing_eligibility"}', null, undefined, 'automnia-cloud'), { kind: 'reason', reason: 'auth_permanent' })
  assert.deepEqual(classify(424, '{"code":"hosted_model_access_denied"}', null, undefined, 'automnia-cloud'), { kind: 'reason', reason: 'auth_permanent' })
  assert.deepEqual(classify(403, 'eligible paid billing account in a supported region', null, undefined, 'automnia-cloud'), { kind: 'reason', reason: 'auth_permanent' })
  assert.deepEqual(classify(403, '{"code":"hosted_billing_eligibility"}', null, undefined, 'automnia-cloud'), { kind: 'reason', reason: 'auth_permanent' })
  assert.deepEqual(classify(424, '', null, undefined, 'automnia-cloud'), { kind: 'reason', reason: 'server_error' })
  assert.equal(classify(424, '', null, undefined, 'another-provider'), null)
  assert.deepEqual(classify(503, '', null, undefined, 'another-provider'), { kind: 'reason', reason: 'server_error' })
})

test('Automnia Cloud 424 failover patch is idempotent and rejects changed classifier contracts', () => {
  const once = patchAutomniaCloud424FailoverSource(classifierFixture)
  const twice = patchAutomniaCloud424FailoverSource(once)
  assert.equal(twice, once)
  assert.throws(() => patchAutomniaCloud424FailoverSource('function unrelated() {}'), /classifier was not found/)

  const previousGeneratedPatch = classifierFixture.replace(
    'if (e === void 0 || !Number.isFinite(e)) return null;',
    [
      'if (e === void 0 || !Number.isFinite(e)) return null;',
      '// AUTOMNIA_AUTOMNIA_CLOUD_BILLING_ELIGIBILITY_FAILFAST_PATCH: shared billing eligibility failures cannot recover by trying another model.',
      'if (i === "automnia-cloud" && typeof t === "string" && t.toLowerCase().includes("hosted_billing_eligibility")) return toReasonClassification("auth_permanent");',
      '// AUTOMNIA_AUTOMNIA_CLOUD_424_FAILOVER_PATCH: hosted dependency failures must reach configured model fallbacks.',
      'if (e === 424 && i === "automnia-cloud") return toReasonClassification("server_error");',
    ].join('\n'),
  )
  const upgradedGeneratedPatch = patchAutomniaCloud424FailoverSource(previousGeneratedPatch)
  assert.match(upgradedGeneratedPatch, /hosted_model_access_denied\|hosted_billing_eligibility\|eligible paid billing account in a supported region/)
  assert.equal(patchAutomniaCloud424FailoverSource(upgradedGeneratedPatch), upgradedGeneratedPatch)

  const previousRegexPatch = previousGeneratedPatch.replace(
      'if (i === "automnia-cloud" && typeof t === "string" && t.toLowerCase().includes("hosted_billing_eligibility")) return toReasonClassification("auth_permanent");',
      'if (i === "automnia-cloud" && typeof t === "string" && /hosted_billing_eligibility|eligible paid billing account in a supported region/i.test(t)) return toReasonClassification("auth_permanent");',
    )
  const migratedRegexPatch = patchAutomniaCloud424FailoverSource(previousRegexPatch)
  assert.match(migratedRegexPatch, /hosted_model_access_denied\|hosted_billing_eligibility\|eligible paid billing account in a supported region/)
  assert.equal(patchAutomniaCloud424FailoverSource(migratedRegexPatch), migratedRegexPatch)
})
