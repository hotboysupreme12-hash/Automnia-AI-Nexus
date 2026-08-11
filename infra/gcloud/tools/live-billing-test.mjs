const [projectId, baseUrlInput] = process.argv.slice(2)
const token = process.env.AUTOMNIA_GCLOUD_ACCESS_TOKEN
if (!projectId || !baseUrlInput || !token) throw new Error('Usage: AUTOMNIA_GCLOUD_ACCESS_TOKEN=... node live-billing-test.mjs <project-id> <service-url>')

const baseUrl = baseUrlInput.replace(/\/+$/, '')
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

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

const checks = []
try {
  const health = await jsonRequest(`${baseUrl}/health`, { headers: { Accept: 'application/json' } })
  checks.push({ name: 'health', passed: health.response.ok && health.payload?.ok === true, status: health.response.status })

  const ready = await jsonRequest(`${baseUrl}/ready`, { headers: { Accept: 'application/json' } })
  checks.push({ name: 'firestore-readiness', passed: ready.response.ok && ready.payload?.ok === true, status: ready.response.status })

  const licensesResponse = await jsonRequest(firestoreUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!licensesResponse.response.ok) throw new Error(`Unable to read target licenses (${licensesResponse.response.status}).`)
  const licenses = (licensesResponse.payload?.documents || []).map((document) => ({
    email: value(document.fields, 'email'),
    licenseKey: value(document.fields, 'licenseKey'),
    tier: value(document.fields, 'tier'),
    mode: value(document.fields, 'mode'),
    creditBalance: value(document.fields, 'creditBalance'),
    status: value(document.fields, 'status'),
  }))
  const canary = licenses.find((record) => record.email && record.licenseKey && record.status !== 'revoked')

  if (canary) {
    const expectedMode = canary.mode === 'byok' || canary.mode === 'hosted_credits'
      ? canary.mode
      : canary.tier === 'founding_beta_byok' ? 'byok' : 'hosted_credits'
    const expectedCreditBalance = Number.isFinite(canary.creditBalance) ? Number(canary.creditBalance) : 0
    const verified = await jsonRequest(`${baseUrl}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: canary.email, licenseKey: canary.licenseKey }),
    })
    const passed = verified.response.ok && verified.payload?.ok === true && verified.payload?.active === true &&
      verified.payload?.email === canary.email && verified.payload?.tier === canary.tier &&
      verified.payload?.mode === expectedMode && Number(verified.payload?.creditBalance) === expectedCreditBalance
    checks.push({ name: 'live-license-verification', passed, status: verified.response.status, mode: expectedMode, tier: canary.tier })
  } else if (licenses.length === 0) {
    const rejected = await jsonRequest(`${baseUrl}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: 'migration-canary-invalid@automnia.invalid', licenseKey: 'AUT-MIGRATION-INVALID' }),
    })
    checks.push({ name: 'empty-ledger-license-rejection', passed: rejected.response.status === 404 && rejected.payload?.active === false, status: rejected.response.status })
  } else {
    checks.push({ name: 'live-license-verification', passed: false, reason: 'No non-revoked license contains both email and licenseKey.' })
  }

  const checkout = await jsonRequest(`${baseUrl}/api/commerce/checkout`, { headers: { Accept: 'application/json' } })
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
