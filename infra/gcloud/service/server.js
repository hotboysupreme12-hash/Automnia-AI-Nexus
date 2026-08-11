import crypto from 'node:crypto';
import express from 'express';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';

const app = express();
const port = process.env.PORT || 8080;
const serviceVersion = '2.0.0';
const schemaVersion = '2026-08-11.1';
const secrets = (process.env.SHOPIFY_WEBHOOK_SECRETS || process.env.SHOPIFY_WEBHOOK_SECRET || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const useInMemoryStorage = process.env.LOCAL_IN_MEMORY_LICENSES === 'true';
const writeMode = process.env.MIGRATION_WRITE_MODE === 'read_only' ? 'read_only' : 'active';
const adminApiToken = process.env.ADMIN_API_TOKEN || '';
const gcpProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'local-development';
const vertexLocation = process.env.VERTEX_LOCATION || 'us-central1';
const vertexAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const vertexRetryAttempts = Math.max(1, Math.min(5, Number(process.env.VERTEX_RETRY_ATTEMPTS || 4) || 4));
const vertexMaxOutputTokens = Math.max(512, Math.min(8192, Number(process.env.VERTEX_MAX_OUTPUT_TOKENS || 8192) || 8192));
const checkoutUrl = configuredHttpsUrl(process.env.SHOPIFY_CHECKOUT_URL);
const planMappings = readPlanMappings(process.env.SHOPIFY_PLAN_MAPPINGS);
const planMappingHash = crypto.createHash('sha256').update(JSON.stringify(planMappings)).digest('hex');

const provisionedCustomers = new Map();
const firestore = useInMemoryStorage ? null : new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined });
const licenses = firestore?.collection('automnia_licenses');
const licenseIndexes = firestore?.collection('automnia_license_indexes');
const creditTopups = firestore?.collection('automnia_credit_topups');
const creditUsage = firestore?.collection('automnia_credit_usage');
const shopifyWebhookEvents = firestore?.collection('automnia_shopify_webhook_events');

app.use('/api', express.json({ limit: '4mb' }));

