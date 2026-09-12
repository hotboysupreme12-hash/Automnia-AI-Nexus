# Shopify installer delivery

Automnia delivers installers through the existing Shopify provisioner on Cloud
Run. Shopify is the source of truth for purchase and subscription events;
Cloud Run is the entitlement gate; the installer bucket is private at all
times.

## Customer experience

1. A customer completes a paid Shopify order.
2. The signed `orders/paid` webhook provisions (or updates) their Automnia
   entitlement and emails the welcome message.
3. The message contains a durable, unguessable `/download` link. It is not a
   Cloud Storage URL and does not have a ten-minute expiry.
4. The page checks the configured GCS object paths and only renders installers
   whose objects actually exist. If multiple platforms are published, it
   highlights the installer appropriate to Windows, macOS, or Linux while
   keeping the other published installers available for manual selection.
5. Clicking an installer checks the entitlement again and issues a fresh
   ten-minute GCS V4 signed URL. The browser is then redirected to the file.

If a customer returns tomorrow, they use the same portal link and receive a
new short-lived installer URL. A cancelled, failed, or revoked subscription
does not receive a new URL. Permanent/BYOK entitlements remain eligible.

## One-time deployment

`infra/gcloud/deploy.ps1` now creates the installer bucket (default:
`PROJECT_ID-automnia-installers`) if needed and enforces uniform bucket access
plus public-access prevention. It gives only the Cloud Run runtime identity
read access to that bucket and permission to sign URLs as itself. Run the
normal deployment from a PowerShell environment with the required project
permissions:

```powershell
.\infra\gcloud\deploy.ps1 -ProjectId YOUR_PROJECT_ID -RouteImmediately
```

The deployment passes these settings from `infra/gcloud/config.psd1` to Cloud
Run. Change the values there before deploying if you want versioned object
names or a separately managed bucket:

| Platform | Default private object |
| --- | --- |
| Windows x64 | `releases/current/windows/Automnia-Setup-x64.exe` |
| macOS Apple silicon | `releases/current/macos/Automnia-AI-Nexus-arm64.dmg` |
| macOS Intel | `releases/current/macos/Automnia-AI-Nexus-x64.dmg` |
| Linux x64 AppImage | `releases/current/linux/Automnia-AI-Nexus-x86_64.AppImage` |
| Linux x64 Debian package | `releases/current/linux/Automnia-AI-Nexus-x86_64.deb` |

After deployment, confirm `GET https://api.automnia.app/health` reports
`commerce.installerPortalConfigured: true` and the expected installer
platform configuration. It does not replace an object listing; the download
page performs the live GCS existence checks before showing a platform.

The current bucket publication includes both macOS Apple silicon and macOS
Intel DMGs. The portal therefore shows both to eligible customers; Windows and
Linux remain hidden until their corresponding stable objects are uploaded.

## Build and publish installers

Build each platform on that platform (or in trusted CI). On an Apple-silicon
Mac, this creates the M-series DMG:

```bash
npm ci
npm run dist:mac -- --arm64
```

The packaged file is expected under `release/` and is named from the app
version, for example `Automnia AI Nexus-0.0.6-arm64.dmg`. Rename/copy it only
at upload time; the bucket object name stays stable. This project deliberately
does not sign or notarize the package in this flow.

Upload a release only after it has been locally tested. Replace each stable
object atomically by uploading to the configured exact destination:

```bash
gcloud storage cp "release/Automnia AI Nexus-0.0.6-arm64.dmg" \
  "gs://YOUR_PROJECT_ID-automnia-installers/releases/current/macos/Automnia-AI-Nexus-arm64.dmg"
gcloud storage cp "PATH/Automnia-Setup-x64.exe" \
  "gs://YOUR_PROJECT_ID-automnia-installers/releases/current/windows/Automnia-Setup-x64.exe"
gcloud storage cp "PATH/Automnia-AI-Nexus-x86_64.AppImage" \
  "gs://YOUR_PROJECT_ID-automnia-installers/releases/current/linux/Automnia-AI-Nexus-x86_64.AppImage"
gcloud storage cp "PATH/Automnia-AI-Nexus-x86_64.deb" \
  "gs://YOUR_PROJECT_ID-automnia-installers/releases/current/linux/Automnia-AI-Nexus-x86_64.deb"
```

For the current macOS releases in this repository, the stable uploads are:

```bash
gcloud storage cp "release/Automnia AI Nexus-0.0.6-arm64.dmg" \
  "gs://YOUR_PROJECT_ID-automnia-installers/releases/current/macos/Automnia-AI-Nexus-arm64.dmg"
gcloud storage cp "release/Automnia AI Nexus-0.0.6-x64.dmg" \
  "gs://YOUR_PROJECT_ID-automnia-installers/releases/current/macos/Automnia-AI-Nexus-x64.dmg"
```

Verify the bucket remains private and that the uploaded object matches the
local artifact before testing the portal:

```bash
gcloud storage buckets describe "gs://YOUR_PROJECT_ID-automnia-installers" \
  --format="json(public_access_prevention,uniform_bucket_level_access)"
gcloud storage ls -l "gs://YOUR_PROJECT_ID-automnia-installers/releases/current/**"
```

Do not grant `allUsers` or `allAuthenticatedUsers` access to this bucket, and
do not email a `storage.googleapis.com` URL directly. The Cloud Run route
checks that the object exists before redirecting. If an object has not been
uploaded, customers see a retryable publishing message rather than a broken
download.

## Shopify configuration

Deploy `infra/gcloud/shopify.app.toml.template` from the private Shopify app
project. It already includes the payment, refund, cancellation, subscription
contract, and subscription-billing topics used by the provisioner. Map every
sellable subscription variant or SKU in
`infra/gcloud/shopify-plan-mappings.json`; an unmapped paid product fails
closed and grants no access.

The Google Cloud project's `SHOPIFY_WEBHOOK_SECRETS` secret must exactly match
the active Shopify app's client secret(s). Test using a Shopify test order,
then open the received **Download Automnia** link on a Mac, Windows, and Linux
browser. The page must load, the relevant installer must be visible, and the
download click must redirect to a GCS URL that expires after the configured
ten minutes.

## Operations and recovery

- A download page token is a bearer credential. Treat the welcome email like a
  password; the entitlement's protected Firestore record contains the portal
  link and a token verifier. Do not put either in support tickets or public
  logs.
- Existing customers provisioned before this feature have no download token.
  They receive the desktop installer through support once, or can be migrated
  with a one-time token-reset job before the feature is announced.
- If a customer loses the email, issue a new portal token through a future
  authenticated customer-account download screen; do not send a static GCS
  link.
- The provisioner returns a retryable 503 if Firestore, Cloud Storage, or IAM
  signing is unavailable. Shopify retries failed webhooks, while customers can
  simply revisit the durable portal link after recovery.

## Release checklist

1. Build and run the platform-specific installer locally.
2. Upload all intended files to the exact configured GCS object paths.
3. Confirm the bucket has public access prevention and no public IAM members.
4. Check `/health` for portal configuration.
5. Complete a Shopify test subscription; confirm the email shows **Download
   Automnia**.
6. Open that link. Confirm the page lists only objects currently present in
   GCS, download an installer, then wait beyond the signed-link duration and
   use the portal link again to confirm a fresh URL is issued.
7. Cancel the test subscription and confirm a new installer redirect is denied.
