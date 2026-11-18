import { execSync } from 'node:child_process'

const projectId = process.env.AUTOMNIA_SHOPIFY_PROJECT || 'project-1799c8b6-3a92-4bbb-85c'
const apiVersion = process.env.AUTOMNIA_SHOPIFY_API_VERSION || '2026-07'
const secretText = execSync(
  `gcloud secrets versions access latest --secret=automnia-shopify-admin-api-token --project=${projectId} --quiet`,
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
)
const secret = JSON.parse(secretText)
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

const describeType = (type, depth = 4) => type && ({
  kind: type.kind,
  ...(type.name ? { name: type.name } : {}),
  ...(depth > 0 && type.ofType ? { ofType: describeType(type.ofType, depth - 1) } : {}),
})
const typeSummary = (type) => type?.inputFields?.map((field) => ({
  name: field.name,
  type: describeType(field.type),
}))

const query = process.argv.includes('--schema') ? `query AutomniaCatalogSchema {
  productSetInput: __type(name: "ProductSetInput") { name inputFields { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } }
  productVariantSetInput: __type(name: "ProductVariantSetInput") { name inputFields { name type { kind name ofType { kind name } } } }
  sellingPlanGroupInput: __type(name: "SellingPlanGroupInput") { name inputFields { name type { kind name ofType { kind name } } } }
  sellingPlanInput: __type(name: "SellingPlanInput") { name inputFields { name type { kind name ofType { kind name } } } }
  sellingPlanBillingPolicyInput: __type(name: "SellingPlanBillingPolicyInput") { name inputFields { name type { kind name ofType { kind name } } } }
  sellingPlanDeliveryPolicyInput: __type(name: "SellingPlanDeliveryPolicyInput") { name inputFields { name type { kind name ofType { kind name } } } }
  sellingPlanInventoryPolicyInput: __type(name: "SellingPlanInventoryPolicyInput") { name inputFields { name type { kind name ofType { kind name } } } }
  recurringPolicyInput: __type(name: "SellingPlanRecurringBillingPolicyInput") { name inputFields { name type { kind name ofType { kind name } } } }
  deliveryPolicyInput: __type(name: "SellingPlanRecurringDeliveryPolicyInput") { name inputFields { name type { kind name ofType { kind name } } } }
  pricingPolicyInput: __type(name: "SellingPlanPricingPolicyInput") { name inputFields { name type { kind name ofType { kind name } } } }
  fixedPricingPolicyInput: __type(name: "SellingPlanFixedPricingPolicyInput") { name inputFields { name type { kind name ofType { kind name } } } }
  recurringPricingPolicyInput: __type(name: "SellingPlanRecurringPricingPolicyInput") { name inputFields { name type { kind name ofType { kind name } } } }
  inventoryItemInput: __type(name: "InventoryItemInput") { name inputFields { name type { kind name ofType { kind name } } } }
  productOptionSetInput: __type(name: "ProductOptionSetInput") { name inputFields { name type { kind name ofType { kind name } } } }
  optionValueSetInput: __type(name: "ProductOptionValueSetInput") { name inputFields { name type { kind name ofType { kind name } } } }
  variantOptionValueInput: __type(name: "VariantOptionValueInput") { name inputFields { name type { kind name ofType { kind name } } } }
  collectionInput: __type(name: "CollectionCreateInput") { name inputFields { name type { kind name ofType { kind name } } } }
  collectionSourceInput: __type(name: "CollectionSourceInput") { name inputFields { name type { kind name ofType { kind name } } } }
  collectionSourceConditionInput: __type(name: "CollectionSourceConditionInput") { name inputFields { name type { kind name ofType { kind name } } } }
  collectionSourceSelectionInput: __type(name: "CollectionSourceSelectionInput") { name inputFields { name type { kind name ofType { kind name } } } }
  productSetIdentifierInput: __type(name: "ProductSetIdentifiers") { name inputFields { name type { kind name ofType { kind name } } } }
}` : `query AutomniaCatalogAudit {
  shop { name myshopifyDomain }
  currentAppInstallation { app { title } accessScopes { handle } }
  webhookSubscriptions(first: 100) {
    nodes {
      id topic
      endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
    }
  }
  products(first: 100) {
    nodes {
      id title handle status tags vendor descriptionHtml requiresSellingPlan
      collections(first: 20) { nodes { id title handle } }
      variants(first: 30) {
        nodes { id title sku price selectedOptions { name value } }
      }
      sellingPlanGroups(first: 20) {
        nodes { id name merchantCode sellingPlans(first: 10) { nodes { id name category } } }
      }
    }
  }
  collections(first: 100) { nodes { id title handle products(first: 50) { nodes { handle } } } }
}`
const response = await fetch(`https://${secret.store_domain}/admin/api/${apiVersion}/graphql.json`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-shopify-access-token': accessToken },
  body: JSON.stringify({ query }),
})
const payload = await response.json()
if (!response.ok || payload.errors?.length) {
  throw new Error(`Shopify catalog query failed: ${JSON.stringify(payload.errors ?? response.status)}`)
}
if (process.argv.includes('--schema')) {
  const data = payload.data
  process.stdout.write(`${JSON.stringify(Object.fromEntries(Object.entries(data).map(([key, type]) => [key, { name: type?.name, fields: typeSummary(type) }])), null, 2)}\n`)
  process.exit(0)
}
const { shop, currentAppInstallation, webhookSubscriptions, products, collections } = payload.data
process.stdout.write(`${JSON.stringify({
  shop,
  currentAppInstallation,
  webhookSubscriptions: webhookSubscriptions.nodes.map((node) => ({
    id: node.id,
    topic: node.topic,
    endpointType: node.endpoint?.__typename,
    callbackUrl: node.endpoint?.callbackUrl,
  })),
  products: products.nodes,
  collections: collections.nodes,
}, null, 2)}\n`)
