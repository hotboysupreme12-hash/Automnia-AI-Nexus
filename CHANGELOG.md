# Changelog

## 1.0.4 - 2026-09-16

### Release validation and product metadata

- Updated the desktop package description to present Automnia AI Nexus as an AI workspace and operations console powered by a secure OpenClaw runtime.
- Made unsigned macOS packaging fail cleanly without treating empty signing environment variables as certificate paths.
- Made Linux Electron end-to-end verification compatible with hosted CI sandbox permissions.
- Made Windows lifecycle validation follow the configured product executable name instead of assuming `Automnia.exe`.

## 1.0.3 - 2026-09-16

### Release verification

- Seeded the API soak server with an isolated active BYOK fixture so authenticated projection requests exercise the API instead of the license-required boundary.

## 1.0.2 - 2026-09-16

### Release verification

- Corrected the provider-first exhausted-credit release test fixture so clean CI checkouts exercise the intended route.

## 1.0.1 - 2026-09-16

### Desktop updates

- Enabled the Google Cloud Storage update channel for the first public release.
- Added unsigned early-distribution packaging for Windows and macOS while retaining signed update manifests and GitHub OIDC publication.
- Added packaged archive verification for the embedded update configuration and public verification key.

## Unreleased production-readiness package

### Beta status

- Marked Automnia AI as a public beta candidate, not an unattended production system.
- Added the beta support runbook covering Gateway recovery, local state reset, safe logs, local data boundaries, network exposure warnings, supported OS expectations, and feedback collection.
- Documented that the primary packaged beta support target is Windows 11 x64, with Windows 10 22H2 x64 best effort. macOS and Linux are source/developer-validation paths unless a specific beta build says otherwise.

### Known issues

- Beta builds may be unsigned or distributed outside the final public release channel, so operating systems may show trust or installer warnings.
- Gateway, plugin, and channel state can occasionally need manual `Reset gateway`, `Clean Slate`, or app restart recovery after provider setup changes, plugin setup changes, or interrupted runs.
- Provider sessions, quotas, and channel setup values can expire independently of Automnia AI and may require reconnecting before retrying work.
- State backups skip symlinked plugin-skill entries and record them in the manifest instead of following the link target.
- Public release signing, public auto-update, paid distribution, multi-user cloud auth, and LAN/public control-plane exposure remain outside this beta milestone.
- The local Control Plane API and OpenClaw Gateway must remain loopback-only.
- Beta feedback should use the GitHub issue template: https://github.com/hotboysupreme12-hash/Automnia-AI-Nexus/issues/new?template=beta_feedback.yml

### Security

- Added bounded failed-login throttling and lockout responses.
- Kept the Electron launch secret in the main process and replaced raw-token IPC with server-session bootstrap.
- Moved renderer bearer persistence from local storage to session storage with legacy-token cleanup.
- Bound every OAuth callback server explicitly to loopback.
- Added trusted-host, HTTPS, atomic-download, and SHA-256 verification for emergency Node runtime provisioning.
- Added release-manifest path containment and exact installer/update evidence verification.

### Reliability and recovery

- Upgraded the vendored OpenClaw runtime to `2026.9.2` so config and state schema support stay aligned with the current Automnia integration.
- Preserved the current OpenClaw official external plugin/provider/channel catalogs in fallback plugin discovery.
- Surfaced plugin icon, package, install spec, and channel image metadata through runtime status and the Plugins panel.
- Added checksummed OpenClaw state backup, verification, atomic restore, and rollback retention.
- State backup manifests now record skipped symlink entries so realistic plugin-skill junctions do not abort beta backup verification.
- Added API soak qualification and behavioral unit tests.
- Preserved installer lifecycle logs inside signed release evidence.

### Release engineering

- Added a signed Windows release qualification workflow.
- Added platform verification, fresh install, upgrade, rollback, uninstall, and corrupted-installer tests.
- Added a signed manual-download update manifest path.
- Added full distribution evidence validation and checksum coverage for pre-signing evidence.
- Pinned GitHub Actions to immutable commit SHAs and added macOS source/build validation.
- Added generated third-party notices, a license-review checkpoint, and a data-handling notice to packaged resources.
