import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectId = process.env.AUTOMNIA_SHOPIFY_PROJECT || 'project-1799c8b6-3a92-4bbb-85c'
const expectedShop = 'j12hqc-h2.myshopify.com'
const apiVersion = process.env.AUTOMNIA_SHOPIFY_API_VERSION || '2026-07'
const mappingPath = fileURLToPath(new URL('../shopify-plan-mappings.json', import.meta.url))

const secretText = execSync(
  `gcloud secrets versions access latest --secret=automnia-shopify-admin-api-token --project=${projectId} --quiet`,
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
)
const secret = JSON.parse(secretText)
if (secret.store_domain !== expectedShop) {
  throw new Error(`Refusing to provision catalog for unexpected Shopify shop '${secret.store_domain}'.`)
}
const tokenResponse = await fetch(`https://${secret.store_domain}/admin/oauth/access_token`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_id: secret.client_id,
    client_secret: secret.client_secret,
    grant_type: 'client_credentials',
  }),
})
if (!tokenResponse.ok) throw new Error(`Shopify client credentials failed with HTTP ${tokenResponse.status}`)
const { access_token: accessToken } = await tokenResponse.json()

async function graphql(query, variables = {}) {
  const response = await fetch(`https://${expectedShop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': accessToken },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors?.length) {
    throw new Error(`Shopify GraphQL failed: ${JSON.stringify(payload.errors ?? response.status)}`)
  }
  return payload.data
}

function assertUserErrors(operation, errors = []) {
  if (errors.length) {
    throw new Error(`${operation} failed: ${errors.map((error) => `${error.field?.join('.') ?? 'input'}: ${error.message}`).join('; ')}`)
  }
}

const specs = [
  {
    handle: 'automnia-starter',
    title: 'Automnia Starter',
    descriptionHtml: '<p>Starter hosted AI subscription for Automnia AI Nexus. $19.99 per month. 22,000 Automnia hosted credits added after each successful paid billing cycle (22,000,000 metered tokens at 1,000 tokens per credit). Managed Automnia model access with no provider API key required. Upgrade or refill at any time.</p>',
    productType: 'Digital Subscription',
    tags: ['automnia', 'subscription', 'monthly', 'digital', 'hosted-credits'],
    requiresSellingPlan: true,
    optionName: 'Subscription',
    variants: [{ option: 'Monthly', price: '19.99', sku: 'AUTO-SUB-STARTER-MONTHLY' }],
    sellingPlan: { merchantCode: 'automnia-starter-monthly', name: 'Automnia Starter Monthly', description: 'Automnia Starter billed monthly at $19.99.' },
  },
  {
    handle: 'automnia-pro',
    title: 'Automnia Pro',
    descriptionHtml: '<p>Complete Automnia hosted AI subscription for customers who want every advanced capability. $29.99 per month. 55,000 Automnia hosted credits added after each successful paid billing cycle (55,000,000 metered tokens at 1,000 tokens per credit). Everything in Starter, plus all advanced Automnia capabilities, access to 200+ specialized agents, priority routing, bring your own AI providers, models, and APIs, and early access to new features. Upgrade or refill at any time.</p>',
    productType: 'Digital Subscription',
    tags: ['automnia', 'subscription', 'monthly', 'digital', 'hosted-credits', 'pro'],
    requiresSellingPlan: true,
    optionName: 'Subscription',
    variants: [{ option: 'Monthly', price: '29.99', sku: 'AUTO-SUB-PRO-MONTHLY' }],
    sellingPlan: { merchantCode: 'automnia-pro-monthly', name: 'Automnia Pro Monthly', description: 'Automnia Pro billed monthly at $29.99.' },
  },
  {
    handle: 'automnia-credit-refill',
    title: 'Automnia Credit Refill',
    descriptionHtml: '<p>Add hosted AI credits to your Automnia account. Choose a refill amount at checkout; every US dollar converts automatically to 100 Automnia credits (100,000 metered tokens at 1,000 tokens per credit) after Shopify confirms payment. Credits appear automatically through Google Cloud entitlement sync. Use the same email address as your Automnia account. No shipping or physical delivery.</p>',
    productType: 'Digital Credit Refill',
    tags: ['automnia', 'credit-refill', 'digital', 'hosted-credits'],
    requiresSellingPlan: false,
    optionName: 'Credit package',
    variants: [
      { option: '$1 - 100 Automnia credits (100,000 tokens)', price: '1.00', sku: 'AUTO-REFILL-100K' },
      { option: '$5 - 500 Automnia credits (500,000 tokens)', price: '5.00', sku: 'AUTO-REFILL-500K' },
      { option: '$10 - 1,000 Automnia credits (1,000,000 tokens)', price: '10.00', sku: 'AUTO-REFILL-1M' },
      { option: '$25 - 2,500 Automnia credits (2,500,000 tokens)', price: '25.00', sku: 'AUTO-REFILL-2500K' },
      { option: '$50 - 5,000 Automnia credits (5,000,000 tokens)', price: '50.00', sku: 'AUTO-REFILL-5M' },
      { option: '$100 - 10,000 Automnia credits (10,000,000 tokens)', price: '100.00', sku: 'AUTO-REFILL-10M' },
    ],
  },
  {
    handle: 'automnia-byok',
    title: 'Automnia BYOK',
    descriptionHtml: '<p>One-time Bring Your Own Key access for Automnia AI Nexus.</p><ul><li>$29.99 one-time purchase; no recurring charge.</li><li>Connect your own provider API key or use the provider\'s regular sign-in flow.</li><li>Your provider bills model usage directly; Automnia hosted credits are not included.</li><li>Upgrade to a hosted-credit subscription at any time.</li></ul>',
    productType: 'Digital License',
    tags: ['automnia', 'byok', 'digital', 'one-time-license'],
    requiresSellingPlan: false,
    optionName: 'License',
    variants: [{ option: 'One-time license', price: '29.99', sku: 'AUTO-BYOK-ONETIME' }],
  },
]

const initialData = await graphql(`query CatalogPreflight {
  shop { name myshopifyDomain }
  products(first: 250) { nodes { id handle title variants(first: 100) { nodes { id sku } } } }
  collections(first: 100) { nodes { id title handle } }
}`)
if (initialData.shop.myshopifyDomain !== expectedShop) {
  throw new Error(`Shopify API returned an unexpected shop '${initialData.shop.myshopifyDomain}'.`)
}
const expectedSkus = new Set(specs.flatMap((spec) => spec.variants.map((variant) => variant.sku)))
const handles = new Set(specs.map((spec) => spec.handle))
const collisions = initialData.products.nodes.flatMap((product) => product.variants.nodes
  .filter((variant) => expectedSkus.has(variant.sku) && !handles.has(product.handle))
  .map((variant) => `${variant.sku} is already used by ${product.handle}`))
if (collisions.length) throw new Error(`Catalog preflight found SKU conflicts: ${collisions.join('; ')}`)

let collection = initialData.collections.nodes.find((item) => item.handle === 'automnia-plans-and-refills')
if (!collection) {
  const created = await graphql(`mutation CreateAutomniaCollection($collection: CollectionCreateInput!) {
    collectionCreate(collection: $collection) {
      collection { id title handle }
      userErrors { field message }
    }
  }`, {
    collection: {
      title: 'Automnia Plans and Refills',
      handle: 'automnia-plans-and-refills',
      descriptionHtml: '<p>Automnia monthly subscriptions, hosted credit refills, and BYOK access.</p>',
    },
  })
  assertUserErrors('Collection creation', created.collectionCreate.userErrors)
  collection = created.collectionCreate.collection
}

const products = new Map()
for (const spec of specs) {
  const input = {
    title: spec.title,
    handle: spec.handle,
    descriptionHtml: spec.descriptionHtml,
    productType: spec.productType,
    vendor: 'Automnia AI Nexus',
    status: 'ACTIVE',
    tags: spec.tags,
    collections: [collection.id],
    requiresSellingPlan: spec.requiresSellingPlan,
    productOptions: [{
      name: spec.optionName,
      position: 1,
      values: spec.variants.map(({ option }) => ({ name: option })),
    }],
    variants: spec.variants.map((variant, index) => ({
      position: index + 1,
      optionValues: [{ optionName: spec.optionName, name: variant.option }],
      price: variant.price,
      sku: variant.sku,
      inventoryPolicy: 'CONTINUE',
      inventoryItem: { tracked: false, requiresShipping: false },
    })),
  }
  const result = await graphql(`mutation UpsertAutomniaProduct($identifier: ProductSetIdentifiers!, $input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(identifier: $identifier, input: $input, synchronous: $synchronous) {
      product {
        id title handle status
        variants(first: 30) { nodes { id title sku price selectedOptions { name value } } }
      }
      userErrors { field message }
    }
  }`, { identifier: { handle: spec.handle }, input, synchronous: true })
  assertUserErrors(`Product ${spec.handle} upsert`, result.productSet.userErrors)
  const product = result.productSet.product
  if (product.variants.nodes.length !== spec.variants.length) {
    throw new Error(`Product ${spec.handle} has ${product.variants.nodes.length} variants; expected ${spec.variants.length}.`)
  }
  for (const expected of spec.variants) {
    const actual = product.variants.nodes.find((variant) => variant.sku === expected.sku)
    if (!actual || actual.price !== expected.price) {
      throw new Error(`Product ${spec.handle} failed the SKU/price check for ${expected.sku}.`)
    }
  }
  products.set(spec.handle, { ...product, spec })
}

const sellingPlanIds = new Map()
for (const spec of specs.filter((item) => item.sellingPlan)) {
  const product = products.get(spec.handle)
  const existingGroupResult = await graphql(`query ExistingAutomniaSellingPlans($id: ID!) {
    product(id: $id) {
      sellingPlanGroups(first: 20) {
        nodes { id name merchantCode sellingPlans(first: 10) { nodes { id name } } }
      }
    }
  }`, { id: product.id })
  const existingGroup = existingGroupResult.product.sellingPlanGroups.nodes
    .find((group) => group.merchantCode === spec.sellingPlan.merchantCode)
  let group = existingGroup
  if (!group) {
    const created = await graphql(`mutation CreateAutomniaSellingPlan($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
      sellingPlanGroupCreate(input: $input, resources: $resources) {
        sellingPlanGroup { id name merchantCode sellingPlans(first: 10) { nodes { id name } } }
        userErrors { field message }
      }
    }`, {
      input: {
        name: spec.sellingPlan.name,
        merchantCode: spec.sellingPlan.merchantCode,
        description: spec.sellingPlan.description,
        options: ['Billing frequency'],
        sellingPlansToCreate: [{
          name: 'Monthly subscription',
          options: ['Monthly'],
          category: 'SUBSCRIPTION',
          billingPolicy: { recurring: { interval: 'MONTH', intervalCount: 1 } },
          deliveryPolicy: { recurring: { interval: 'MONTH', intervalCount: 1 } },
          inventoryPolicy: { reserve: 'ON_SALE' },
          pricingPolicies: [],
        }],
      },
      resources: { productIds: [product.id], productVariantIds: [] },
    })
    assertUserErrors(`Selling plan ${spec.sellingPlan.merchantCode} creation`, created.sellingPlanGroupCreate.userErrors)
    group = created.sellingPlanGroupCreate.sellingPlanGroup
  }
  const plan = group.sellingPlans.nodes.find((item) => item.name === 'Monthly subscription')
  if (!plan) throw new Error(`Selling plan ${spec.sellingPlan.merchantCode} did not return a monthly plan.`)
  sellingPlanIds.set(spec.handle, plan.id)
}

const finalProducts = new Map()
for (const spec of specs) {
  const productResult = await graphql(`query FinalAutomniaProduct($handle: String!) {
    productByHandle(handle: $handle) {
      id title handle status
      variants(first: 30) { nodes { id title sku price } }
      sellingPlanGroups(first: 20) { nodes { merchantCode sellingPlans(first: 10) { nodes { id name } } } }
    }
  }`, { handle: spec.handle })
  const product = productResult.productByHandle
  if (!product) throw new Error(`Shopify product '${spec.handle}' disappeared after setup.`)
  finalProducts.set(spec.handle, product)
}

const mappings = JSON.parse(readFileSync(mappingPath, 'utf8'))
const numericId = (gid) => String(gid).split('/').at(-1)
for (const mapping of mappings) {
  const sku = mapping.skus?.[0]
  const spec = specs.find((candidate) => candidate.variants.some((variant) => variant.sku === sku))
  if (!spec) throw new Error(`No Shopify product definition was found for mapping SKU '${sku}'.`)
  const product = finalProducts.get(spec.handle)
  const variant = product.variants.nodes.find((candidate) => candidate.sku === sku)
  if (!variant) throw new Error(`Shopify is missing the variant mapped to SKU '${sku}'.`)
  mapping.productIds = [numericId(product.id)]
  mapping.variantIds = [numericId(variant.id)]
  if (spec.sellingPlan) {
    const plan = product.sellingPlanGroups.nodes
      .flatMap((group) => group.sellingPlans.nodes)
      .find((candidate) => candidate.id === sellingPlanIds.get(spec.handle))
    if (!plan) throw new Error(`Shopify is missing the monthly selling plan mapped to SKU '${sku}'.`)
    mapping.sellingPlanIds = [numericId(plan.id)]
  }
}
writeFileSync(mappingPath, `${JSON.stringify(mappings, null, 2)}\n`, 'utf8')

process.stdout.write(`${JSON.stringify({
  shop: expectedShop,
  collection: { id: collection.id, handle: collection.handle, title: collection.title },
  products: [...finalProducts.values()].map((product) => ({
    id: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    variants: product.variants.nodes.map((variant) => ({ id: variant.id, sku: variant.sku, price: variant.price })),
    sellingPlanIds: product.sellingPlanGroups.nodes.flatMap((group) => group.sellingPlans.nodes.map((plan) => plan.id)),
  })),
  publishedViaOnlineStore: false,
  note: 'Products are prepared but remain unpublished until the app and storefront are switched from read-only staging.',
}, null, 2)}\n`)