function generateLicenseKey(tierPrefix = 'AUT-NEXUS') {
  const segment = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${tierPrefix}-${segment()}-${segment()}-${segment()}`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeKey(value) {
  return String(value || '').trim().toUpperCase();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableVertexStatus(status) {
  return status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function vertexRetryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(15_000, Math.ceil(retryAfter * 1000));
  return Math.min(8_000, (750 * (2 ** attempt)) + crypto.randomInt(100, 451));
}

function licenseIndexId(email, licenseKey) {
  return crypto.createHash('sha256').update(`${normalizeEmail(email)}\u0000${normalizeKey(licenseKey)}`).digest('hex');
}

function configuredHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizePlanId(value) {
  return String(value || '').trim();
}

function readPlanMappings(value) {
  if (!value) return [];
  try {
    let decoded;
    try {
      decoded = JSON.parse(value);
    } catch {
      // Environment-variable flag parsers often treat commas and quotes as
      // separators. Base64-encoded JSON keeps the Cloud Run plan map exact.
      decoded = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    }
    if (!Array.isArray(decoded)) throw new Error('SHOPIFY_PLAN_MAPPINGS must be an array.');
    return decoded.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const tier = String(candidate.tier || '').trim();
      const mode = candidate.mode === 'byok' ? 'byok' : candidate.mode === 'hosted_credits' ? 'hosted_credits' : null;
      const initialCredits = Number(candidate.initialCredits);
      const kind = candidate.kind === 'topup' ? 'topup' : candidate.kind === 'subscription' ? 'subscription' : 'license';
      if (!tier || !mode || !Number.isFinite(initialCredits) || initialCredits < 0) return [];
      const ids = (field) => Array.isArray(candidate[field])
        ? candidate[field].map(normalizePlanId).filter(Boolean)
        : [];
      return [{
        tier,
        mode,
        initialCredits: Math.floor(initialCredits),
        kind,
        productIds: ids('productIds'),
        variantIds: ids('variantIds'),
        skus: ids('skus').map((sku) => sku.toLowerCase()),
      }];
    });
  } catch (error) {
    console.error('Invalid SHOPIFY_PLAN_MAPPINGS configuration:', error instanceof Error ? error.message : error);
    return [];
  }
}

function legacyTierConfiguration(tierName, itemTitles = '') {
  const normalizedTier = String(tierName || '').toLowerCase();
  const normalizedTitles = String(itemTitles || '').toLowerCase();

  if (normalizedTitles.includes('topup') || normalizedTitles.includes('credit pack') || normalizedTitles.includes('1m tokens')) {
    return { tier: 'credit_pack_topup', mode: 'hosted_credits', initialCredits: 1_000_000, kind: 'topup' };
  }
  if (normalizedTier.includes('cloud') || normalizedTitles.includes('cloud') || normalizedTitles.includes('hosting')) {
    return { tier: 'cloud_starter_subscription', mode: 'hosted_credits', initialCredits: 2_500_000, kind: 'subscription' };
  }
  if (normalizedTier.includes('pro') || normalizedTitles.includes('pro')) {
    return { tier: 'pro_tier', mode: 'hosted_credits', initialCredits: 5_000_000, kind: 'subscription' };
  }
  return { tier: 'founding_beta_byok', mode: 'byok', initialCredits: 0, kind: 'license' };
}

function configuredTierForOrder(order) {
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];
  for (const lineItem of lineItems) {
    const productId = normalizePlanId(lineItem?.product_id);
    const variantId = normalizePlanId(lineItem?.variant_id);
    const sku = String(lineItem?.sku || '').trim().toLowerCase();
    const configured = planMappings.find((plan) =>
      (productId && plan.productIds.includes(productId)) ||
      (variantId && plan.variantIds.includes(variantId)) ||
      (sku && plan.skus.includes(sku)),
    );
    if (configured) return configured;
  }
  // Once explicit maps are supplied, an unrecognised product must never grant
  // a default tier just because its title happens to contain a familiar word.
  if (planMappings.length) return null;
  const itemTitles = lineItems.map((item) => item?.title || '').join(' ');
  return legacyTierConfiguration(order?.note || '', itemTitles);
}

function publicLicense(record) {
  return {
    orderId: record.orderId,
    orderName: record.orderName,
    email: record.email,
    tier: record.tier,
    mode: record.mode || (record.tier === 'founding_beta_byok' ? 'byok' : 'hosted_credits'),
    creditBalance: typeof record.creditBalance === 'number' ? record.creditBalance : 0,
    status: record.status,
    subscriptionStatus: record.subscriptionStatus || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || null,
    activatedAt: record.activatedAt || null,
  };
}

function buildOnboardingPackage(order, licenseKey, tierConfig) {
  const customerEmail = order.email || order.customer?.email || 'customer@example.com';
  const customerName = order.customer?.first_name || order.customer?.name || 'Subscriber';
  const telegramBotHandle = process.env.TELEGRAM_BOT_HANDLE || 'AutomniaNexusBot';
  const telegramStartUrl = `https://t.me/${telegramBotHandle}?start=${licenseKey}`;

  return {
    licenseKey,
    tier: tierConfig.tier,
    mode: tierConfig.mode,
    initialCredits: tierConfig.initialCredits,
    customerName,
    customerEmail,
    telegramStartUrl,
    instructions: [
      '1. Open the Automnia App or portal activation screen.',
      `2. Enter your checkout email (${customerEmail}) and license key (${licenseKey}).`,
      `3. Mode: ${tierConfig.mode === 'hosted_credits' ? 'Automnia Cloud AI (Credits Pre-loaded)' : 'BYOK (Bring Your Own API Keys)'}.`,
      '4. Click Activate to verify your license and start using Automnia.',
    ],
  };
}

async function persistProvisionedLicense(record) {
  if (useInMemoryStorage) {
    const existing = provisionedCustomers.get(record.orderId);
    if (!existing) provisionedCustomers.set(record.orderId, record);
    return provisionedCustomers.get(record.orderId);
  }

  const licenseRef = licenses.doc(record.orderId);
  const indexRef = licenseIndexes.doc(licenseIndexId(record.email, record.licenseKey));
  return firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(licenseRef);
    if (existing.exists) return existing.data();
    transaction.create(licenseRef, record);
    transaction.create(indexRef, { orderId: record.orderId, createdAt: record.createdAt });
    return record;
  });
}

async function findLicense(email, licenseKey) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedKey = normalizeKey(licenseKey);
  if (useInMemoryStorage) {
    return Array.from(provisionedCustomers.values()).find((record) =>
      normalizeEmail(record.email) === normalizedEmail && normalizeKey(record.licenseKey) === normalizedKey,
    ) || null;
  }

  const indexSnapshot = await licenseIndexes.doc(licenseIndexId(normalizedEmail, normalizedKey)).get();
  if (!indexSnapshot.exists) return null;
  const orderId = indexSnapshot.get('orderId');
  if (typeof orderId !== 'string' || !orderId) return null;
  const licenseSnapshot = await licenses.doc(orderId).get();
  if (!licenseSnapshot.exists) return null;
  const record = licenseSnapshot.data();
  return normalizeEmail(record.email) === normalizedEmail && normalizeKey(record.licenseKey) === normalizedKey && record.status !== 'revoked' ? record : null;
}

