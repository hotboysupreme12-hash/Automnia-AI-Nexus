import crypto from 'node:crypto';
import express from 'express';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';
import { gemini36ThinkingConfigFromOpenAiRequest } from './geminiThinking.js';

const app = express();
const port = process.env.PORT || 8080;
const serviceVersion = '2.5.0';
const schemaVersion = '2026-08-13.4';
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
const knowledgeServingConfig = String(process.env.AUTOMNIA_KNOWLEDGE_SERVING_CONFIG || '').trim();
const knowledgeModelVersion = String(process.env.AUTOMNIA_KNOWLEDGE_MODEL_VERSION || 'gemini-3.1-pro-preview/answer_gen/v1').trim();
const knowledgeFallbackModelVersion = String(process.env.AUTOMNIA_KNOWLEDGE_FALLBACK_MODEL_VERSION || 'gemini-2.5-flash/answer_gen/v1').trim();
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

app.use(['/api', '/v1'], express.json({ limit: '4mb' }));

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

const ACCOUNT_PASSWORD_MIN_LENGTH = 12;
const ACCOUNT_PASSWORD_MAX_LENGTH = 128;

function validateAccountPassword(value) {
  const password = String(value || '');
  return password.length >= ACCOUNT_PASSWORD_MIN_LENGTH && password.length <= ACCOUNT_PASSWORD_MAX_LENGTH;
}

