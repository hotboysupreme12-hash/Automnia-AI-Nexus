# Shopify monthly subscription setup

This runbook describes the destination Shopify storefront. It has two paid
monthly subscriptions and no free trial:

| Plan | Monthly price | SKU | Initial hosted tokens |
| --- | ---: | --- | ---: |
| Starter | $19.99 | `AUTO-SUB-STARTER-MONTHLY` | 22,000,000 |
| Pro | $29.99 | `AUTO-SUB-PRO-MONTHLY` | 55,000,000 |

Pro is a recurring subscription. It does not grant permanent access. Cancelling
or otherwise ending the Shopify subscription must end the hosted entitlement.
The Admin API client credentials and webhook signing secret must belong to the
new Shopify app and destination store.

## Configure the destination products

1. Create a Starter product and a Pro product in the destination Shopify store.
   Use the SKUs above and set the monthly recurring prices shown in the table.
2. Create a monthly subscription selling plan for each product. Do not add a
   free trial. Make sure each selling plan is attached to its product variant
   and collects the recurring payment through Shopify checkout.
3. Create or select the `automnia-plans-and-refills` collection and include
   both subscription products.
4. Record each product ID, variant ID, and selling plan ID in
   `infra/gcloud/shopify-plan-mappings.json`. The webhook resolver uses these
   IDs and the SKUs to identify the purchased entitlement.
5. Verify the collection checkout URL in `infra/gcloud/config.psd1` opens the
   destination store and exposes the two subscription products.

Selling plans created through Shopify's Admin API are app-owned. Create them
with the new Automnia app so that the same app can read and maintain the plan
group. The new app installation must have the required product, purchase
option, order, and subscription-contract scopes granted before provisioning.

## Configure webhook and Admin API credentials

The Cloud Run service reads two destination-specific secrets:

- `automnia-shopify-webhook-secrets`: the new app's webhook signing secret.
- `automnia-shopify-admin-api-token`: JSON containing `client_id`,
  `client_secret`, and `store_domain` for the new app and destination store.

The Admin API credential is used for the Shopify client-credentials token
exchange and to resolve subscription contract details. Never copy the old
store's Admin API credential into the destination project.

The app must subscribe to the order, subscription-contract, subscription
billing, cancellation, pause, failure, and expiration webhook topics configured
in `infra/gcloud/shopify-app-new/automnia-ai-nexus/shopify.app.toml`. Shopify
webhook deliveries are idempotent; duplicate delivery IDs must not grant tokens
or send duplicate account emails.

## Existing subscribers

Shopify subscription contracts and saved payment methods are not moved by the
Firestore migration. Keep the old store and app available while customers
reauthorize on the destination or an approved Shopify payment-method migration
is completed. Recreate each destination contract through the new selling plan,
then verify that its origin order and product mapping produce the correct
entitlement. Do not disable the old billing flow or route `api.automnia.app` to
the destination until existing subscribers have a documented transition path.

See [Shopify subscription contracts](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/contracts),
[migrating subscription contracts](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/migrate-to-subscriptions-api/migrate-subscription-contracts),
and [migrating payment methods](https://help.shopify.com/en/manual/products/purchase-options/subscriptions/migrating-payment-methods).

## Verify the purchase lifecycle

Use a Shopify test customer and verify each plan separately:

1. Complete checkout for the monthly plan and confirm the correct order SKU,
   variant, and selling plan are present.
2. Confirm the contract-created and paid-order webhook deliveries resolve to
   the intended plan and grant the initial token balance once.
3. Confirm the stored entitlement includes the contract ID, active subscription
   status, and next billing date, with `permanentAccess` false for Pro.
4. Replay a webhook delivery with the same delivery ID and confirm it does not
   grant tokens or send another welcome email.
5. Cancel the contract and confirm the hosted entitlement and installer access
   are disabled; test pause, billing failure, and expiration paths as well.
6. Confirm the next recurring billing attempt is made by the destination
   scheduler only after the new project is activated.

The local service smoke check covers request handling and idempotency. It does
not replace checkout, webhook-delivery, or recurring-billing verification in
the destination Shopify store.
