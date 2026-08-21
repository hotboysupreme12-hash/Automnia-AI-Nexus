# Automnia Google Cloud deployment package

This directory is the source of truth for the Automnia Shopify provisioner and for moving it between Google Cloud projects. Every mutating script supports `-WhatIf`. All operational reports are written under `.state/`, which is ignored by Git and contains hashes and counts, not secret payloads or license keys.

The complete product/operator documentation map and Help response contract are
in [`../../docs/AUTOMNIA_ASSISTANT_OPERATIONS_MANUAL.md`](../../docs/AUTOMNIA_ASSISTANT_OPERATIONS_MANUAL.md).
Private Help Assistant source files live in `infra/gcloud/knowledge/` and are
included in the sanitized corpus by `npm run publish:knowledge`.

## Included components

| File | Purpose |
| --- | --- |
| `deploy.ps1` | Enables APIs, checks billing, creates the runtime identity, grants least-purpose roles, initializes Firestore and indexes, creates/binds secrets, and deploys a tagged Cloud Run candidate. |
| `initialize-firestore.ps1` | Creates the Native-mode `(default)` database and applies the declared index contract. |
| `export-firestore.ps1` / `import-firestore.ps1` | Explicit managed export/import commands with non-empty-target protection. |
| `migrate-firestore.ps1` | Exports and imports all Firestore data, copies required secret versions without printing them, refreshes the candidate revision, and compares canonical snapshots. |
| `health.ps1` | Validates service version/schema, write mode, Firestore access, Shopify setup, plan hash, and webhook-secret readiness. |
| `verify.ps1` | Runs every fail-closed data, configuration, IAM, secret, and live billing gate and writes a switch-eligible report. |
| `switch-traffic.ps1` | Freezes source writes, performs a final delta migration, re-verifies, moves the permanent domain, and restores the source automatically on failure. |
| `rollback.ps1` | Freezes the active target, reverse-migrates post-cutover changes, verifies, and moves the domain back. |
| `configure-domain.ps1` | One-time domain mapping and optional Cloud DNS record setup. |
| `shopify-plan-mappings.json` | The authoritative product mappings, including the $1 / 100,000-credit refill and free QA license. Google Cloud merges purchases by account email into one highest-tier entitlement and canonical license key. |
| `firestore.indexes.json` | The authoritative composite-index contract. It is empty because the current query plan needs no composite index. |
| `shopify.app.toml.template` | One-time Shopify webhook migration from a project URL to the permanent Automnia URL. |
| `service/` | Deployable Node 22 Cloud Run service for account activation/sign-in, Google linking, license activation, Shopify webhooks, credits, Vertex AI relay, and authenticated Agent Search answers. |
| `knowledge/` | Sanitized, non-secret source used by the private Automnia Agent Search data store. Never add customer data, passwords, tokens, API keys, or license keys. |

## Hosted-credit token efficiency

The Cloud/Credits relay applies a server-owned token-efficiency policy to every
OpenAI-compatible request, so callers cannot accidentally bypass it by using a
different desktop surface or an older `/api/ai/generate` client. The policy:

- keeps only a bounded recent conversation window and merges system/developer
  instructions;
- shortens oversized user, assistant, and tool-result content with a visible
  marker while preserving the head and tail of the result;
- limits repeated inline images per request and rejects oversized inline image
  payloads before they can dominate a hosted turn;
- removes non-essential JSON Schema metadata from tool declarations while
  preserving tool names, types, properties, enums, and required fields, then
  applies a combined tool-schema budget so a large plugin inventory cannot
  consume the whole prompt;
- chooses a smaller automatic output budget (1,536 tokens for text and 3,072
  for tool turns, with higher thinking levels still bounded by the relay cap);
- honors an explicit caller `max_tokens`/`max_completion_tokens` value only up
  to the relay maximum;
- avoids the default four-attempt upstream retry fan-out by using two attempts,
  while retaining transient recovery and model fallback;
- replays a completed idempotent response from the local/Firestore cache rather
  than generating and charging upstream tokens again; a charged but unreplayable
  idempotency key fails closed instead of silently spending more tokens.

The deployed limits are explicit in `config.psd1` and are passed by
`deploy.ps1` as `AUTOMNIA_RELAY_*` environment variables. The default hosted
request envelope is approximately 8,192 input tokens plus 4,096 tool-schema
tokens and 4,096 output tokens. Vertex usage metadata remains authoritative for
the debit: compaction changes the request before the model call, but the
Firestore credit ledger charges the actual returned usage, not a local estimate.