function sortNewestLicense(records) {
  return records.sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.activatedAt || left.createdAt || 0) || 0;
    const rightTime = Date.parse(right.updatedAt || right.activatedAt || right.createdAt || 0) || 0;
    return rightTime - leftTime;
  });
}

async function findLicenseByEmail(email, { hostedOnly = false } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  if (useInMemoryStorage) {
    return sortNewestLicense(Array.from(provisionedCustomers.values())
      .filter((record) => normalizeEmail(record.email) === normalizedEmail && (!hostedOnly || record.mode === 'hosted_credits') && record.status !== 'revoked'))[0] || null;
  }

  const snapshot = await licenses.where('email', '==', normalizedEmail).limit(20).get();
  const candidates = sortNewestLicense(snapshot.docs
    .map((document) => ({ ...document.data(), _ref: document.ref }))
    .filter((record) => (!hostedOnly || record.mode === 'hosted_credits') && record.status !== 'revoked'));
  return candidates[0] || null;
}

async function findHostedLicenseByEmail(email) {
  return findLicenseByEmail(email, { hostedOnly: true });
}

async function findLicenseBySubscriptionId(subscriptionContractId) {
  const normalizedContractId = normalizePlanId(subscriptionContractId);
  if (!normalizedContractId) return null;
  if (useInMemoryStorage) {
    return sortNewestLicense(Array.from(provisionedCustomers.values())
      .filter((record) => record.subscriptionContractId === normalizedContractId && record.status !== 'revoked'))[0] || null;
  }
  const snapshot = await licenses.where('subscriptionContractId', '==', normalizedContractId).limit(5).get();
  return sortNewestLicense(snapshot.docs
    .map((document) => ({ ...document.data(), _ref: document.ref }))
    .filter((record) => record.status !== 'revoked'))[0] || null;
}

