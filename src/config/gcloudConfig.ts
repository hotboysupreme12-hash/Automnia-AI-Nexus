// Public client-safe Automnia Cloud information only. This temporary Cloud Run
// origin is safe to display; secret names, license keys, customer emails, and
// credit balances remain server-owned.
export const ADMIN_GCLOUD_CONFIG = {
  provisionerUrl: 'https://automnia-shopify-provisioner-336625531977.us-east1.run.app',
  shopifyWebhookBaseUrl: 'https://automnia-shopify-provisioner-336625531977.us-east1.run.app/shopify/webhooks',
  status: 'Automnia Cloud (temporary Cloud Run endpoint)',
} as const
