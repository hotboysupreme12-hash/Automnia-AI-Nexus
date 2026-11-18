import { createHash } from 'node:crypto'

const projectId = process.argv[2]
const token = process.env.AUTOMNIA_GCLOUD_ACCESS_TOKEN
if (!projectId || !token) throw new Error('Usage: AUTOMNIA_GCLOUD_ACCESS_TOKEN=... node firestore-snapshot.mjs <project-id>')

const databaseRoot = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }
const maximumDocuments = Number(process.env.AUTOMNIA_MAX_SNAPSHOT_DOCUMENTS || 100000)
const snapshotConcurrency = Number(process.env.AUTOMNIA_FIRESTORE_SNAPSHOT_CONCURRENCY || 24)
const encodeFirestorePath = (value) => value.split('/').map((segment) => encodeURIComponent(segment)).join('/')

if (!Number.isInteger(snapshotConcurrency) || snapshotConcurrency < 1 || snapshotConcurrency > 64) {
  throw new Error('AUTOMNIA_FIRESTORE_SNAPSHOT_CONCURRENCY must be an integer from 1 to 64.')
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  const worker = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function requestJson(url, options = {}) {
  const maxAttempts = 5
  const requestPath = new URL(url).pathname
    .replace(/(\/documents\/[^/]+\/)[^/:]+/g, '$1<document>')
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30000),
        headers: { ...headers, ...(options.headers || {}) },
      })
      const payload = await response.json().catch(() => null)
      if (response.ok) return payload || {}
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`Firestore request failed (${response.status}) at ${requestPath}: ${JSON.stringify(payload)}`)
      }
    } catch (error) {
      if (attempt === maxAttempts) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))))
  }
  throw new Error('Firestore request retry loop exited unexpectedly.')
}

async function listCollectionIds(parentPath = '') {
  const ids = []
  let pageToken = ''
  do {
    const suffix = parentPath ? `/${encodeFirestorePath(parentPath)}:listCollectionIds` : ':listCollectionIds'
    const payload = await requestJson(`${databaseRoot}${suffix}`, {
      method: 'POST',
      body: JSON.stringify({ pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
    })
    ids.push(...(payload.collectionIds || []))
    pageToken = payload.nextPageToken || ''
  } while (pageToken)
  return ids.sort()
}

async function listDocuments(collectionPath) {
  const documents = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ pageSize: '1000', orderBy: '__name__' })
    if (pageToken) query.set('pageToken', pageToken)
    const payload = await requestJson(`${databaseRoot}/${encodeFirestorePath(collectionPath)}?${query}`)
    documents.push(...(payload.documents || []))
    pageToken = payload.nextPageToken || ''
  } while (pageToken)
  return documents
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function fieldValue(fields, name) {
  const value = fields?.[name]
  if (!value) return null
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('nullValue' in value) return null
  return value
}

const records = []
const collectionCounts = new Map()

async function visitCollection(collectionPath) {
  const documents = await listDocuments(collectionPath)
  collectionCounts.set(collectionPath, documents.length)
  const documentChildren = await mapLimit(documents, snapshotConcurrency, async (document) => {
    const relativePath = document.name.split('/documents/')[1] || ''
    return {
      record: { path: relativePath, fields: canonical(document.fields || {}) },
      childCollections: await listCollectionIds(relativePath),
    }
  })
  const nestedCollections = []
  for (const { record, childCollections } of documentChildren) {
    records.push(record)
    if (records.length > maximumDocuments) throw new Error(`Snapshot exceeded the safety limit of ${maximumDocuments} documents.`)
    for (const child of childCollections) nestedCollections.push(`${record.path}/${child}`)
  }
  for (const nestedCollection of nestedCollections) await visitCollection(nestedCollection)
}

for (const collectionId of await listCollectionIds()) await visitCollection(collectionId)
records.sort((left, right) => left.path.localeCompare(right.path))

const licenseRecords = records.filter((record) => record.path.split('/').length === 2 && record.path.startsWith('automnia_licenses/'))
const activeLicenses = licenseRecords.filter((record) => fieldValue(record.fields, 'status') !== 'revoked')
const numberFromFirestore = (value) => {
  if (!value) return null
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  return null
}

const sumTopupCredits = (items) => items.reduce((total, record) => {
  const current = numberFromFirestore(record.fields?.creditsGranted)
  if (current !== null && Number.isFinite(current)) return total + current
  const legacyTokens = numberFromFirestore(record.fields?.credits)
  return legacyTokens === null || !Number.isFinite(legacyTokens) ? total : total + legacyTokens / 1_000
}, 0)

// Three decimal places preserve the compact credit projection without
// allowing a floating-point sum to change migration comparisons.
const scaledCreditTotal = (items, field) => items.reduce((total, record) => {
  const value = numberFromFirestore(record.fields?.[field])
  return value === null || !Number.isFinite(value) ? total : total + BigInt(Math.round(value * 1000))
}, 0n)

const formatScaledCredits = (scaled) => {
  const sign = scaled < 0n ? '-' : ''
  const absolute = scaled < 0n ? -scaled : scaled
  const whole = absolute / 1000n
  const fraction = (absolute % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ''}`
}

const sumTokenBalances = (items) => items.reduce((total, record) => {
  const value = record.fields?.tokenBalance || record.fields?.creditBalance
  if (!value) return total
  if ('integerValue' in value) return total + BigInt(value.integerValue)
  if ('doubleValue' in value && Number.isSafeInteger(Number(value.doubleValue))) return total + BigInt(Number(value.doubleValue))
  throw new Error(`Expected ${record.path}.tokenBalance to be an integer token value.`)
}, 0n).toString()

const collectionSummary = Object.fromEntries([...collectionCounts.entries()].sort(([left], [right]) => left.localeCompare(right)))
const globalHash = createHash('sha256').update(JSON.stringify(records)).digest('hex')
const summary = {
  schemaVersion: 1,
  projectId,
  database: '(default)',
  totalDocuments: records.length,
  collections: collectionSummary,
  customerCount: licenseRecords.length,
  activeCustomerCount: activeLicenses.length,
  tokenBalanceTotal: sumTokenBalances(licenseRecords),
  creditBalanceTotal: formatScaledCredits(BigInt(sumTokenBalances(licenseRecords))),
  creditTopupTotal: sumTopupCredits(records.filter((record) => record.path.startsWith('automnia_credit_topups/'))),
  creditDeductedTotal: formatScaledCredits(scaledCreditTotal(records.filter((record) => record.path.startsWith('automnia_credit_usage/')), 'deductedCredits')),
  globalHash,
}

process.stdout.write(JSON.stringify(summary))
