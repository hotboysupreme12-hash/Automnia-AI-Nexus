# Automnia Google Cloud deployment and migration guide

Automnia now uses one permanent public origin for license activation, Shopify webhooks, checkout, and hosted-credit AI relay traffic:

```text
https://api.automnia.ai
```

Desktop releases no longer contain a project-specific `run.app` address. `AUTOMNIA_LICENSE_API_URL` and `AUTOMNIA_CLOUD_RELAY_URL` remain available as explicit development or emergency overrides, but ordinary customer traffic uses the permanent domain.

The complete deployment package lives in [`infra/gcloud`](../infra/gcloud/README.md). It contains the deployable Cloud Run provisioner source, API enablement, dedicated service-account roles, Secret Manager bindings, Firestore initialization and indexes, the nine production Shopify plan mappings, health/readiness checks, managed export/import commands, fail-closed verification, protected cutover, and reverse-migration rollback.

## Normal project migration

Run these commands from the repository root in PowerShell:

```powershell
.\infra\gcloud\deploy.ps1 -ProjectId new-project-id
.\infra\gcloud\migrate-firestore.ps1 -From old-project-id -To new-project-id
.\infra\gcloud\verify.ps1 -ProjectId new-project-id
.\infra\gcloud\switch-traffic.ps1 -ProjectId new-project-id
```

The first migration still requires a one-time permanent-domain bootstrap and a one-time Shopify app deployment. See the package README. Once Shopify sends every webhook to `api.automnia.ai`, later Google project changes do not require a customer reinstall, new activation keys, balance resets, or webhook edits.

## Why the cutover is fail-closed

`verify.ps1` produces a local, ignored verification report and fails if any of these differ:

- Firestore canonical document hash;
- total and active customer counts;
- current credit balances, top-up totals, or deducted-credit totals;
- Firestore composite index definitions and readiness;
- local, source, and target Shopify plan-mapping hashes;
- latest Secret Manager payload fingerprints and Cloud Run secret bindings;
- required APIs, runtime service account, or IAM roles;
- health, schema, revision, Firestore readiness, or permanent-domain contract;
- non-mutating live license verification and live Shopify checkout reachability.

`switch-traffic.ps1` does not trust an older report. It verifies once, places the old service into a retryable read-only migration mode, performs a final Firestore/secret delta copy, verifies again, routes the target revision, moves the permanent domain, and then verifies the permanent URL. If any step fails, it attempts to restore the original domain mapping and source revision automatically.

## Rollback

Rollback is also data-aware:

```powershell
.\infra\gcloud\rollback.ps1
```

It freezes the current target, reverse-migrates new balances and billing events to the prior project, verifies them, and only then moves the permanent domain back. This prevents a rollback from silently discarding purchases or hosted-credit usage that happened after cutover.

## Customer-facing data boundary

The renderer contains only the permanent public origin. Google project IDs, Cloud Run origins, Secret Manager names, customer emails, license keys, and default balances are server-owned. Account and credit values shown in the app come from the authenticated provisioner response and its local server-side cache; they are not editable defaults compiled into the UI.