function webhookEventId(topic, deliveryId, fallback) {
  const source = `${topic}\u0000${deliveryId || fallback}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

async function updateHostedEntitlement({ record, order, tierConfig, topic, deliveryId }) {
  const orderId = String(order.id || 'unknown');
  const eventId = webhookEventId(topic, deliveryId, `order:${orderId}`);
  const now = new Date().toISOString();
  const contractId = normalizePlanId(order.subscription_contract_id || order.subscriptionContractId) || null;
  const preserveExistingHostedTier = tierConfig.kind === 'topup' && record.mode === 'hosted_credits';
  const nextTier = preserveExistingHostedTier ? record.tier : tierConfig.tier;
  const nextMode = preserveExistingHostedTier ? record.mode : tierConfig.mode;

  if (useInMemoryStorage) {
    if (record.lastWebhookEventId === eventId) return record;
    const grant = tierConfig.initialCredits;
    Object.assign(record, {
      tier: nextTier,
      mode: nextMode,
      creditBalance: (record.creditBalance || 0) + grant,
      subscriptionStatus: tierConfig.kind === 'subscription' ? 'active' : record.subscriptionStatus || null,
      subscriptionContractId: contractId || record.subscriptionContractId || null,
      lastShopifyOrderId: orderId,
      lastWebhookEventId: eventId,
      updatedAt: now,
    });
    return record;
  }

  const licenseRef = record._ref || licenses.doc(record.orderId);
  const eventRef = shopifyWebhookEvents.doc(eventId);
  return firestore.runTransaction(async (transaction) => {
    const [eventSnapshot, licenseSnapshot] = await Promise.all([transaction.get(eventRef), transaction.get(licenseRef)]);
    if (!licenseSnapshot.exists) return null;
    const current = licenseSnapshot.data();
    if (eventSnapshot.exists) return current;
    const grant = tierConfig.initialCredits;
    const update = {
      tier: tierConfig.kind === 'topup' && current.mode === 'hosted_credits' ? current.tier : tierConfig.tier,
      mode: tierConfig.kind === 'topup' && current.mode === 'hosted_credits' ? current.mode : tierConfig.mode,
      creditBalance: (current.creditBalance || 0) + grant,
      subscriptionStatus: tierConfig.kind === 'subscription' ? 'active' : current.subscriptionStatus || null,
      subscriptionContractId: contractId || current.subscriptionContractId || null,
      lastShopifyOrderId: orderId,
      updatedAt: now,
    };
    transaction.update(licenseRef, update);
    transaction.create(eventRef, {
      topic,
      deliveryId: deliveryId || null,
      orderId,
      licenseOrderId: current.orderId,
      tier: update.tier,
      creditsGranted: grant,
      createdAt: now,
    });
    return { ...current, ...update };
  });
}

async function updateShopifyState({ record, topic, deliveryId, subscriptionContractId, subscriptionStatus, paymentStatus }) {
  const eventId = webhookEventId(topic, deliveryId, `${subscriptionContractId || record.orderId}:${subscriptionStatus || paymentStatus || 'state'}`);
  const now = new Date().toISOString();
  const update = {
    ...(subscriptionContractId ? { subscriptionContractId } : {}),
    ...(subscriptionStatus ? { subscriptionStatus } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    updatedAt: now,
  };
  if (useInMemoryStorage) {
    if (record.lastWebhookEventId === eventId) return record;
    Object.assign(record, update, { lastWebhookEventId: eventId });
    return record;
  }
  const licenseRef = record._ref || licenses.doc(record.orderId);
  const eventRef = shopifyWebhookEvents.doc(eventId);
  return firestore.runTransaction(async (transaction) => {
    const [eventSnapshot, licenseSnapshot] = await Promise.all([transaction.get(eventRef), transaction.get(licenseRef)]);
    if (!licenseSnapshot.exists) return null;
    const current = licenseSnapshot.data();
    if (eventSnapshot.exists) return current;
    transaction.update(licenseRef, update);
    transaction.create(eventRef, {
      topic,
      deliveryId: deliveryId || null,
      licenseOrderId: current.orderId,
      subscriptionContractId: subscriptionContractId || current.subscriptionContractId || null,
      subscriptionStatus: subscriptionStatus || null,
      paymentStatus: paymentStatus || null,
      createdAt: now,
    });
    return { ...current, ...update };
  });
}

async function activateLicense(record, deviceId) {
  const activatedAt = new Date().toISOString();
  const update = { status: 'activated', activatedAt, ...(deviceId ? { deviceId: String(deviceId).slice(0, 256) } : {}) };
  if (useInMemoryStorage) {
    Object.assign(record, update);
    return record;
  }
  await licenses.doc(record.orderId).update(update);
  return { ...record, ...update };
}

async function applyCreditTopUp(orderId, email, credits) {
  const normalizedEmail = normalizeEmail(email);
  if (useInMemoryStorage) {
    const existing = Array.from(provisionedCustomers.values()).find((record) => record.email === normalizedEmail && record.mode === 'hosted_credits');
    if (!existing) return null;
    existing.creditBalance = (existing.creditBalance || 0) + credits;
    return existing;
  }

  const topUpRef = creditTopups.doc(orderId);
  const candidates = await licenses.where('email', '==', normalizedEmail).where('mode', '==', 'hosted_credits').limit(1).get();
  if (candidates.empty) return null;
  const licenseRef = candidates.docs[0].ref;
  return firestore.runTransaction(async (transaction) => {
    const applied = await transaction.get(topUpRef);
    const snapshot = await transaction.get(licenseRef);
    if (!snapshot.exists) return null;
    const record = snapshot.data();
    if (applied.exists) return record;
    const creditBalance = (record.creditBalance || 0) + credits;
    transaction.update(licenseRef, { creditBalance, updatedAt: new Date().toISOString() });
    transaction.create(topUpRef, { orderId, email: normalizedEmail, credits, licenseOrderId: record.orderId, createdAt: new Date().toISOString() });
    return { ...record, creditBalance };
  });
}

function usageEventId(orderId, requestId) {
  return crypto.createHash('sha256').update(`${orderId}\u0000${requestId}`).digest('hex');
}

async function deductCredits(orderId, tokensUsed, requestId) {
  const safeTokensUsed = Math.max(0, Math.floor(Number(tokensUsed) || 0));
  const safeRequestId = String(requestId || '').trim().slice(0, 160);
  if (useInMemoryStorage) {
    const record = provisionedCustomers.get(orderId);
    if (!record) return { remainingCredits: 0, deductedCredits: 0, duplicate: false };
    const usageId = safeRequestId ? usageEventId(orderId, safeRequestId) : null;
    if (usageId && record.creditUsage?.[usageId]) return { ...record.creditUsage[usageId], duplicate: true };
    const current = Math.max(0, Number(record.creditBalance) || 0);
    const deductedCredits = Math.min(current, safeTokensUsed);
    const remainingCredits = current - deductedCredits;
    record.creditBalance = remainingCredits;
    record.updatedAt = new Date().toISOString();
    if (usageId) record.creditUsage = { ...(record.creditUsage || {}), [usageId]: { remainingCredits, deductedCredits } };
    return { remainingCredits, deductedCredits, duplicate: false };
  }

  const licenseRef = licenses.doc(orderId);
  const usageRef = safeRequestId ? creditUsage.doc(usageEventId(orderId, safeRequestId)) : null;
  return firestore.runTransaction(async (transaction) => {
    const [licenseSnapshot, usageSnapshot] = await Promise.all([
      transaction.get(licenseRef),
      usageRef ? transaction.get(usageRef) : Promise.resolve(null),
    ]);
    if (!licenseSnapshot.exists) return { remainingCredits: 0, deductedCredits: 0, duplicate: false };
    if (usageSnapshot?.exists) {
      return {
        remainingCredits: Math.max(0, Number(usageSnapshot.get('remainingCredits')) || 0),
        deductedCredits: Math.max(0, Number(usageSnapshot.get('deductedCredits')) || 0),
        duplicate: true,
      };
    }
    const current = Math.max(0, Number(licenseSnapshot.get('creditBalance')) || 0);
    const deductedCredits = Math.min(current, safeTokensUsed);
    const remainingCredits = current - deductedCredits;
    const updatedAt = new Date().toISOString();
    transaction.update(licenseRef, { creditBalance: remainingCredits, updatedAt });
    if (usageRef) {
      transaction.create(usageRef, { orderId, requestId: safeRequestId, tokensUsed: safeTokensUsed, deductedCredits, remainingCredits, createdAt: updatedAt });
    }
    return { remainingCredits, deductedCredits, duplicate: false };
  });
}

function requireAdmin(req, res, next) {
  const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
  if (!adminApiToken || supplied.length !== adminApiToken.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(adminApiToken))) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

function requireWritesEnabled(_req, res, next) {
  if (writeMode === 'active') return next();
  res.set('Retry-After', '30');
  return res.status(503).json({
    ok: false,
    retryable: true,
    error: 'Automnia billing is completing a protected migration. Retry shortly; no credits were charged.',
  });
}

app.get('/health', (_req, res) => res.status(200).json({
  ok: true,
  service: 'automnia-shopify-provisioner',
  version: serviceVersion,
  schemaVersion,
  revision: process.env.K_REVISION || 'local',
  writeMode,
  storage: useInMemoryStorage ? 'memory-development-only' : 'firestore',
  aiRelay: 'vertex-ai-service-account',
  commerce: {
    checkoutConfigured: Boolean(checkoutUrl),
    planMappingsConfigured: planMappings.length > 0,
    planMappingCount: planMappings.length,
    planMappingHash,
    webhookSecretsConfigured: secrets.length > 0,
  },
}));

// Readiness proves that the deployed service identity can reach Firestore. It
// does not create or mutate any customer data.
app.get('/ready', async (_req, res) => {
  try {
    if (firestore) await firestore.doc('automnia_deployment_metadata/readiness').get();
    return res.status(200).json({ ok: true, service: 'automnia-shopify-provisioner', version: serviceVersion, schemaVersion });
  } catch (error) {
    console.error('Readiness check failed:', error);
    return res.status(503).json({ ok: false, error: 'Firestore is unavailable to the service identity.' });
  }
});

// The desktop app can ask only the provisioner whether an owner-configured
// Shopify checkout is available. It never derives prices, product IDs, or a
// customer's entitlement locally.
app.get('/api/commerce/status', (_req, res) => res.status(200).json({
  ok: true,
  checkoutAvailable: Boolean(checkoutUrl),
  planMappingsConfigured: planMappings.length > 0,
  planMappingCount: planMappings.length,
}));

app.get('/api/commerce/checkout', (_req, res) => {
  if (!checkoutUrl) return res.status(404).json({ ok: false, error: 'Shopify checkout has not been configured by the Automnia billing service.' });
  return res.status(200).json({ ok: true, checkoutUrl });
});

app.get('/provisioned', requireAdmin, async (_req, res) => {
  try {
    if (useInMemoryStorage) return res.status(200).json({ count: provisionedCustomers.size, records: Array.from(provisionedCustomers.values()).map(publicLicense) });
    const snapshot = await licenses.limit(100).get();
    return res.status(200).json({ count: snapshot.size, records: snapshot.docs.map((doc) => publicLicense(doc.data())) });
  } catch (error) {
    console.error('Failed to load provisioned licenses:', error);
    return res.status(503).json({ ok: false, error: 'License storage is unavailable.' });
  }
});

app.post('/api/activate', requireWritesEnabled, async (req, res) => {
  const { email, licenseKey, deviceId } = req.body || {};
  if (!email || !licenseKey) return res.status(400).json({ ok: false, error: 'Both email and licenseKey are required.' });

  try {
    const record = await findLicense(email, licenseKey);
    if (!record) return res.status(404).json({ ok: false, error: 'No active paid license found matching this email and key.' });
    const activated = await activateLicense(record, deviceId);
    console.log(JSON.stringify({ event: 'license_activated', orderId: activated.orderId, tier: activated.tier, mode: activated.mode, activatedAt: activated.activatedAt }));
    return res.status(200).json({ ok: true, active: true, ...publicLicense(activated) });
  } catch (error) {
    console.error('License activation storage error:', error);
    return res.status(503).json({ ok: false, error: 'License storage is temporarily unavailable.' });
  }
});

async function verifyLicenseRequest(emailValue, licenseKeyValue, res) {
  const email = normalizeEmail(emailValue);
  const licenseKey = normalizeKey(licenseKeyValue);
  if (!email || !licenseKey) return res.status(400).json({ ok: false, error: 'Both email and licenseKey are required.' });
  try {
    const record = await findLicense(email, licenseKey);
    if (!record) return res.status(404).json({ ok: false, active: false, error: 'License record not found.' });
    return res.status(200).json({ ok: true, active: true, ...publicLicense(record) });
  } catch (error) {
    console.error('License verification storage error:', error);
    return res.status(503).json({ ok: false, error: 'License storage is temporarily unavailable.' });
  }
}

// POST keeps license keys out of URLs and request logs. GET remains available
// for compatibility with older diagnostics, but migration tooling uses POST.
app.post('/api/verify', async (req, res) => verifyLicenseRequest(req.body?.email, req.body?.licenseKey, res));
app.get('/api/verify', async (req, res) => verifyLicenseRequest(req.query.email, req.query.licenseKey, res));

/**
 * AI Relay Proxy Endpoint for Subscription / Credit Pack Customers
 */
app.post('/api/ai/generate', requireWritesEnabled, async (req, res) => {
  const email = normalizeEmail(req.body?.email || req.get('X-Automnia-Email'));
  const licenseKey = normalizeKey(req.body?.licenseKey || req.get('X-Automnia-License-Key'));

  if (!email || !licenseKey) {
    return res.status(400).json({ ok: false, error: 'Both email and licenseKey are required for AI relay routing.' });
  }

  try {
    const record = await findLicense(email, licenseKey);
    if (!record) {
      return res.status(404).json({ ok: false, error: 'No active license found matching this email and key.' });
    }

    const mode = record.mode || (record.tier === 'founding_beta_byok' ? 'byok' : 'hosted_credits');
    const credits = typeof record.creditBalance === 'number' ? record.creditBalance : 0;

    // BYOK users or exhausted credit balance
    if (mode === 'byok' || credits <= 0) {
      return res.status(402).json({
        ok: false,
        active: true,
        mode: 'byok',
        creditBalance: credits,
        error: mode === 'byok'
          ? 'BYOK Tier: Configure your own API key in Automnia App Settings.'
          : 'Credit balance exhausted. Top up your credits on Shopify to continue using Cloud AI.',
      });
    }

    const { prompt, model = 'gemini-2.5-flash', messages } = req.body || {};
    const promptText = prompt || (Array.isArray(messages) ? messages.map((m) => m.content || m.text || '').join('\n') : '');

    if (!promptText.trim()) {
      return res.status(400).json({ ok: false, error: 'Prompt or message content is required.' });
    }

    // Customer-controlled model IDs are never passed upstream. Vertex AI uses the Cloud Run service identity,
    // so a client device never receives a master API key.
    const targetModel = 'gemini-2.5-flash';
    const client = await vertexAuth.getClient();
    const accessToken = await client.getAccessToken();
    if (!accessToken.token) throw new Error('Unable to obtain a Vertex AI service token.');
    const vertexUrl = `https://${vertexLocation}-aiplatform.googleapis.com/v1/projects/${gcpProjectId}/locations/${vertexLocation}/publishers/google/models/${targetModel}:generateContent`;

    let apiResponse = null;
    let errText = '';
    for (let attempt = 0; attempt < vertexRetryAttempts; attempt += 1) {
      apiResponse = await fetch(vertexUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken.token}` },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
          generationConfig: { maxOutputTokens: vertexMaxOutputTokens },
        }),
      });
      if (apiResponse.ok) break;

      errText = await apiResponse.text().catch(() => '');
      const canRetry = retryableVertexStatus(apiResponse.status) && attempt + 1 < vertexRetryAttempts;
      if (!canRetry) break;
      const retryDelayMs = vertexRetryDelayMs(apiResponse, attempt);
      console.warn(JSON.stringify({
        event: 'vertex_retry_scheduled',
        upstreamStatus: apiResponse.status,
        attempt: attempt + 1,
        maxAttempts: vertexRetryAttempts,
        retryDelayMs,
      }));
      await delay(retryDelayMs);
    }

    if (!apiResponse?.ok) {
      const upstreamStatus = apiResponse?.status || 503;
      const retryable = retryableVertexStatus(upstreamStatus);
      console.error('Gemini Master API error:', errText);
      if (upstreamStatus === 429) res.set('Retry-After', '5');
      return res.status(upstreamStatus === 429 ? 429 : 502).json({
        ok: false,
        error: retryable
          ? 'Automnia Cloud is temporarily busy. The billed route was not changed; retry shortly.'
          : 'Upstream master AI provider error.',
        upstreamStatus,
        retryable,
      });
    }

    const payload = await apiResponse.json();
    const generatedText = payload.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const tokensUsed = payload.usageMetadata?.totalTokenCount || Math.ceil((promptText.length + generatedText.length) / 4);
    const requestId = String(req.get('idempotency-key') || req.body?.requestId || '').trim().slice(0, 160);
    const debit = await deductCredits(record.orderId, tokensUsed, requestId);

    console.log(JSON.stringify({
      event: 'ai_relay_generation',
      orderId: record.orderId,
      email: record.email,
      tokensUsed,
      deductedCredits: debit.deductedCredits,
      remainingCredits: debit.remainingCredits,
      duplicateUsageRequest: debit.duplicate,
    }));

    return res.status(200).json({
      ok: true,
      mode: 'hosted_credits',
      text: generatedText,
      tokensUsed,
      deductedCredits: debit.deductedCredits,
      remainingCredits: debit.remainingCredits,
      tier: record.tier,
    });
  } catch (error) {
    console.error('AI Proxy Relay error:', error);
    return res.status(500).json({ ok: false, error: 'Internal AI proxy error.' });
  }
});

const shopifyWebhookTopics = {
  'orders-paid': 'orders/paid',
  'orders-cancelled': 'orders/cancelled',
  'refunds-create': 'refunds/create',
  'subscription-contracts-create': 'subscription_contracts/create',
  'subscription-contracts-update': 'subscription_contracts/update',
  'subscription-contracts-cancel': 'subscription_contracts/cancel',
  'subscription-billing-attempts-success': 'subscription_billing_attempts/success',
  'subscription-billing-attempts-failure': 'subscription_billing_attempts/failure',
};

function hasValidShopifySignature(rawBody, received) {
  if (!secrets.length || !Buffer.isBuffer(rawBody) || !received) return false;
  return secrets.some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  });
}

function customerEmailFromShopify(payload) {
  return normalizeEmail(payload?.email || payload?.customer?.email || payload?.customer_email || payload?.customerEmail);
}

function contractIdFromShopify(payload, { allowPayloadId = true } = {}) {
  return normalizePlanId(
    payload?.subscription_contract_id ||
    payload?.subscriptionContractId ||
    payload?.contract_id ||
    payload?.subscription_contract?.id ||
    (allowPayloadId ? payload?.id : null),
  );
}

function contractStatusFromShopify(payload) {
  return String(payload?.status || payload?.subscription_contract?.status || '').trim().toLowerCase() || null;
}

async function handlePaidOrder(order, deliveryId) {
  const orderId = String(order?.id || '').trim();
  const customerEmail = customerEmailFromShopify(order);
  const tierConfig = configuredTierForOrder(order);
  if (!orderId || !customerEmail) throw new Error('Paid Shopify order is missing an order ID or customer email.');
  if (!tierConfig) throw new Error('Paid Shopify order does not match an owner-configured plan mapping.');

  // An upgrade or top-up updates the existing entitlement and retains its
  // license key. A BYOK customer can therefore upgrade without reactivating
  // the desktop app or losing their connected provider configuration.
  const existing = await findLicenseByEmail(customerEmail);
  if (existing) {
    if (String(existing.lastShopifyOrderId || '') === orderId) {
      return { action: 'duplicate_ignored', license: existing };
    }
    const updated = await updateHostedEntitlement({ record: existing, order, tierConfig, topic: 'orders/paid', deliveryId });
    if (!updated) throw new Error('The active license disappeared while applying the Shopify entitlement update.');
    console.log(JSON.stringify({ event: tierConfig.kind === 'topup' ? 'credits_topped_up' : 'subscription_updated', orderId, licenseOrderId: updated.orderId, tier: updated.tier, mode: updated.mode, creditBalance: updated.creditBalance }));
    return { action: tierConfig.kind === 'topup' ? 'topup_applied' : 'subscription_updated', license: updated };
  }

  const licenseKey = generateLicenseKey(tierConfig.mode === 'hosted_credits' ? 'AUT-CLOUD' : 'AUT-BYOK');
  const contractId = contractIdFromShopify(order, { allowPayloadId: false });
  const createdAt = new Date().toISOString();
  const record = {
    orderId,
    orderName: order.name || `#${orderId}`,
    email: customerEmail,
    customerId: order.customer?.id ? String(order.customer.id) : null,
    tier: tierConfig.tier,
    mode: tierConfig.mode,
    creditBalance: tierConfig.initialCredits,
    licenseKey,
    onboarding: buildOnboardingPackage(order, licenseKey, tierConfig),
    status: 'provisioned',
    subscriptionStatus: tierConfig.kind === 'subscription' ? 'active' : null,
    subscriptionContractId: contractId || null,
    lastShopifyOrderId: orderId,
    createdAt,
    updatedAt: createdAt,
  };
  const persisted = await persistProvisionedLicense(record);
  console.log(JSON.stringify({ event: 'customer_provisioned', orderId: persisted.orderId, tier: persisted.tier, mode: persisted.mode, creditBalance: persisted.creditBalance }));
  return { action: 'license_provisioned', license: persisted };
}

