// Public client-safe Automnia Cloud information only. Project IDs, Cloud Run
// origins, secret names, license keys, customer emails, and credit balances are
// deliberately server-owned and must not be compiled into the renderer.
export const ADMIN_GCLOUD_CONFIG = {
  permanentProvisionerUrl: 'https://api.automnia.ai',
  shopifyWebhookBaseUrl: 'https://api.automnia.ai/shopify/webhooks',
  status: 'Automnia Cloud (permanent domain)',
} as const
