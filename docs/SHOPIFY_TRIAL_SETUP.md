# Three-day Shopify trial

Automnia's trial is a storefront subscription trial backed by Shopify selling
plans and enforced by the Cloud Run provisioner. It is not Shopify App Billing's
trial for installing an app in a merchant admin.

## Shopify setup

1. Create or update the Starter subscription product in Shopify.
2. Attach a subscription selling plan to the Starter variant with a three-day
   free trial and a recurring monthly price of $19.99.
3. Keep the selling plan on the same product/variant that is listed in
   `infra/gcloud/shopify-plan-mappings.json`. If the plan uses a separate
   variant or selling-plan ID, add that ID to `sellingPlanIds` in the mapping.
4. Make sure the selling plan collects a payment method at checkout and that
   the first billing date is three days after the contract is created.
5. Deploy the Shopify app configuration so the contract-create, billing-success,
   billing-failure, challenged, cancel, pause, fail, and expire webhooks point
   to `https://api.automnia.app/shopify/webhooks/...`.

The Cloud Run service needs the Shopify Admin API token in the
`SHOPIFY_ADMIN_API_TOKEN` secret. It uses that token to resolve the origin order
when Shopify sends `subscription_contracts/create`; the contract webhook does
not contain the product line needed to select the Automnia plan. The app needs
`read_orders` and `read_own_subscription_contracts` in addition to the webhook
configuration already present in `infra/gcloud/shopify.app.toml.template`.

## Runtime behavior

- A verified contract-create webhook resolves the origin order and checks the
  selling plan against the owner-controlled mapping.
- A first-time customer receives a Firestore entitlement in `trialing` state,
  with `trialStartedAt`, `trialEndsAt`, and `nextBillingAt` recorded.
- Every API request and installer download checks the server-side trial window.
- A successful first billing attempt changes the entitlement to `active`.
- A failed, challenged, cancelled, paused, failed, or expired contract cannot
  use the hosted relay or download installers.
- Shopify webhook delivery IDs are idempotent, so retries do not grant credits
  or send duplicate license emails.
- A checkout email that has already used a trial is not granted a second trial.
  A later paid order can still activate a valid subscription for that customer.

## Verification checklist

Use a new Shopify test customer and verify all of the following:

1. The zero-dollar trial order creates a `trialing` Firestore record and sends
   the license email.
2. The desktop can activate and use hosted credits during the three-day window.
3. The same webhook resent with the same delivery ID does not add credits.
4. The subscription billing success webhook changes the record to `active`.
5. A billing failure or contract cancellation prevents relay requests and
   installer downloads.
6. A second trial checkout using the same email does not receive access.

Shopify documents that subscription contracts are created from selling-plan
purchases and recommends using contract webhooks for notification:
[Shopify subscription contracts](https://shopify.dev/docs/apps/build/purchase-options/subscriptions/contracts).