## Prerequisites

Install Google Cloud CLI and Node.js 22 or newer. Authenticate with an account that can enable services, link billing, create service accounts and secrets, grant project IAM, deploy Cloud Run from source, export/import Firestore, and manage the verified domain.

For source deployment, the script grants `roles/run.builder` to the project's Compute Engine default service account, matching current Cloud Run source-build behavior. The runtime identity receives only:

```text
roles/aiplatform.user
roles/datastore.user
roles/logging.logWriter
roles/secretmanager.secretAccessor
```

The deployer still needs its own Cloud Run source-developer, Service Usage consumer/admin, IAM administration, and service-account-user permissions. Project Owner includes those permissions but is broader than necessary.

## One-time configuration

Review `config.psd1` before the first deployment:

- `PermanentBaseUrl` and `PermanentDomain` default to `https://api.automnia.ai` / `api.automnia.ai`.
- `DnsProjectId` and `DnsZone` can be filled in to make DNS record changes automatic when Cloud DNS hosts the zone. Leave them blank for another DNS provider and add the returned mapping records there once.
- `Region`, Firestore location, checkout URL, service name, API list, roles, secret names, and collection contract are centralized here.
- `GmailSender` configures the Google account that sends the branded Automnia welcome letter, teal logo, license key, and login instructions. The `automnia-gmail-oauth-credentials` secret contains a Google OAuth desktop-client JSON credential with a refresh token and Gmail send scope. The provisioner calls Gmail API `users.messages.send` directly, so paid orders do not depend on Shopify's outstanding-invoice state. The existing Shopify Admin secret remains a migration-compatible binding but is not used for customer email delivery.
- `KnowledgeDataStoreId` and `KnowledgeEngineId` identify the private Agent Search resources used by `/api/knowledge/answer`. Those resources must exist in a new project before the service is routed to traffic; the current production project already has them.

The base domain must be purchased and verified by the operating Google account. If it is not already verified:

```powershell
gcloud domains verify automnia.ai
```

Deploy the current project with this package, then create the permanent mapping:

```powershell
.\infra\gcloud\deploy.ps1 -ProjectId current-project-id -RouteImmediately
.\infra\gcloud\configure-domain.ps1 -ProjectId current-project-id -DnsProjectId dns-project-id -DnsZone automnia-zone
```

Cloud Run domain mappings issue a managed certificate and can take time to become ready. The script waits and refuses to report success until the permanent HTTPS health endpoint works.

When another DNS provider hosts `automnia.ai`, omit the Cloud DNS arguments on the first run. The command returns `PendingDns = true`, the exact records to add, and a state-file audit trail without waiting. Add those records at the provider, then finish certificate and HTTPS validation with:

```powershell
.\infra\gcloud\configure-domain.ps1 -ProjectId current-project-id -ExternalDnsReady
```

Copy `shopify.app.toml.template` to the private Shopify app project, preserve the correct Shopify app client ID if it differs, and run:

```powershell
shopify app deploy
```

The webhook is acknowledged only after the license email is confirmed. If
Gmail or the Gmail OAuth credential is unavailable, the handler returns a
retryable response and keeps the delivery state pending; use the authenticated
`/admin/email-delivery/retry` endpoint after the credential is repaired for an
already-provisioned order.

The Shopify app may retain `write_orders` for other administrative workflows,
but customer email delivery no longer requires it.

This is the only webhook change. All subscription, cancellation, refund, and billing-attempt topics then target the permanent domain.

## Deploy a new target project

Billing must already be enabled, or it can be linked explicitly:

```powershell
.\infra\gcloud\deploy.ps1 -ProjectId new-project-id -BillingAccountId 000000-000000-000000
```

Without `-BillingAccountId`, deployment fails if billing is disabled. A new target receives cryptographically random bootstrap secret versions so Cloud Run can deploy before migration. The Shopify app secret is the exception: deployment refuses to create or accept a bootstrap placeholder for `SHOPIFY_ADMIN_API_TOKEN`, because a paid order must never be acknowledged without a usable customer-email credential. Other bootstrap values are not switch-eligible; migration replaces them with exact copies from the source and verification compares SHA-256 fingerprints.

To initialize the first project from explicit values, pass a local JSON file whose keys are secret resource names or environment names. The file is read locally, never printed, and should not be committed:

```json
{
  "automnia-shopify-webhook-secrets": "first-secret,rotated-secret",
  "automnia-admin-api-token": "a-long-random-admin-token"
}
```

