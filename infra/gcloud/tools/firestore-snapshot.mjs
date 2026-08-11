import { createHash } from 'node:crypto'

const projectId = process.argv[2]
const token = process.env.AUTOMNIA_GCLOUD_ACCESS_TOKEN
if (!projectId || !token) throw new Error('Usage: AUTOMNIA_GCLOUD_ACCESS_TOKEN=... node firestore-snapshot.mjs <project-id>')

const databaseRoot = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }
const maximumDocuments = Number(process.env.AUTOMNIA_MAX_SNAPSHOT_DOCUMENTS || 100000)
const encodeFirestorePath = (value) => value.split('/').map((segment) => encodeURIComponent(segment)).join('/')

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}): ${JSON.stringify(payload)}`)
  return payload || {}
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
  for (const document of documents) {
    const relativePath = document.name.split('/documents/')[1] || ''
    records.push({ path: relativePath, fields: canonical(document.fields || {}) })
    if (records.length > maximumDocuments) throw new Error(`Snapshot exceeded the safety limit of ${maximumDocuments} documents.`)
    const childCollections = await listCollectionIds(relativePath)
    for (const child of childCollections) await visitCollection(`${relativePath}/${child}`)
  }
}

for (const collectionId of await listCollectionIds()) await visitCollection(collectionId)
records.sort((left, right) => left.path.localeCompare(right.path))

const licenseRecords = records.filter((record) => record.path.split('/').length === 2 && record.path.startsWith('automnia_licenses/'))
const activeLicenses = licenseRecords.filter((record) => fieldValue(record.fields, 'status') !== 'revoked')
const sumIntegerField = (items, field) => items.reduce((total, record) => {
  const value = record.fields?.[field]
  if (!value) return total
  if ('integerValue' in value) return total + BigInt(value.integerValue)
  if ('doubleValue' in value && Number.isSafeInteger(Number(value.doubleValue))) return total + BigInt(Number(value.doubleValue))
  throw new Error(`Expected ${record.path}.${field} to be an integer credit value.`)
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
  creditBalanceTotal: sumIntegerField(licenseRecords, 'creditBalance'),
  creditTopupTotal: sumIntegerField(records.filter((record) => record.path.startsWith('automnia_credit_topups/')), 'credits'),
  creditDeductedTotal: sumIntegerField(records.filter((record) => record.path.startsWith('automnia_credit_usage/')), 'deductedCredits'),
  globalHash,
}

process.stdout.write(JSON.stringify(summary))