function byokAllowedForTier(tier) {
  const normalized = String(tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return false;
  if (new Set(['credit_pack_topup', 'credit_refill', 'starter', 'starter_subscription', 'cloud_starter_subscription']).has(normalized)) return false;
  return true;
}

function tierRank(tier) {
  const normalized = String(tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized.includes('enterprise')) return 3;
  if (normalized.includes('pro')) return 2;
  if (normalized === 'starter' || normalized.includes('starter') || normalized === 'byok' || normalized.includes('byok')) return 1;
  if (normalized.includes('credit') || normalized.includes('refill') || normalized.includes('topup')) return 0;
  return normalized ? 1 : 0;
}

function planHasPermanentAccess(plan) {
  return starterSubscriptionOnly(plan) ? false : plan?.permanentAccess === true || plan?.mode === 'byok' || tierRank(plan?.tier) >= 2;
}

function recordHasPermanentAccess(record) {
  return starterSubscriptionOnly(record) ? false : record?.permanentAccess === true || record?.mode === 'byok' || tierRank(record?.tier) >= 2;
}

function starterSubscriptionOnly(record) {
  const normalized = String(record?.tier || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const isStarterTier = normalized === 'starter' || normalized === 'cloud_starter_subscription' || (normalized.includes('starter') && !normalized.includes('pro'));
  const mode = record?.mode || 'hosted_credits';
  return mode === 'hosted_credits' && isStarterTier;
}

function validUsagePriority(value) {
  return value === 'automnia_first' || value === 'provider_first' || value === 'byok_only';
}

function effectiveUsagePriority(record) {
  if (starterSubscriptionOnly(record)) return 'automnia_first';
  return validUsagePriority(record?.usagePriority)
    ? record.usagePriority
    : record?.mode === 'byok' && pooledCreditBalance(record) <= 0 ? 'provider_first' : 'automnia_first';
}

function attachCreditSources(record, candidates = [record]) {
  if (!record) return null;
  const sources = [];
  // The active/canonical entitlement is always first. Older non-revoked
  // records remain separate wallet sources so an upgrade cannot erase their
  // hosted-credit balance. The canonical wallet receives future grants first;
  // pooled reporting and fallback billing still include every source.
  for (const candidate of [record, ...candidates]) {
    if (!candidate || candidate.status === 'revoked' || sources.some((source) => source.orderId === candidate.orderId)) continue;
    sources.push(candidate);
  }
  // Keep the pooled wallet metadata server-local. It must never be written
  // back to a license document or exposed as a customer-controlled field.
  Object.defineProperty(record, '_creditSources', {
    configurable: true,
    enumerable: false,
    value: sources,
    writable: true,
  });
  return record;
}

function creditSourcesFor(record) {
  return Array.isArray(record?._creditSources) && record._creditSources.length
    ? record._creditSources
    : record ? [record] : [];
}

function pooledCreditBalance(record) {
  return creditSourcesFor(record).reduce((total, source) => total + Math.max(0, Number(source.creditBalance) || 0), 0);
}

function bestLicense(records) {
  return records.sort((left, right) => {
    const rankDelta = tierRank(right.tier) - tierRank(left.tier);
    if (rankDelta) return rankDelta;
    const permanentDelta = Number(recordHasPermanentAccess(right)) - Number(recordHasPermanentAccess(left));
    if (permanentDelta) return permanentDelta;
    const accountDelta = Number(Boolean(right.passwordHash || right.googleSubject || right.accountId)) - Number(Boolean(left.passwordHash || left.googleSubject || left.accountId));
    if (accountDelta) return accountDelta;
    const leftTime = Date.parse(left.updatedAt || left.activatedAt || left.createdAt || 0) || 0;
    const rightTime = Date.parse(right.updatedAt || right.activatedAt || right.createdAt || 0) || 0;
    return rightTime - leftTime;
  })[0] || null;
}

const ACCOUNT_IDENTITY_FIELDS = [
  'accountId',
  'passwordVersion',
  'passwordSalt',
  'passwordHash',
  'passwordUpdatedAt',
  'googleSubject',
  'googleLinkedAt',
];

async function mergeAccountIdentityIntoCanonical(canonical, candidates) {
  if (!canonical) return null;
  const identitySources = [...candidates]
    .filter((candidate) => candidate && candidate !== canonical)
    .sort((left, right) => (Date.parse(right.updatedAt || right.createdAt || 0) || 0) - (Date.parse(left.updatedAt || left.createdAt || 0) || 0));
  const fields = {};
  for (const field of ACCOUNT_IDENTITY_FIELDS) {
    if (canonical[field]) continue;
    const source = identitySources.find((candidate) => candidate[field]);
    if (source) fields[field] = source[field];
  }
  if (!Object.keys(fields).length) return canonical;
  const updated = { ...canonical, ...fields };
  if (useInMemoryStorage) {
    Object.assign(canonical, fields);
    return canonical;
  }
  const canonicalRef = canonical._ref || licenses.doc(canonical.orderId);
  await canonicalRef.update({ ...fields, updatedAt: new Date().toISOString() });
  return updated;
}

function hashAccountPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return {
    passwordVersion: 'scrypt-v1',
    passwordSalt: salt.toString('base64url'),
    passwordHash: hash.toString('base64url'),
  };
}

function verifyAccountPassword(password, record) {
  if (record?.passwordVersion !== 'scrypt-v1' || !record.passwordSalt || !record.passwordHash) return false;
  try {
    const expected = Buffer.from(record.passwordHash, 'base64url');
    const actual = crypto.scryptSync(password, Buffer.from(record.passwordSalt, 'base64url'), expected.length);
    return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
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
        planPriceCents: Number.isInteger(Number(candidate.planPriceCents)) && Number(candidate.planPriceCents) >= 0 ? Number(candidate.planPriceCents) : null,
        initialCredits: Math.floor(initialCredits),
        kind,
        permanentAccess: candidate.permanentAccess === true || mode === 'byok' || tierRank(tier) >= 2,
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
    return { tier: 'cloud_starter_subscription', mode: 'hosted_credits', planPriceCents: 1_999, initialCredits: 2_500_000, kind: 'subscription' };
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
    planPriceCents: Number.isInteger(Number(record.planPriceCents)) && Number(record.planPriceCents) >= 0 ? Number(record.planPriceCents) : null,
    byokAllowed: !starterSubscriptionOnly(record) && (record.mode === 'byok' || record.byokAllowed === true || byokAllowedForTier(record.tier)),
    permanentAccess: recordHasPermanentAccess(record),
    accessType: recordHasPermanentAccess(record) ? 'permanent' : 'subscription',
    usagePriority: effectiveUsagePriority(record),
    creditBalance: pooledCreditBalance(record),
    status: record.status,
    subscriptionStatus: record.subscriptionStatus || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || null,
    activatedAt: record.activatedAt || null,
  };
}

function publicAccount(record) {
  return {
    accountId: record.accountId || null,
    email: normalizeEmail(record.email),
    hasPassword: Boolean(record.passwordHash),
    googleLinked: Boolean(record.googleSubject),
    // This response travels to the authenticated desktop control plane so it
    // can prove a first-password setup. The renderer-facing account shape
    // intentionally omits this stable provider identifier.
    googleSubject: record.googleSubject || null,
  };
}

function accountResponse(record) {
  return {
    ok: true,
    active: record.status !== 'revoked',
    account: publicAccount(record),
    // This response is consumed by the local loopback control plane over TLS
    // and is never forwarded to the renderer. It lets a new device cache the
    // relay credential after account authentication without a token prompt.
    licenseKey: record.licenseKey,
    license: publicLicense(record),
    ...publicLicense(record),
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
      `2. Enter your checkout email (${customerEmail}) and license key (${licenseKey}) once to link the account.`,
      `3. Access: ${planHasPermanentAccess(tierConfig) ? 'Permanent access tied to this Automnia account.' : tierConfig.mode === 'hosted_credits' ? 'Automnia Cloud credits.' : 'BYOK (Bring Your Own API Keys).'}`,
      '4. After linking, sign in with your password or Google account. Future upgrades merge automatically into this same account and key.',
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
    const keyMatch = Array.from(provisionedCustomers.values()).find((record) =>
      normalizeEmail(record.email) === normalizedEmail && normalizeKey(record.licenseKey) === normalizedKey,
    );
    if (!keyMatch || keyMatch.status === 'revoked') return null;
    // A legacy key is accepted as an ownership proof, but the response always
    // becomes the one canonical, highest-tier account entitlement.
    const candidates = Array.from(provisionedCustomers.values()).filter((record) =>
      normalizeEmail(record.email) === normalizedEmail && record.status !== 'revoked');
    const canonical = await mergeAccountIdentityIntoCanonical(bestLicense(candidates), candidates) || keyMatch;
    return attachCreditSources(canonical, candidates);
  }

  const indexSnapshot = await licenseIndexes.doc(licenseIndexId(normalizedEmail, normalizedKey)).get();
  if (!indexSnapshot.exists) return null;
  const orderId = indexSnapshot.get('orderId');
  if (typeof orderId !== 'string' || !orderId) return null;
  const licenseSnapshot = await licenses.doc(orderId).get();
  if (!licenseSnapshot.exists) return null;
  const record = licenseSnapshot.data();
  if (normalizeEmail(record.email) !== normalizedEmail || normalizeKey(record.licenseKey) !== normalizedKey || record.status === 'revoked') return null;
  const snapshot = await licenses.where('email', '==', normalizedEmail).limit(50).get();
  const candidates = snapshot.docs
    .map((document) => ({ ...document.data(), _ref: document.ref }))
    .filter((candidate) => candidate.status !== 'revoked');
  const canonical = await mergeAccountIdentityIntoCanonical(bestLicense(candidates) || record, candidates) || record;
  return attachCreditSources(canonical, candidates);
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
    const candidates = Array.from(provisionedCustomers.values())
      .filter((record) => normalizeEmail(record.email) === normalizedEmail && (!hostedOnly || record.mode === 'hosted_credits') && record.status !== 'revoked');
    const canonical = await mergeAccountIdentityIntoCanonical(bestLicense(candidates), candidates);
    return attachCreditSources(canonical, candidates);
  }

  const snapshot = await licenses.where('email', '==', normalizedEmail).get();
  const candidates = snapshot.docs
    .map((document) => ({ ...document.data(), _ref: document.ref }))
    .filter((record) => (!hostedOnly || record.mode === 'hosted_credits') && record.status !== 'revoked');
  const canonical = await mergeAccountIdentityIntoCanonical(bestLicense(candidates), candidates);
  return attachCreditSources(canonical, candidates);
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
  const incomingRank = tierRank(tierConfig.tier);
  const currentRank = tierRank(record.tier);
  const shouldUpgrade = incomingRank > currentRank || (
    incomingRank === currentRank &&
    planHasPermanentAccess(tierConfig) &&
    !recordHasPermanentAccess(record)
  );
  const preserveExistingEntitlement = tierConfig.kind === 'topup' || !shouldUpgrade;
  const nextTier = preserveExistingEntitlement ? record.tier : tierConfig.tier;
  const nextMode = preserveExistingEntitlement ? record.mode : tierConfig.mode;
  const nextPlanPriceCents = preserveExistingEntitlement
    ? (Number.isInteger(Number(record.planPriceCents)) ? Number(record.planPriceCents) : tierConfig.planPriceCents ?? null)
    : tierConfig.planPriceCents ?? null;
  const nextPermanentAccess = recordHasPermanentAccess(record) || planHasPermanentAccess(tierConfig);
  const nextByokAllowed = nextMode === 'byok' || (!starterSubscriptionOnly({ tier: nextTier, mode: nextMode, planPriceCents: nextPlanPriceCents }) && (record.byokAllowed === true || byokAllowedForTier(nextTier)));
  const nextSubscriptionStatus = nextPermanentAccess
    ? 'permanent'
    : tierConfig.kind === 'subscription' ? 'active' : record.subscriptionStatus || null;

  if (useInMemoryStorage) {
    if (record.lastWebhookEventId === eventId) return record;
    // An upgrade changes the canonical entitlement but never resets its
    // existing hosted-credit wallet. A new plan grant is additive; separate
    // prior wallet sources remain pooled through _creditSources.
    const grant = Math.max(0, Number(tierConfig.initialCredits) || 0);
    Object.assign(record, {
      tier: nextTier,
      mode: nextMode,
      planPriceCents: nextPlanPriceCents,
      byokAllowed: nextByokAllowed,
      permanentAccess: nextPermanentAccess,
      accessType: nextPermanentAccess ? 'permanent' : 'subscription',
      creditBalance: (record.creditBalance || 0) + grant,
      subscriptionStatus: nextSubscriptionStatus,
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
    // Preserve the current wallet and add only the incoming plan grant. The
    // public response and relay wallet pool all non-revoked account sources,
    // including hosted credits earned before a BYOK or higher-tier upgrade.
    const grant = Math.max(0, Number(tierConfig.initialCredits) || 0);
    const update = {
      tier: preserveExistingEntitlement ? current.tier : tierConfig.tier,
      mode: preserveExistingEntitlement ? current.mode : tierConfig.mode,
      planPriceCents: nextPlanPriceCents,
      byokAllowed: nextMode === 'byok' || (!starterSubscriptionOnly({ tier: nextTier, mode: nextMode, planPriceCents: nextPlanPriceCents }) && (current.byokAllowed === true || byokAllowedForTier(nextTier))),
      permanentAccess: recordHasPermanentAccess(current) || planHasPermanentAccess(tierConfig),
      accessType: (recordHasPermanentAccess(current) || planHasPermanentAccess(tierConfig)) ? 'permanent' : 'subscription',
      creditBalance: (current.creditBalance || 0) + grant,
      subscriptionStatus: (recordHasPermanentAccess(current) || planHasPermanentAccess(tierConfig))
        ? 'permanent'
        : tierConfig.kind === 'subscription' ? 'active' : current.subscriptionStatus || null,
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

function usageEventId(walletId, requestId) {
  return crypto.createHash('sha256').update(`${walletId}\u0000${requestId}`).digest('hex');
}

async function deductCredits(recordOrOrderId, tokensUsed, requestId) {
  const safeTokensUsed = Math.max(0, Math.floor(Number(tokensUsed) || 0));
  const safeRequestId = String(requestId || '').trim().slice(0, 160);
  const canonical = typeof recordOrOrderId === 'object' && recordOrOrderId
    ? recordOrOrderId
    : provisionedCustomers.get(String(recordOrOrderId || ''));
  const orderId = String(canonical?.orderId || recordOrOrderId || '');
  const sources = creditSourcesFor(canonical);
  const walletId = String(canonical?.email || orderId);
  if (useInMemoryStorage) {
    if (!canonical || !sources.length) return { remainingCredits: 0, deductedCredits: 0, duplicate: false };
    const usageId = safeRequestId ? usageEventId(walletId, safeRequestId) : null;
    if (usageId && canonical.creditUsage?.[usageId]) return { ...canonical.creditUsage[usageId], duplicate: true };
    let remainingToDeduct = safeTokensUsed;
    let deductedCredits = 0;
    const allocations = [];
    for (const source of sources) {
      const current = Math.max(0, Number(source.creditBalance) || 0);
      const deducted = Math.min(current, remainingToDeduct);
      if (deducted > 0) {
        source.creditBalance = current - deducted;
        source.updatedAt = new Date().toISOString();
        deductedCredits += deducted;
        remainingToDeduct -= deducted;
        allocations.push({ orderId: source.orderId, deductedCredits: deducted });
      }
      if (remainingToDeduct <= 0) break;
    }
    const remainingCredits = pooledCreditBalance(canonical);
    canonical.updatedAt = new Date().toISOString();
    if (usageId) {
      canonical.creditUsage = {
        ...(canonical.creditUsage || {}),
        [usageId]: { remainingCredits, deductedCredits, allocations },
      };
    }
    return { remainingCredits, deductedCredits, duplicate: false };
  }

  if (!canonical || !sources.length) return { remainingCredits: 0, deductedCredits: 0, duplicate: false };
  const sourceRefs = sources.map((source) => source._ref || licenses.doc(source.orderId));
  const usageRef = safeRequestId ? creditUsage.doc(usageEventId(walletId, safeRequestId)) : null;
  return firestore.runTransaction(async (transaction) => {
    const [sourceSnapshots, usageSnapshot] = await Promise.all([
      Promise.all(sourceRefs.map((sourceRef) => transaction.get(sourceRef))),
      usageRef ? transaction.get(usageRef) : Promise.resolve(null),
    ]);
    if (!sourceSnapshots.some((snapshot) => snapshot.exists)) return { remainingCredits: 0, deductedCredits: 0, duplicate: false };
    if (usageSnapshot?.exists) {
      return {
        remainingCredits: Math.max(0, Number(usageSnapshot.get('remainingCredits')) || 0),
        deductedCredits: Math.max(0, Number(usageSnapshot.get('deductedCredits')) || 0),
        duplicate: true,
      };
    }
    const updatedAt = new Date().toISOString();
    let remainingToDeduct = safeTokensUsed;
    let deductedCredits = 0;
    const allocations = [];
    let remainingCredits = 0;
    sourceSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const current = Math.max(0, Number(snapshot.get('creditBalance')) || 0);
      const deducted = Math.min(current, remainingToDeduct);
      const nextBalance = current - deducted;
      remainingCredits += nextBalance;
      if (deducted > 0) {
        deductedCredits += deducted;
        remainingToDeduct -= deducted;
        transaction.update(sourceRefs[index], { creditBalance: nextBalance, updatedAt });
        allocations.push({ orderId: sources[index].orderId, deductedCredits: deducted });
      }
    });
    if (usageRef) {
      transaction.create(usageRef, {
        orderId,
        walletId,
        requestId: safeRequestId,
        tokensUsed: safeTokensUsed,
        deductedCredits,
        remainingCredits,
        allocations,
        createdAt: updatedAt,
      });
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
  knowledgeAssistant: knowledgeServingConfig ? 'configured' : 'disabled',
  knowledgeModelVersion,
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
    // The local control plane may have presented a legacy key. Return the
    // account's canonical key so the desktop replaces that old local pointer
    // after the highest-tier entitlement is resolved.
    return res.status(200).json({ ok: true, active: true, canonicalLicenseKey: activated.licenseKey, ...publicLicense(activated) });
  } catch (error) {
    console.error('License activation storage error:', error);
    return res.status(503).json({ ok: false, error: 'License storage is temporarily unavailable.' });
  }
});

async function updateAccountRecord(record, fields) {
  const { _ref, ...storedRecord } = record;
  const updated = { ...storedRecord, ...fields, updatedAt: new Date().toISOString() };
  if (useInMemoryStorage) {
    Object.assign(record, updated);
    return record;
  }
  const licenseRef = record._ref || licenses.doc(record.orderId);
  await licenseRef.update(updated);
  return updated;
}

app.post('/api/account/setup', requireWritesEnabled, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const licenseKey = normalizeKey(req.body?.licenseKey);
  const password = String(req.body?.password || '');
  if (!email || !licenseKey || !validateAccountPassword(password)) {
    return res.status(400).json({ ok: false, error: 'Enter a valid email, license key, and a password between 12 and 128 characters.' });
  }

  try {
    const record = await findLicense(email, licenseKey);
    if (!record) return res.status(404).json({ ok: false, error: 'No active Automnia license found for this email and key.' });
    if (record.passwordHash) return res.status(409).json({ ok: false, error: 'This Automnia account is already activated. Sign in with its password.' });
    const account = await updateAccountRecord(record, {
      accountId: record.accountId || crypto.randomUUID(),
      ...hashAccountPassword(password),
      passwordUpdatedAt: new Date().toISOString(),
    });
    return res.status(200).json(accountResponse(account));
  } catch (error) {
    console.error('Account setup storage error:', error);
    return res.status(503).json({ ok: false, error: 'Account setup is temporarily unavailable.' });
  }
});

app.post('/api/account/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!email || !validateAccountPassword(password)) return res.status(400).json({ ok: false, error: 'Enter your account email and password.' });

  try {
    const record = await findLicenseByEmail(email);
    if (!record) return res.status(401).json({ ok: false, error: 'The email or password is incorrect.' });
    if (!record.passwordHash) return res.status(409).json({ ok: false, error: 'This account uses Google sign-in and does not have an Automnia password yet. Continue with Google or create a password from Account Settings.' });
    if (!verifyAccountPassword(password, record)) return res.status(401).json({ ok: false, error: 'The email or password is incorrect.' });
    return res.status(200).json(accountResponse(record));
  } catch (error) {
    console.error('Account login storage error:', error);
    return res.status(503).json({ ok: false, error: 'Account sign-in is temporarily unavailable.' });
  }
});

app.post('/api/account/google', async (req, res) => {
  const accessToken = String(req.body?.accessToken || '').trim();
  if (!accessToken) return res.status(400).json({ ok: false, error: 'Google sign-in did not return an account token.' });

  try {
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const profile = await profileResponse.json().catch(() => null);
    const email = normalizeEmail(profile?.email);
    const subject = String(profile?.sub || '').trim();
    if (!profileResponse.ok || !email || !subject || profile?.email_verified !== true) {
      return res.status(401).json({ ok: false, error: 'Google could not verify this account email.' });
    }
    const record = await findLicenseByEmail(email);
    if (!record) return res.status(404).json({ ok: false, error: 'No active Automnia license is linked to this Google account email.' });
    if (record.googleSubject && record.googleSubject !== subject) {
      return res.status(403).json({ ok: false, error: 'This Automnia account is linked to a different Google identity.' });
    }
    const linked = await updateAccountRecord(record, {
      accountId: record.accountId || crypto.randomUUID(),
      googleSubject: subject,
      googleLinkedAt: record.googleLinkedAt || new Date().toISOString(),
    });
    return res.status(200).json(accountResponse(linked));
  } catch (error) {
    console.error('Google account login error:', error);
    return res.status(503).json({ ok: false, error: 'Google account sign-in is temporarily unavailable.' });
  }
});

// Password changes require the existing password. Google-linked accounts can
// create their first password through the local authenticated control plane;
// this endpoint still requires the linked Google subject so an email alone can
// never create credentials.
app.post('/api/account/password/change', requireWritesEnabled, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!email || !validateAccountPassword(currentPassword) || !validateAccountPassword(newPassword)) {
    return res.status(400).json({ ok: false, error: 'Enter the current password and a new password between 12 and 128 characters.' });
  }
  try {
    const record = await findLicenseByEmail(email);
    if (!record || !verifyAccountPassword(currentPassword, record)) return res.status(401).json({ ok: false, error: 'The current password is incorrect.' });
    const updated = await updateAccountRecord(record, {
      ...hashAccountPassword(newPassword),
      passwordUpdatedAt: new Date().toISOString(),
    });
    return res.status(200).json(accountResponse(updated));
  } catch (error) {
    console.error('Account password change error:', error);
    return res.status(503).json({ ok: false, error: 'Password change is temporarily unavailable.' });
  }
});

