# Desktop automatic updates

Automnia desktop updates are a signed, cross-platform release channel backed by Google Cloud Storage. Installed apps check quietly, download in the background, independently verify the payload, and ask for one explicit restart before replacing the running version.

## Production architecture

1. The public release workflow builds an Authenticode-signed NSIS installer, a signed/notarized macOS DMG and ZIP updater payload, and Linux AppImage/DEB packages.
2. Every packaged app contains the Ed25519 public update key and its immutable update origin. The private key exists only as a protected GitHub Actions secret.
3. A final release job downloads all three platform jobs, flattens one coherent channel, validates every `latest*.yml` reference, signs `update-manifest.json` with the staged-rollout policy, and verifies every artifact before publication.
4. Payloads are uploaded first to both `releases/<version>/` and `stable/` with create-only generation preconditions. Mutable channel metadata is uploaded in dependency order with the signed manifest last and `Cache-Control: no-store`, so clients never accept metadata for a missing installer.
5. The app verifies the signed JSON against its embedded key before allowing `electron-updater` to check or download. It then verifies the downloaded file's size and SHA-256 independently of electron-updater's SHA-512 and platform signature checks.

The update bucket intentionally serves public, read-only release objects. Application access is still license-gated. Never embed a Google credential, service-account key, signing private key, or signed URL generator in the desktop app.

## One-time Google Cloud setup

Choose globally unique values before running these commands:

```bash
PROJECT_ID="your-production-project"
UPDATE_BUCKET="your-production-automnia-updates"
REGION="us-east1"
PUBLISHER="automnia-update-publisher"
GITHUB_REPOSITORY="owner/Automnia-AI-Nexus"
```

Create a uniformly controlled, versioned release bucket and a least-purpose publisher identity:

```bash
gcloud services enable storage.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$PROJECT_ID"
gcloud storage buckets create "gs://$UPDATE_BUCKET" --project="$PROJECT_ID" --location="$REGION" --uniform-bucket-level-access
gcloud storage buckets update "gs://$UPDATE_BUCKET" --versioning
gcloud storage buckets add-iam-policy-binding "gs://$UPDATE_BUCKET" --member="allUsers" --role="roles/storage.objectViewer"
gcloud iam service-accounts create "$PUBLISHER" --project="$PROJECT_ID" --display-name="Automnia update publisher"
gcloud storage buckets add-iam-policy-binding "gs://$UPDATE_BUCKET" --member="serviceAccount:$PUBLISHER@$PROJECT_ID.iam.gserviceaccount.com" --role="roles/storage.objectAdmin"
```

Use Google Workload Identity Federation for GitHub Actions rather than a long-lived service-account JSON key. Restrict the provider's attribute condition to the exact repository and, preferably, tag refs. Grant the resulting repository principal `roles/iam.workloadIdentityUser` on only the publisher service account.

The direct production origin can be:

```text
https://storage.googleapis.com/<UPDATE_BUCKET>/stable
```

Cloud CDN and `updates.automnia.app` can be placed in front later. Keep the path ending in `/stable`, preserve HTTPS, and ensure redirects remain on the same origin because the app rejects cross-origin update redirects.

## Required GitHub configuration

Protected secrets:

- `AUTOMNIA_UPDATE_SIGNING_PRIVATE_KEY_PEM`: Ed25519 PKCS#8 private key.
- `GCP_UPDATE_WORKLOAD_IDENTITY_PROVIDER`: full Workload Identity provider resource name.
- `GCP_UPDATE_PUBLISHER_SERVICE_ACCOUNT`: publisher service-account email.
- Existing Windows and Apple platform-signing secrets required by `public-release.yml`.

Repository/environment variables:

- `AUTOMNIA_UPDATE_BASE_URL`: the HTTPS `/stable` origin embedded in every build.
- `AUTOMNIA_UPDATE_BUCKET`: bucket name without `gs://`.
- `AUTOMNIA_UPDATE_SIGNING_KEY_ID`: stable operational key label.
- `AUTOMNIA_UPDATE_ROLLOUT_PERCENTAGE`: `5`, `25`, or `100`; defaults to `100`.
- `AUTOMNIA_UPDATE_MINIMUM_VERSION`: oldest version allowed to defer the release. Leave blank for no minimum-version mandate.
- `AUTOMNIA_UPDATE_MANDATORY_AFTER`: optional ISO-8601 deadline after which the release cannot be deferred.

Generate the signing key once on a secured operator machine and store the private value only in the protected secret:

```bash
openssl genpkey -algorithm ED25519 -out automnia-update-private.pem
openssl pkey -in automnia-update-private.pem -pubout -out automnia-update-public.pem
```

The workflow derives and embeds the public key. Keep the offline private-key backup encrypted. Key rotation requires a bridge release containing both old-authorized release metadata and the next public key; do not replace the key abruptly or installed clients will correctly reject every future update.

## Release procedure

1. Bump `package.json` to a strictly higher semantic version and update `CHANGELOG.md`.
2. Set rollout to `5` for the first production cohort.
3. Push a protected `v<version>` tag. All platform jobs and lifecycle tests must pass before `publish-updates` can run.
4. Verify the release URL, Windows/macOS signatures, update manifest signature, and one installed upgrade on each platform.
5. Increase rollout to `25`, then `100`, with the protected **Promote Desktop Update Rollout** workflow after crash/startup health review. Promotion signs new policy metadata around the existing immutable installers; it never rebuilds them.
6. Never mutate an artifact filename already released. Publish a new higher patch version for a correction or rollback build.

## Twenty-plus production failure cases handled

| Problem | Production behavior |
| --- | --- |
| 1. User is offline | Background failures stay non-blocking and retry with bounded 5-minute, 15-minute, 1-hour, then 6-hour backoff; manual checks explain the outage. |
| 2. DNS/TLS interception | Only credential-free HTTPS origins are accepted outside explicit localhost development. |
| 3. Redirect to another host | Manifest fetches reject cross-origin redirects and stop after three hops. |
| 4. Forged manifest | The app requires an Ed25519 signature matching the public key embedded at build time. |
| 5. Private key accidentally shipped | Build output contains only the derived public key; release validation rejects private-key material. |
| 6. Tampered installer | Size and SHA-256 are checked after download, in addition to updater SHA-512 and OS code signing. |
| 7. Wrong CPU or OS package | The signed manifest is filtered by platform and architecture before updater metadata is consulted. |
| 8. macOS has only a DMG | Packaging also emits the signed ZIP payload required by the macOS updater. |
| 9. Linux DEB needs elevation | DEB installs present an honest manual-package path; AppImage installs remain automatic. |
| 10. Partial or interrupted download | electron-updater's cache/differential path resumes safely; install is unavailable until final verification passes. |
| 11. Disk fills during update | A free-space preflight reserves at least twice the payload or payload plus 256 MB. |
| 12. CDN serves stale metadata | Versioned payloads are immutable; channel metadata is `no-store`, published in dependency order, and transient mismatches retry with backoff. |
| 13. Release metadata references a missing file | Channel staging parses every `latest*.yml` reference and fails before upload. |
| 14. Two checks run concurrently | Check and download operations are single-flight and duplicate triggers share the active operation. |
| 15. Update prompt interrupts work | Downloads happen in the background and restart requires an explicit user action. |
| 16. Prompt fatigue | Optional updates can be deferred for 24 hours, up to a bounded seven-day policy internally. |
| 17. Critical unsupported version | `minimumVersion` and `mandatoryAfter` remove deferral while still letting the user finish current work. |
| 18. Child processes lock installed files | The OpenClaw gateway, control server, and app-owned helpers are shut down before the installer starts. |
| 19. Windows shutdown kills NSIS mid-install | Automnia disables install-on-quit and starts replacement only from “Restart and update.” |
| 20. Update attempt does not complete | A pending-update marker detects the old version on relaunch, keeps it usable, and offers a deliberate retry. |
| 21. Bad local updater preferences | Preferences are schema-checked, repaired to safe defaults, and written atomically. |
| 22. Accidental downgrade/replay | Versions are compared as SemVer and updater downgrades are disabled. |
| 23. Bad release reaches a cohort | Deterministic staged rollout keeps each installation consistently inside or outside the cohort. |
| 24. Update fails after publication | Immutable previous releases remain in GCS; ship a higher hotfix version and stop rollout of the bad release. |
| 25. Window closes during restart | Focus listeners retain a safe `WebContents` reference and detach without touching a destroyed `BrowserWindow`. |

## Operational rollback

Do not point clients at a numerically lower version: downgrade protection should remain enabled. If a release is bad, set its rollout to `0` before broad adoption, fix the defect, increment the patch version, and publish the replacement. Existing users stay on their current working version until the replacement is signed and available.

Monitor update checks, download failures, startup health, application version adoption, and crash-free sessions by version. The local diagnostic ledger records sanitized updater lifecycle events without URLs, credentials, or private signing material.
