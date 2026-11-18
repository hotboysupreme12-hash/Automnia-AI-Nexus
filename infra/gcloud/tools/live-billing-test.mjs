const [projectId, targetBaseUrlInput, sourceBaseUrlInput] = process.argv.slice(2)
const token = process.env.AUTOMNIA_GCLOUD_ACCESS_TOKEN
if (!projectId || !targetBaseUrlInput || !sourceBaseUrlInput || !token) {
  throw new Error('Usage: AUTOMNIA_GCLOUD_ACCESS_TOKEN=... node live-billing-test.mjs <project-id> <target-service-url> <source-service-url>')
}

const targetBaseUrl = targetBaseUrlInput.replace(/\/+$/, '')
const sourceBaseUrl = sourceBaseUrlInput.replace(/\/+$/, '')
const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/automnia_licenses?pageSize=1000&orderBy=__name__`

function value(fields, name) {
  const field = fields?.[name]
  if (!field) return null
  if ('stringValue' in field) return field.stringValue
  if ('integerValue' in field) return Number(field.integerValue)
  if ('doubleValue' in field) return Number(field.doubleValue)
  if ('booleanValue' in field) return field.booleanValue
  return null
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function active(payload, response) {
  return response.ok && payload?.ok === true && payload?.active === true
}

function isCreditTopup(record) {
  const tier = String(record?.tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return tier === 'credit_refill' || tier === 'credit_pack_topup'
}

function publicIdentity(payload) {
  return JSON.stringify({
    tier: payload?.tier ?? null,
    mode: payload?.mode ?? null,
    creditBalance: Number.isFinite(Number(payload?.creditBalance)) ? Number(payload.creditBalance) : null,
  })
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

const checks = []
try {
  const health = await jsonRequest(`${targetBaseUrl}/health`, { headers: { Accept: 'application/json' } })
  checks.push({ name: 'health', passed: health.response.ok && health.payload?.ok === true, status: health.response.status })

  const ready = await jsonRequest(`${targetBaseUrl}/ready`, { headers: { Accept: 'application/json' } })
  checks.push({ name: 'firestore-readiness', passed: ready.response.ok && ready.payload?.ok === true, status: ready.response.status })

  const licensesResponse = await jsonRequest(firestoreUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!licensesResponse.response.ok) throw new Error(`Unable to read target licenses (${licensesResponse.response.status}).`)
  const licenses = (licensesResponse.payload?.documents || []).map((document) => ({
    email: value(document.fields, 'email'),
    licenseKey: value(document.fields, 'licenseKey'),
    tier: value(document.fields, 'tier'),
    mode: value(document.fields, 'mode'),
    subscriptionStatus: value(document.fields, 'subscriptionStatus'),
    subscriptionContractId: value(document.fields, 'subscriptionContractId'),
    planPriceCents: value(document.fields, 'planPriceCents'),
    permanentAccess: value(document.fields, 'permanentAccess'),
    status: value(document.fields, 'status'),
  }))
  const nonRevokedCandidates = licenses.filter((record) => record.email && record.licenseKey && record.status !== 'revoked')
  // A refill grants credits to an account; it is not itself a license/access
  // entitlement. The Firestore hash and credit-ledger totals verify the refill.
  const candidates = nonRevokedCandidates.filter((record) => !isCreditTopup(record))
  const excludedTopupRecords = nonRevokedCandidates.length - candidates.length
  const parityResults = []

  for (const record of candidates) {
    const requestBody = JSON.stringify({ email: record.email, licenseKey: record.licenseKey })
    const [sourceResult, targetResult] = await Promise.all([
      jsonRequest(`${sourceBaseUrl}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: requestBody,
      }),
      jsonRequest(`${targetBaseUrl}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: requestBody,
      }),
    ])
    const sourceActive = active(sourceResult.payload, sourceResult.response)
    const targetActive = active(targetResult.payload, targetResult.response)
    const responseDataMatches = !sourceActive || !targetActive || publicIdentity(sourceResult.payload) === publicIdentity(targetResult.payload)
    parityResults.push({
      record,
      sourceStatus: sourceResult.response.status,
      targetStatus: targetResult.response.status,
      sourceActive,
      targetActive,
      responseDataMatches,
      sourcePayload: sourceResult.payload,
      targetPayload: targetResult.payload,
    })
  }

  const accessMismatches = parityResults.filter((result) =>
    result.sourceActive !== result.targetActive || !result.responseDataMatches,
  )
  const segmentMap = new Map()
  for (const result of parityResults) {
    const { record } = result
    const segment = [record.tier || 'unknown', record.mode || 'unknown', record.subscriptionStatus || 'none', `contract=${Boolean(record.subscriptionContractId)}`].join('|')
    const totals = segmentMap.get(segment) || { segment, tested: 0, sourceActive: 0, targetActive: 0, mismatches: 0 }
    totals.tested += 1
    totals.sourceActive += Number(result.sourceActive)
    totals.targetActive += Number(result.targetActive)
    totals.mismatches += Number(accessMismatches.includes(result))
    segmentMap.set(segment, totals)
  }
  const segments = [...segmentMap.values()].sort((left, right) => left.segment.localeCompare(right.segment))
  const sourceActiveCount = parityResults.filter((result) => result.sourceActive).length
  const targetActiveCount = parityResults.filter((result) => result.targetActive).length
  const identityFieldMismatches = { tier: 0, mode: 0, creditBalance: 0 }
  const mismatchDiagnosticMap = new Map()
  for (const result of accessMismatches) {
    const differentFields = []
    if (result.sourceActive !== result.targetActive) differentFields.push('active')
    for (const field of Object.keys(identityFieldMismatches)) {
      if (JSON.stringify(result.sourcePayload?.[field] ?? null) !== JSON.stringify(result.targetPayload?.[field] ?? null)) {
        identityFieldMismatches[field] += 1
        differentFields.push(field)
      }
    }
    const diagnosticKey = JSON.stringify({
      recordTier: result.record.tier || null,
      recordMode: result.record.mode || null,
      recordStatus: result.record.status || null,
      recordSubscriptionStatus: result.record.subscriptionStatus || null,
      recordPlanPriceCents: result.record.planPriceCents ?? null,
      recordPermanentAccess: result.record.permanentAccess === true,
      recordHasContract: Boolean(result.record.subscriptionContractId),
      sourceActive: result.sourceActive,
      targetActive: result.targetActive,
      sourceTier: result.sourcePayload?.tier ?? null,
      targetTier: result.targetPayload?.tier ?? null,
      sourceMode: result.sourcePayload?.mode ?? null,
      targetMode: result.targetPayload?.mode ?? null,
      creditBalanceMatches: JSON.stringify(result.sourcePayload?.creditBalance ?? null) === JSON.stringify(result.targetPayload?.creditBalance ?? null),
      differentFields,
    })
    mismatchDiagnosticMap.set(diagnosticKey, (mismatchDiagnosticMap.get(diagnosticKey) || 0) + 1)
  }
  const mismatchDiagnostics = [...mismatchDiagnosticMap.entries()].map(([diagnostic, count]) => ({ ...JSON.parse(diagnostic), count }))
  const parityPassed = candidates.length === 0 || accessMismatches.length === 0
  checks.push({
    name: 'source-target-license-access-parity',
    passed: parityPassed,
    tested: candidates.length,
    excludedTopupRecords,
    sourceActive: sourceActiveCount,
    targetActive: targetActiveCount,
    mismatches: accessMismatches.length,
    identityFieldMismatches,
    mismatchDiagnostics,
    segments,
  })

  if (candidates.length > 0) {
    const canary = parityResults.find((result) => result.targetActive && result.record.mode === 'byok')
      || parityResults.find((result) => result.targetActive)
    const payload = canary?.targetPayload
    const canaryPassed = Boolean(canary && active(payload, { ok: true })
      && normalizedEmail(payload.email) === normalizedEmail(canary.record.email)
      && typeof payload.tier === 'string' && payload.tier.length > 0
      && ['byok', 'hosted_credits'].includes(payload.mode)
      && Number.isFinite(Number(payload.creditBalance)))
    checks.push({
      name: 'live-license-verification',
      passed: canaryPassed,
      status: canary?.targetStatus ?? null,
      mode: payload?.mode ?? null,
      tier: payload?.tier ?? null,
    })
  } else if (licenses.length === 0) {
    const invalidBody = JSON.stringify({ email: 'migration-canary-invalid@automnia.invalid', licenseKey: 'AUT-MIGRATION-INVALID' })
    const rejected = await jsonRequest(`${targetBaseUrl}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: invalidBody,
    })
    checks.push({ name: 'empty-ledger-license-rejection', passed: rejected.response.status === 404 && rejected.payload?.active === false, status: rejected.response.status })
  } else {
    checks.push({ name: 'live-license-verification', passed: false, reason: 'No non-revoked license contains both email and licenseKey.' })
  }

  const checkout = await jsonRequest(`${targetBaseUrl}/api/commerce/checkout`, { headers: { Accept: 'application/json' } })
  let checkoutReachable = false
  if (checkout.response.ok && checkout.payload?.ok === true && typeof checkout.payload.checkoutUrl === 'string') {
    const parsed = new URL(checkout.payload.checkoutUrl)
    if (parsed.protocol === 'https:') {
      const live = await fetch(parsed, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Automnia-Migration-Verifier/1.0' } })
      checkoutReachable = live.status > 0 && live.status < 500
    }
  }
  checks.push({ name: 'live-shopify-checkout', passed: checkoutReachable, status: checkout.response.status })
} catch (error) {
  checks.push({ name: 'unexpected-error', passed: false, reason: error instanceof Error ? error.message : String(error) })
}

process.stdout.write(JSON.stringify({ passed: checks.every((check) => check.passed), checks }))