app.post('/api/account/password/set', requireWritesEnabled, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const googleSubject = String(req.body?.googleSubject || '').trim();
  const googleAccessToken = String(req.body?.googleAccessToken || '').trim();
  const newPassword = String(req.body?.newPassword || '');
  if (!email || (!googleSubject && !googleAccessToken) || !validateAccountPassword(newPassword)) {
    return res.status(400).json({ ok: false, error: 'Create a password between 12 and 128 characters after signing in with Google.' });
  }
  try {
    const record = await findLicenseByEmail(email);
    if (!record) return res.status(401).json({ ok: false, error: 'The Google account is not linked to an active Automnia account.' });
    let verifiedGoogleSubject = googleSubject;
    if (googleAccessToken) {
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${googleAccessToken}`, Accept: 'application/json' },
      });
      const profile = await profileResponse.json().catch(() => null);
      const verifiedEmail = normalizeEmail(profile?.email);
      const verifiedSubject = String(profile?.sub || '').trim();
      if (!profileResponse.ok || !verifiedEmail || verifiedEmail !== email || !verifiedSubject || profile?.email_verified !== true) {
        return res.status(401).json({ ok: false, error: 'Google could not verify this account email.' });
      }
      if (verifiedGoogleSubject && verifiedGoogleSubject !== verifiedSubject) {
        return res.status(403).json({ ok: false, error: 'This Automnia account is linked to a different Google identity.' });
      }
      verifiedGoogleSubject = verifiedSubject;
    }
    if (!verifiedGoogleSubject || (record.googleSubject && record.googleSubject !== verifiedGoogleSubject)) {
      return res.status(403).json({ ok: false, error: 'Verify this Automnia account with its linked Google identity before creating a password.' });
    }
    if (record.passwordHash) return res.status(409).json({ ok: false, error: 'This account already has a password. Enter the current password to change it.' });
    const updated = await updateAccountRecord(record, {
      ...(record.googleSubject ? {} : { googleSubject: verifiedGoogleSubject, googleLinkedAt: new Date().toISOString() }),
      ...hashAccountPassword(newPassword),
      passwordUpdatedAt: new Date().toISOString(),
    });
    return res.status(200).json(accountResponse(updated));
  } catch (error) {
    console.error('Account password setup error:', error);
    return res.status(503).json({ ok: false, error: 'Password setup is temporarily unavailable.' });
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

function openAiError(res, status, message, type = 'invalid_request_error', code) {
  return res.status(status).json({
    error: {
      message,
      type,
      ...(code ? { code } : {}),
    },
  });
}

function vertexInlineImagePart(part) {
  if (!part || typeof part !== 'object') return null;
  let mimeType = '';
  let data = '';
  const imageUrl = part.image_url && typeof part.image_url === 'object' ? part.image_url.url : undefined;
  const source = part.source && typeof part.source === 'object' ? part.source : undefined;
  if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;,]+);base64,(.+)$/s);
    if (match) {
      mimeType = match[1];
      data = match[2];
    }
  } else if (source?.type === 'base64' && typeof source.data === 'string') {
    mimeType = typeof source.media_type === 'string' ? source.media_type : '';
    data = source.data;
  } else if (typeof part.data === 'string') {
    mimeType = typeof part.mime_type === 'string' ? part.mime_type : typeof part.mimeType === 'string' ? part.mimeType : '';
    data = part.data;
  }
  if (!mimeType || !data || !/^image\/(?:png|jpe?g|webp|gif)$/i.test(mimeType)) return null;
  return { inlineData: { mimeType, data } };
}

function vertexPartsFromOpenAiContent(content) {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (typeof part === 'string') return part ? [{ text: part }] : [];
    if (!part || typeof part !== 'object') return [];
    if (typeof part.text === 'string' && part.text) return [{ text: part.text }];
    if (typeof part.input_text === 'string' && part.input_text) return [{ text: part.input_text }];
    const image = vertexInlineImagePart(part);
    return image ? [image] : [];
  });
}

function openAiTextContent(content) {
  return vertexPartsFromOpenAiContent(content)
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n');
}

function openAiToolCallThoughtSignature(call) {
  const extraSignature = call?.extra_content?.google?.thought_signature;
  if (typeof extraSignature === 'string' && extraSignature.trim()) return extraSignature.trim();
  const functionSignature = call?.function?.thought_signature;
  return typeof functionSignature === 'string' && functionSignature.trim() ? functionSignature.trim() : '';
}

function openAiToolResultValue(content) {
  const text = openAiTextContent(content).trim();
  if (!text) return { result: '(The runtime returned no output.)' };
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { result: parsed };
  } catch {
    return { result: text };
  }
}

function vertexContentsFromOpenAiMessages(messages) {
  const contents = [];
  const systemParts = [];
  const toolCallNames = new Map();

  for (const rawMessage of Array.isArray(messages) ? messages : []) {
    if (!rawMessage || typeof rawMessage !== 'object') continue;
    const role = String(rawMessage.role || '').trim().toLowerCase();
    const messageParts = vertexPartsFromOpenAiContent(rawMessage.content);
    const text = messageParts.map((part) => typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n');
    if (role === 'system' || role === 'developer') {
      if (text.trim()) systemParts.push({ text: text.trim() });
      continue;
    }
    if (role === 'tool') {
      const toolCallId = String(rawMessage.tool_call_id || '').trim();
      const name = toolCallNames.get(toolCallId) || 'tool';
      const resultParts = messageParts.filter((part) => !('text' in part));
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name,
            response: openAiToolResultValue(rawMessage.content),
            ...(toolCallId ? { id: toolCallId } : {}),
          },
        }, ...resultParts],
      });
      continue;
    }

    const parts = messageParts.flatMap((part) => {
      if (typeof part.text !== 'string') return [part];
      const trimmed = part.text.trim();
      return trimmed ? [{ text: trimmed }] : [];
    });
    if (role === 'assistant' && Array.isArray(rawMessage.tool_calls)) {
      for (const call of rawMessage.tool_calls) {
        const name = String(call?.function?.name || '').trim();
        if (!name) continue;
        const id = String(call?.id || '').trim();
        if (id) toolCallNames.set(id, name);
        let args = {};
        const encoded = call?.function?.arguments;
        if (typeof encoded === 'string' && encoded.trim()) {
          try {
            const parsed = JSON.parse(encoded);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
          } catch {
            args = { input: encoded };
          }
        } else if (encoded && typeof encoded === 'object' && !Array.isArray(encoded)) {
          args = encoded;
        }
        const thoughtSignature = openAiToolCallThoughtSignature(call);
        const callId = typeof call?.id === 'string' ? call.id.trim() : '';
        parts.push({
          functionCall: {
            name,
            args,
            ...(callId ? { id: callId } : {}),
          },
          ...(thoughtSignature ? { thoughtSignature } : {}),
        });
      }
    }
    if (!parts.length) continue;
    contents.push({ role: role === 'assistant' ? 'model' : 'user', parts });
  }

  return {
    contents,
    ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
  };
}

/**
 * Gemini function declarations use a deliberately smaller OpenAPI-schema
 * subset than OpenAI-compatible clients advertise.  OpenClaw supplies normal
 * JSON Schema (for example `exclusiveMinimum`), which Vertex rejects before
 * the model runs.  Normalize at the hosted boundary rather than weakening
 * tool definitions in every client or allowing a billing-bypassing fallback.
 */
function vertexSchemaFromOpenAiSchema(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 16) return undefined;
  const schema = {};
  const rawType = value.type;
  if (typeof rawType === 'string' && rawType.trim()) schema.type = rawType.trim();
  else if (Array.isArray(rawType)) {
    const supportedType = rawType.find((candidate) => typeof candidate === 'string' && candidate.toLowerCase() !== 'null');
    if (supportedType) schema.type = supportedType;
    if (rawType.some((candidate) => String(candidate).toLowerCase() === 'null')) schema.nullable = true;
  }
  for (const key of ['title', 'description', 'format', 'default', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) {
    if (value[key] !== undefined && value[key] !== null) schema[key] = value[key];
  }
  if (value.nullable === true) schema.nullable = true;
  if (Array.isArray(value.enum)) schema.enum = value.enum.filter((candidate) => ['string', 'number', 'boolean'].includes(typeof candidate));
  if (value.items && typeof value.items === 'object' && !Array.isArray(value.items)) {
    const items = vertexSchemaFromOpenAiSchema(value.items, depth + 1);
    if (items && Object.keys(items).length) schema.items = items;
  }
  if (value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)) {
    const properties = {};
    for (const [name, property] of Object.entries(value.properties)) {
      const normalized = vertexSchemaFromOpenAiSchema(property, depth + 1);
      if (normalized && Object.keys(normalized).length) properties[name] = normalized;
    }
    if (Object.keys(properties).length) schema.properties = properties;
  }
  if (Array.isArray(value.required)) {
    const propertyNames = new Set(Object.keys(schema.properties || {}));
    const required = value.required.filter((name) => typeof name === 'string' && propertyNames.has(name));
    if (required.length) schema.required = required;
  }
  return schema;
}

function vertexToolsFromOpenAi(tools) {
  const declarations = (Array.isArray(tools) ? tools : []).flatMap((tool) => {
    if (!tool || typeof tool !== 'object' || tool.type !== 'function' || !tool.function || typeof tool.function !== 'object') return [];
    const name = String(tool.function.name || '').trim();
    if (!name) return [];
    const declaration = { name };
    if (typeof tool.function.description === 'string' && tool.function.description.trim()) declaration.description = tool.function.description.trim();
    if (tool.function.parameters && typeof tool.function.parameters === 'object' && !Array.isArray(tool.function.parameters)) {
      const parameters = vertexSchemaFromOpenAiSchema(tool.function.parameters);
      if (parameters && Object.keys(parameters).length) declaration.parameters = parameters;
    }
    return [declaration];
  });
  return declarations.length ? [{ functionDeclarations: declarations }] : undefined;
}

function vertexToolConfigFromOpenAi(toolChoice) {
  if (toolChoice === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  if (toolChoice === 'required') return { functionCallingConfig: { mode: 'ANY' } };
  if (toolChoice && typeof toolChoice === 'object' && toolChoice.type === 'function') {
    const name = String(toolChoice.function?.name || '').trim();
    return name ? { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [name] } } : undefined;
  }
  return undefined;
}

function vertexCandidateResult(payload) {
  const candidate = payload?.candidates?.[0] || {};
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  let text = parts.map((part) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('');
  const toolCalls = parts.flatMap((part, index) => {
    const call = part?.functionCall;
    const name = String(call?.name || '').trim();
    if (!name) return [];
    const thoughtSignature = typeof part?.thoughtSignature === 'string' && part.thoughtSignature.trim()
      ? part.thoughtSignature.trim()
      : '';
    return [{
      id: `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}_${index}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(call?.args && typeof call.args === 'object' ? call.args : {}),
        ...(thoughtSignature ? { thought_signature: thoughtSignature } : {}),
      },
    }];
  });

  const usage = payload?.usageMetadata || {};
  const promptTokens = Math.max(0, Number(usage.promptTokenCount) || 0);
  const completionTokens = Math.max(0, Number(usage.candidatesTokenCount) || 0);
  const totalTokens = Math.max(0, Number(usage.totalTokenCount) || promptTokens + completionTokens);
  return { text, toolCalls, promptTokens, completionTokens, totalTokens };
}

