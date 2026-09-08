// Public client-safe Automnia Cloud information only. The storefront is
// hosted by Shopify at automnia.app and the service API is hosted at the
// Cloud Run-backed api.automnia.app origin. Secret names, license keys,
// customer emails, and credit balances remain server-owned.
export const ADMIN_GCLOUD_CONFIG = {
  provisionerUrl: 'https://api.automnia.app',
  shopifyWebhookBaseUrl: 'https://api.automnia.app/shopify/webhooks',
  status: 'Automnia Cloud (api.automnia.app)',
} as const
