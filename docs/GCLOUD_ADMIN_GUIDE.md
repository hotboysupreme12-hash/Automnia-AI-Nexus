# Automnia Google Cloud deployment and migration guide

For the temporary deployment period, Automnia uses one Cloud Run origin for license activation, Shopify webhooks, checkout, and hosted-credit AI relay traffic:

```text
https://automnia-shopify-provisioner-idkndr7vfq-ue.a.run.app
```

Desktop releases currently use the Cloud Run origin above. `AUTOMNIA_LICENSE_API_URL` and `AUTOMNIA_CLOUD_RELAY_URL` remain available as explicit development or emergency overrides. Move `AUTOMNIA_PUBLIC_CLOUD_URL` back to the Automnia public hostname after DNS cutover.

## Automnia knowledge assistant

The production project also contains a private Google Agent Search knowledge
store and grounded search engine. It is seeded from the sanitized, curated
corpus under [`infra/gcloud/knowledge`](../infra/gcloud/knowledge) and selected
product/OpenClaw documentation. Publish the current corpus with:

```bash
npm run publish:knowledge
```

The publisher uploads only the selected user/product and runtime reference
documents; it does not upload the repository wholesale. It is exposed through
the authenticated, read-only Cloud Run route `POST /api/knowledge/answer`.
Normal hosted-credit chat does not call this route automatically; a caller must
explicitly request knowledge help. Do not upload passwords, access tokens, API
keys, license keys, customer emails, or private workspace files to the knowledge
store.

The grounded assistant uses an **agent-first setup** policy. For a model,
plugin, skill, chat, channel, or workflow request, it first directs a user with
a configured primary agent to send that agent a plain-language setup goal in
Command Console. The agent performs the safe setup and verification available
to its configured tools, then reports any remaining secure credential, consent,
or approval step. The assistant supplies the detailed manual configuration path
second, or first only for first-agent bootstrap and requirements that need the
operator. Tokens and keys remain in secure provider/plugin fields; they are not
accepted in Help or Command Console. Publish the corpus after changing this
behavior so Agent Search and the deployed prompt stay aligned.

Account activation, password sign-in, Google account linking, and password
changes are served by this same Cloud Run service. The live origin is now on
revision `automnia-shopify-provisioner-00048-suw` (`2.5.0` / schema
`2026-08-13.4`), which includes the authenticated knowledge route, the
3.1-first grounded assistant, and stale-session recovery. Account
password hashes and Google subject links are stored on the existing license
documents in Firestore. Password recovery intentionally has no public
email-plus-license-key reset route.

The complete deployment package lives in [`infra/gcloud`](../infra/gcloud/README.md). It contains the deployable Cloud Run provisioner source, API enablement, dedicated service-account roles, Secret Manager bindings, Firestore initialization and indexes, the nine production Shopify plan mappings, health/readiness checks, managed export/import commands, fail-closed verification, protected cutover, and reverse-migration rollback.

The production billing account also has a project-scoped promotional-credit
alert budget named `Automnia promotional credit alert`, covering the current
`$1,000` credit window through May 29, 2027 with alerts at 50%, 75%, 90%, and
100%. Cloud Billing budgets notify; they do not stop Cloud Run or Vertex AI
automatically. Review the budget before adding any new paid services.

## Normal project migration

Run these commands from the repository root in PowerShell:

```powershell
.\infra\gcloud\deploy.ps1 -ProjectId new-project-id
.\infra\gcloud\migrate-firestore.ps1 -From old-project-id -To new-project-id
.\infra\gcloud\verify.ps1 -ProjectId new-project-id
.\infra\gcloud\switch-traffic.ps1 -ProjectId new-project-id
```

The first migration still requires a one-time public-domain bootstrap and a one-time Shopify app deployment. See the package README. Once Shopify sends every webhook to the public Automnia hostname, later Google project changes do not require a customer reinstall, new activation keys, balance resets, or webhook edits.

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

The renderer contains only the temporary Cloud Run origin needed for this deployment. Secret Manager names, customer emails, license keys, and default balances are server-owned. Account and credit values shown in the app come from the authenticated provisioner response and its local server-side cache; they are not editable defaults compiled into the UI.