async function generateVertexContent(input) {
  const client = await vertexAuth.getClient();
  const accessToken = await client.getAccessToken();
  if (!accessToken.token) throw new Error('Unable to obtain a Vertex AI service token.');
  // Keep chat and function/tool turns on the same reference model. The
  // incoming OpenAI-compatible model field is metadata only: customers may
  // not select an arbitrary Vertex model through the hosted billing proxy.
  const targetModel = 'gemini-3.6-flash';
  const vertexHost = vertexLocation === 'global' ? 'aiplatform.googleapis.com' : `${vertexLocation}-aiplatform.googleapis.com`;
  const vertexUrl = `https://${vertexHost}/v1/projects/${gcpProjectId}/locations/${vertexLocation}/publishers/google/models/${targetModel}:generateContent`;
  let apiResponse = null;
  let errText = '';
  for (let attempt = 0; attempt < vertexRetryAttempts; attempt += 1) {
    apiResponse = await fetch(vertexUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken.token}` },
      body: JSON.stringify(input),
    });
    if (apiResponse.ok) break;
    errText = await apiResponse.text().catch(() => '');
    const canRetry = retryableVertexStatus(apiResponse.status) && attempt + 1 < vertexRetryAttempts;
    if (!canRetry) break;
    const retryDelayMs = vertexRetryDelayMs(apiResponse, attempt);
    console.warn(JSON.stringify({ event: 'vertex_retry_scheduled', upstreamStatus: apiResponse.status, attempt: attempt + 1, maxAttempts: vertexRetryAttempts, retryDelayMs }));
    await delay(retryDelayMs);
  }
  if (!apiResponse?.ok) {
    const upstreamStatus = apiResponse?.status || 503;
    const error = new Error(errText || 'Vertex AI request failed.');
    error.status = upstreamStatus === 429 ? 429 : 502;
    error.retryable = retryableVertexStatus(upstreamStatus);
    throw error;
  }
  return apiResponse.json();
}

async function resolveHostedRelayAccess(req) {
  const email = normalizeEmail(req.get('X-Automnia-Email'));
  const licenseKey = normalizeKey(req.get('X-Automnia-License-Key') || req.get('authorization')?.replace(/^Bearer\s+/i, ''));
  if (!email || !licenseKey) return { error: 'Both X-Automnia-Email and a license key are required for Automnia Cloud routing.', status: 401 };
  const record = await findLicense(email, licenseKey);
  if (!record) return { error: 'No active license found matching this email and key.', status: 401 };
  const credits = pooledCreditBalance(record);
  if (credits <= 0) return { error: 'Credit balance exhausted. Refill your Automnia balance to continue.', status: 402 };
  return { record, email, licenseKey, credits };
}

function knowledgeServingEndpoint() {
  if (!knowledgeServingConfig.startsWith('projects/')) return null;
  return `https://discoveryengine.googleapis.com/v1/${knowledgeServingConfig}:answer`;
}

function knowledgeEngineResource() {
  if (!knowledgeServingConfig.startsWith('projects/')) return null;
  return knowledgeServingConfig.replace(/\/servingConfigs\/[^/]+$/, '');
}

function knowledgeSessionEndpoint() {
  const engineResource = knowledgeEngineResource();
  return engineResource ? `https://discoveryengine.googleapis.com/v1/${engineResource}/sessions` : null;
}

const KNOWLEDGE_DETAIL_INSTRUCTION = 'For a setup, UI inventory, retirement procedure, troubleshooting guide, or operations question, prefer a complete source-grounded answer: state the exact surface and control, prerequisites, ordered agent-first and manual paths, expected evidence, safety boundaries, and recovery branch. Enumerate every requested tab, folder, or control. Be detailed when the user asks for detail, but never invent live state or claim an action happened without evidence.';

function addKnowledgeDetailInstruction(body) {
  const preamble = body?.answerGenerationSpec?.promptSpec?.preamble;
  if (typeof preamble === 'string') body.answerGenerationSpec.promptSpec.preamble = `${preamble} ${KNOWLEDGE_DETAIL_INSTRUCTION}`;
  return body;
}

function validKnowledgeSessionName(value, sessionPrefix) {
  return typeof value === 'string'
    && Boolean(sessionPrefix)
    && value.startsWith(sessionPrefix)
    && value.length > sessionPrefix.length
    && !value.endsWith('/-');
}

function isInvalidKnowledgeSessionError(error) {
  return [400, 404].includes(Number(error?.status)) && /invalid session name/i.test(String(error?.message || ''));
}

async function createAutomniaKnowledgeSession(userPseudoId, accessToken) {
  const endpoint = knowledgeSessionEndpoint();
  if (!endpoint) return null;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ userPseudoId }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.warn(JSON.stringify({
      event: 'knowledge_session_create_failed',
      upstreamStatus: response.status,
      message: payload?.error?.message || 'Unknown session creation error',
    }));
    return null;
  }
  return typeof payload?.name === 'string' && payload.name ? payload.name : null;
}