```powershell
.\infra\gcloud\deploy.ps1 -ProjectId current-project-id -SecretValuesFile C:\secure\automnia-values.json -RouteImmediately
```

## Migrate data and secrets

The normal command creates a uniformly-access-controlled migration bucket in the target project, temporarily grants both Firestore service agents access, performs a managed export/import of every collection and subcollection, copies the required latest secret versions, removes temporary bucket IAM, and compares the result:

```powershell
.\infra\gcloud\migrate-firestore.ps1 -From old-project-id -To new-project-id
```

The target must be empty by default. `-AllowNonEmptyTarget` is reserved for the final cutover delta and rollback; exact post-import hashing still catches extra or stale documents.

### Hosted-credit wallet behavior during upgrades

An account’s hosted credits are an email-level pooled wallet. When a Starter
account upgrades to BYOK, Pro, Enterprise, or another eligible tier, the
canonical entitlement changes but the prior non-revoked hosted-credit balances
are preserved. Any credits granted by the new order are additive; they are not
used to replace the previous balance. The public license response reports the
pooled balance, and the hosted relay can use that wallet when the account’s
usage priority is **Automnia credits only** or **My provider + Automnia credits**.
For the combined route, the account can choose whether Automnia or the connected
provider runs first. There is no selectable provider-only route.

The service keeps wallet sources separate for auditability and starts future
deductions with the canonical upgraded entitlement, then consumes older
non-revoked sources. Revoked records are excluded from the pool.

BYOK starts at the $29.99 tier. If a BYOK account has a confirmed pooled
balance—such as credits carried over from Starter—the Account & License
selector exposes **My provider + Automnia credits** and a secondary choice of
provider-first or Automnia-first. Starter ($19.99) and credit refills remain
locked to **Automnia credits only**; a zero balance stops the route with an
explicit refill message. The $49.99 and $199 Enterprise tiers use the same
combined provider-plus-Automnia controls.

The lower-level commands are available for audited backup/restore operations:

```powershell
.\infra\gcloud\export-firestore.ps1 -ProjectId old-project-id -OutputUriPrefix gs://bucket/automnia/export-id
.\infra\gcloud\import-firestore.ps1 -ProjectId new-project-id -InputUriPrefix gs://bucket/automnia/export-id
```

Do not delete the old project or migration export until the rollback window closes.

## Verify and cut over

```powershell
.\infra\gcloud\verify.ps1 -ProjectId new-project-id
.\infra\gcloud\switch-traffic.ps1 -ProjectId new-project-id
```

The migration state supplies the old project ID automatically. You can provide `-SourceProjectId` explicitly when state files are unavailable.

The verification gate refuses traffic when any of these do not match:

1. Every Firestore document field, including license indexes, usage idempotency records, top-ups, and webhook delivery records.
2. Customer counts, active-customer counts, credit-balance totals, top-up totals, and deducted-credit totals.
3. Source, target, and declared composite indexes.
4. Source, target, and declared Shopify plan mappings.
5. Required secret values by one-way fingerprint and their Cloud Run bindings.
6. Required APIs, runtime identity, and IAM roles.
7. Cloud Run health, revision schema, Firestore readiness, and permanent-host contract.
8. A non-mutating verification against a real non-revoked license (or the rejection path for an empty ledger) and reachability of the configured live Shopify checkout.

`switch-traffic.ps1` repeats verification after a protected final delta; an old report is never enough to switch.

## Roll back safely

Use the latest successful switch state:

```powershell
.\infra\gcloud\rollback.ps1
```

Or identify the active and prior projects explicitly:

```powershell
.\infra\gcloud\rollback.ps1 -FromProjectId new-project-id -ToProjectId old-project-id
```

Rollback freezes writes on the active service, copies post-cutover Firestore and secret changes back, verifies the reverse migration, activates the prior candidate revision, and only then restores the permanent domain. If reverse verification fails, the permanent domain stays on the current project.

## Operational safeguards

- Never pass secret values directly on a command line. Use Secret Manager migration or `-SecretValuesFile` from a protected local path.
- `MIGRATION_WRITE_MODE=read_only` returns retryable HTTP 503 responses before activation, AI credit charging, or webhook writes. Shopify can retry deliveries after cutover.
- Firestore import merges rather than deletes. Exact canonical hashes make extra target documents a hard failure.
- License keys are never written to state reports or sent in URL query strings by the live migration test.
- Migration buckets retain recoverable exports. Remove them only under the organization's retention policy after rollback is no longer required.
- Run `-WhatIf` to inspect resource mutations. Verification and health scripts are read-only.