async function handleSubscriptionState(payload, topic, deliveryId) {
  const contractId = contractIdFromShopify(payload, { allowPayloadId: topic.startsWith('subscription_contracts/') });
  const customerEmail = customerEmailFromShopify(payload);
  const record = await findLicenseBySubscriptionId(contractId) || await findLicenseByEmail(customerEmail);
  if (!record) {
    console.warn(JSON.stringify({ event: 'subscription_state_ignored', topic, contractId: contractId || null, reason: 'license_not_found' }));
    return { action: 'ignored' };
  }
  const subscriptionStatus = contractStatusFromShopify(payload) || (topic.endsWith('/cancel') ? 'cancelled' : topic.endsWith('/success') ? 'active' : topic.endsWith('/failure') ? 'payment_failed' : null);
  const updated = await updateShopifyState({ record, topic, deliveryId, subscriptionContractId: contractId || record.subscriptionContractId || null, subscriptionStatus });
  return { action: 'subscription_state_updated', license: updated };
}

async function handlePaymentState(payload, topic, deliveryId) {
  const customerEmail = customerEmailFromShopify(payload);
  const record = await findLicenseByEmail(customerEmail);
  if (!record) return { action: 'ignored' };
  const paymentStatus = topic === 'refunds/create' ? 'refund_review' : 'cancelled';
  // A refund or cancellation is recorded immediately. The existing paid
  // entitlement is not erased automatically because partial refunds and paid
  // subscription periods require an explicit business-policy decision.
  const updated = await updateShopifyState({ record, topic, deliveryId, paymentStatus });
  return { action: 'payment_state_updated', license: updated };
}