async function answerAutomniaKnowledge(query, userPseudoId, sessionName) {
  const endpoint = knowledgeServingEndpoint();
  if (!endpoint) {
    const error = new Error('Automnia knowledge assistant is not configured.');
    error.status = 503;
    throw error;
  }
  const client = await vertexAuth.getClient();
  const accessToken = await client.getAccessToken();
  if (!accessToken.token) throw new Error('Unable to obtain a Google Cloud service token for the Automnia knowledge assistant.');
  const engineResource = knowledgeEngineResource();
  const sessionPrefix = engineResource ? `${engineResource}/sessions/` : '';
  const requestedSessionName = validKnowledgeSessionName(sessionName, sessionPrefix) ? sessionName : null;
  let activeSessionName = requestedSessionName || await createAutomniaKnowledgeSession(userPseudoId, accessToken.token);
  const requestBody = (modelVersion) => ({
    query: { text: query },
    ...(activeSessionName ? { session: activeSessionName } : {}),
    userPseudoId,
    answerGenerationSpec: {
      modelSpec: { modelVersion },
      promptSpec: {
        preamble: 'You are Automnia Assistant, the official in-product support agent for Automnia AI Nexus. You are a highly capable product specialist with access to the supplied Automnia documentation and retrieved evidence. Answer as Automnia Assistant, not as a generic chatbot and not as the OpenClaw gateway itself. Use the exact Automnia surfaces and terminology in the documentation: Login, Account & License, Settings, Agents, Missions, Monitor, Plugins, Command Console, and Help. For a how-to question, give a concise explanation followed by ordered steps and name the screen or control to use. Normalize informal wording and spelling mistakes into the closest Automnia topic. For an agent, model, plugin, skill, chat, channel, or workflow setup request, default to agent-first setup: when the user has a configured primary agent with a working model route, first tell them to select it in Agents, open Command Console, and give it a plain-language desired outcome. Give a ready-to-paste prompt that directs the agent to inventory skills, plugins, model, workspace, policy, and runtime readiness, complete the safe configuration and verification its enabled tools allow, and report evidence plus only the smallest remaining human step. Use the Agent Capability Playbook for outcome-based templates and creative ideas; present the selected playbook’s agent-first prompt first, then exact manual controls, prerequisites, safe test, approval boundary, and relevant next playbook. Present manual configuration second, as the detailed self-service path for users who request it or when there is no configured agent yet, account ownership, OAuth consent, a secure credential, billing, or approval is required. Tokens and keys are a secure handoff: never ask for, repeat, or accept passwords, access tokens, API keys, license keys, OAuth codes, customer emails, cookies, or private files in Help or Command Console; direct the user to the secure provider or plugin field, then explain that the primary agent can resume and validate setup after it is saved. Combine relevant facts across documents when that makes the answer more useful. Explain hosted credits versus BYOK, the local OpenClaw Gateway, provider/model setup, agents, missions, plugins, schedules, voice, recovery, and privacy accurately. Distinguish documented product behavior from machine-specific state. You cannot see the user’s screen, local files, live gateway state, private account records, passwords, license keys, provider secrets, or raw logs unless the product explicitly supplies a redacted diagnostic result. Never claim that you changed a setting, reconnected a gateway, checked an account, repaired a machine, or completed a deployment. Never invent prices, entitlements, permissions, model availability, account state, or repair results. If the answer depends on the local machine, direct the user to Monitor, Settings, Doctor, or Diagnostics and say what safe evidence to inspect. If the documentation does not establish the answer, acknowledge the limitation and ask one focused follow-up question rather than guessing. Do not call a normal product-help question rejected; answer it from the product knowledge whenever possible.',
      },
      includeCitations: true,
      answerLanguageCode: 'en',
      ignoreLowRelevantContent: false,
    },
  });

  const requestModel = async (modelVersion) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken.token}`,
      },
        body: JSON.stringify(addKnowledgeDetailInstruction(requestBody(modelVersion))),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok) return { payload, modelVersion, sessionName: activeSessionName };
    const error = new Error(payload?.error?.message || 'Automnia knowledge assistant request failed.');
    error.status = response.status >= 500 && response.status !== 503 ? 502 : response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    const retryAfter = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterSeconds = Math.ceil(retryAfter);
    error.upstreamCode = payload?.error?.status || payload?.error?.code || null;
    error.modelVersion = modelVersion;
    throw error;
  };

  try {
    return await requestModel(knowledgeModelVersion);
  } catch (error) {
    // Agent Search sessions can expire while the desktop Help window remains
    // open. Recover once with a fresh session instead of surfacing a generic
    // rejection or making the user reopen Help.
    if (requestedSessionName && isInvalidKnowledgeSessionError(error)) {
      activeSessionName = await createAutomniaKnowledgeSession(userPseudoId, accessToken.token);
      return await requestModel(knowledgeModelVersion);
    }
    const canFallback = knowledgeFallbackModelVersion
      && knowledgeFallbackModelVersion !== knowledgeModelVersion
      && [400, 404, 422].includes(Number(error?.status));
    if (!canFallback) throw error;
    console.warn(JSON.stringify({
      event: 'knowledge_model_fallback',
      preferredModelVersion: knowledgeModelVersion,
      fallbackModelVersion: knowledgeFallbackModelVersion,
      upstreamStatus: error?.status || null,
    }));
    return await requestModel(knowledgeFallbackModelVersion);
  }
}

// Authenticated, read-only product help. This route is deliberately separate
// from /api/ai/generate so a normal hosted-credit turn never triggers Agent
// Search or its separate billing path unless the caller explicitly asks for
// Automnia knowledge help.
app.post('/api/knowledge/answer', async (req, res) => {
  const email = normalizeEmail(req.body?.email || req.get('X-Automnia-Email'));
  const licenseKey = normalizeKey(req.body?.licenseKey || req.get('X-Automnia-License-Key'));
  const query = String(req.body?.query || '').trim();
  const sessionName = String(req.body?.sessionName || '').trim();
  if (!email || !licenseKey) return res.status(401).json({ ok: false, error: 'Automnia account credentials are required.' });
  if (!query || query.length > 5_000) return res.status(400).json({ ok: false, error: 'Enter a knowledge question between 1 and 5,000 characters.' });
  if (!knowledgeServingEndpoint()) return res.status(503).json({ ok: false, retryable: true, error: 'Automnia knowledge assistant is not configured yet.' });

  try {
    const record = await findLicense(email, licenseKey);
    if (!record) return res.status(401).json({ ok: false, error: 'No active Automnia license found matching this account.' });
    const userPseudoId = `automnia-${crypto.createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
    const result = await answerAutomniaKnowledge(query, userPseudoId, sessionName || null);
    const answer = result.payload?.answer || {};
    return res.status(200).json({
      ok: true,
      grounded: true,
      state: answer.state || null,
      answerText: typeof answer.answerText === 'string' ? answer.answerText : '',
      citations: Array.isArray(answer.citations) ? answer.citations : [],
      references: Array.isArray(answer.references) ? answer.references : [],
      skippedReasons: Array.isArray(answer.answerSkippedReasons) ? answer.answerSkippedReasons : [],
      sessionName: typeof result.payload?.session?.name === 'string' ? result.payload.session.name : result.sessionName || null,
      modelVersion: result.modelVersion,
    });
  } catch (error) {
    const status = Number(error?.status) || 502;
    console.error('Automnia knowledge assistant error:', error);
    const message = status === 429
      ? `Automnia Assistant is temporarily busy because the knowledge service reached its request limit. Try again shortly${error?.retryAfterSeconds ? ` (about ${error.retryAfterSeconds} seconds)` : ''}.`
      : status >= 500
      ? 'Automnia knowledge assistant is temporarily unavailable. Try again in a moment.'
      : status === 401 || status === 403
        ? 'Automnia Cloud is not authorized to query the private knowledge base yet. Redeploy the service with Discovery Engine Viewer access, then try again.'
        : status === 404
          ? 'The Automnia private knowledge base serving configuration was not found. Check the deployed knowledge engine and serving config.'
          : 'Automnia knowledge assistant rejected that question. Ask a direct product-help question and try again.';
    return res.status(status).json({ ok: false, retryable: status === 429 || status >= 500, retryAfterSeconds: error?.retryAfterSeconds || undefined, error: message, upstreamCode: error?.upstreamCode || undefined });
  }
});

function writeOpenAiSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Standards-compatible transport for OpenClaw and other OpenAI-compatible
 * clients. Credits are deducted in the same Firestore transaction used by
 * the existing Automnia relay; tool-call turns are represented as Gemini
 * function calls, so OpenClaw keeps ownership of tool execution and delivery.
 */
app.post('/v1/chat/completions', requireWritesEnabled, async (req, res) => {
  try {
    const access = await resolveHostedRelayAccess(req);
    if (access.error) return openAiError(res, access.status, access.error, access.status === 402 ? 'insufficient_quota' : 'authentication_error');
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const converted = vertexContentsFromOpenAiMessages(messages);
    if (!converted.contents.length) return openAiError(res, 400, 'At least one text, tool-call, or tool-response message is required.');
    const maxOutputTokens = Math.max(128, Math.min(vertexMaxOutputTokens, Number(req.body?.max_tokens || req.body?.max_completion_tokens) || vertexMaxOutputTokens));
    const thinkingConfig = gemini36ThinkingConfigFromOpenAiRequest(req.body);
    const payload = await generateVertexContent({
      ...converted,
      ...(vertexToolsFromOpenAi(req.body?.tools) ? { tools: vertexToolsFromOpenAi(req.body?.tools) } : {}),
      ...(vertexToolConfigFromOpenAi(req.body?.tool_choice) ? { toolConfig: vertexToolConfigFromOpenAi(req.body?.tool_choice) } : {}),
      generationConfig: {
        maxOutputTokens,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });
    const result = vertexCandidateResult(payload);
    const tokensUsed = result.totalTokens || Math.ceil(JSON.stringify(messages).length / 4);
    const requestId = String(req.get('idempotency-key') || req.get('x-request-id') || crypto.randomUUID()).trim().slice(0, 160);
    const debit = await deductCredits(access.record, tokensUsed, requestId);
    const responseId = `chatcmpl_${crypto.randomUUID().replace(/-/g, '')}`;
    const created = Math.floor(Date.now() / 1000);
    const model = 'gemini-3.6-flash';
    const message = {
      role: 'assistant',
      content: result.text || null,
      ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {}),
    };
    const usage = { prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens, total_tokens: tokensUsed };
    console.log(JSON.stringify({ event: 'openai_compatible_generation', orderId: access.record.orderId, tokensUsed, deductedCredits: debit.deductedCredits, remainingCredits: debit.remainingCredits, toolCalls: result.toolCalls.length, duplicateUsageRequest: debit.duplicate }));
    if (req.body?.stream === true) {
      res.status(200);
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      writeOpenAiSse(res, { id: responseId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
      if (result.text) writeOpenAiSse(res, { id: responseId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }] });
      for (const [index, call] of result.toolCalls.entries()) {
        writeOpenAiSse(res, { id: responseId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id, type: 'function', function: call.function }] }, finish_reason: null }] });
      }
      writeOpenAiSse(res, { id: responseId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: result.toolCalls.length ? 'tool_calls' : 'stop' }], ...(req.body?.stream_options?.include_usage ? { usage } : {}) });
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    return res.status(200).json({ id: responseId, object: 'chat.completion', created, model, choices: [{ index: 0, message, finish_reason: result.toolCalls.length ? 'tool_calls' : 'stop' }], usage, automnia: { remainingCredits: debit.remainingCredits, deductedCredits: debit.deductedCredits, tier: access.record.tier } });
  } catch (error) {
    const status = Number(error?.status) || 502;
    if (status === 429) res.set('Retry-After', '5');
    console.error('OpenAI-compatible relay error:', error);
    return openAiError(res, status, status === 429 ? 'Automnia Cloud is temporarily busy. Retry shortly; the route did not fall back.' : 'Automnia Cloud provider request failed.', status === 429 ? 'rate_limit_error' : 'api_error');
  }
});

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
    const credits = pooledCreditBalance(record);

    // An eligible permanent/BYOK account can spend a pooled Automnia balance
    // when the local account selected an Automnia-backed route. A zero balance
    // still leaves the desktop free to use its configured provider directly.
    if (credits <= 0) {
      return res.status(402).json({
        ok: false,
        active: true,
        mode,
        creditBalance: credits,
        error: mode === 'byok'
          ? 'Automnia credit balance exhausted. Configure your own API key in Automnia App Settings or add credits on Shopify.'
          : 'Credit balance exhausted. Top up your credits on Shopify to continue using Cloud AI.',
      });
    }

    const { prompt, model = 'gemini-3.6-flash', messages } = req.body || {};
    const promptText = prompt || (Array.isArray(messages) ? messages.map((m) => m.content || m.text || '').join('\n') : '');

    if (!promptText.trim()) {
      return res.status(400).json({ ok: false, error: 'Prompt or message content is required.' });
    }

    // Customer-controlled model IDs are never passed upstream. Vertex AI uses the Cloud Run service identity,
    // so a client device never receives a master API key.
    const targetModel = 'gemini-3.6-flash';
    const client = await vertexAuth.getClient();
    const accessToken = await client.getAccessToken();
    if (!accessToken.token) throw new Error('Unable to obtain a Vertex AI service token.');
    const vertexHost = vertexLocation === 'global' ? 'aiplatform.googleapis.com' : `${vertexLocation}-aiplatform.googleapis.com`;
    const vertexUrl = `https://${vertexHost}/v1/projects/${gcpProjectId}/locations/${vertexLocation}/publishers/google/models/${targetModel}:generateContent`;

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
    const debit = await deductCredits(record, tokensUsed, requestId);

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
    planPriceCents: tierConfig.planPriceCents ?? null,
    byokAllowed: tierConfig.mode === 'byok' || (!starterSubscriptionOnly(tierConfig) && byokAllowedForTier(tierConfig.tier)),
    permanentAccess: planHasPermanentAccess(tierConfig),
    accessType: planHasPermanentAccess(tierConfig) ? 'permanent' : 'subscription',
    creditBalance: tierConfig.initialCredits,
    licenseKey,
    onboarding: buildOnboardingPackage(order, licenseKey, tierConfig),
    status: 'provisioned',
    subscriptionStatus: planHasPermanentAccess(tierConfig) ? 'permanent' : tierConfig.kind === 'subscription' ? 'active' : null,
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