app.post('/shopify/webhooks/:webhookName', requireWritesEnabled, express.raw({ type: 'application/json' }), async (req, res) => {
  const topic = shopifyWebhookTopics[req.params.webhookName];
  if (!topic) return res.status(404).json({ error: 'Webhook endpoint not found.' });
  if (!secrets.length) return res.status(503).json({ error: 'Webhook verification is not configured.' });
  if (!hasValidShopifySignature(req.body, req.get('x-shopify-hmac-sha256') || '')) return res.status(401).json({ error: 'Invalid webhook signature.' });

  const deliveryId = String(req.get('x-shopify-webhook-id') || '').trim();
  if (!deliveryId) return res.status(400).json({ error: 'Missing Shopify webhook delivery ID.' });

  try {
    const payload = JSON.parse(req.body.toString('utf8'));
    const result = topic === 'orders/paid'
      ? await handlePaidOrder(payload, deliveryId)
      : topic.startsWith('subscription_contracts/') || topic.startsWith('subscription_billing_attempts/')
        ? await handleSubscriptionState(payload, topic, deliveryId)
        : await handlePaymentState(payload, topic, deliveryId);
    return res.status(200).json({ ok: true, action: result.action });
  } catch (error) {
    console.error('Error processing Shopify webhook:', { topic, deliveryId, message: error instanceof Error ? error.message : String(error) });
    return res.status(503).json({ error: 'Failed to persist Shopify entitlement update.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.listen(port, () => console.log(`Listening on ${port}`));
