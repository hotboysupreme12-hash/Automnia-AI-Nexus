# Changelog

## Unreleased production-readiness package

### Beta status

- Marked this package as a private beta / early access candidate, not an unattended production system.
- Added the beta support runbook covering Gateway recovery, local state reset, safe logs, local data boundaries, network exposure warnings, supported OS expectations, and feedback collection.
- Documented that the primary packaged beta support target is Windows 11 x64, with Windows 10 22H2 x64 best effort. macOS and Linux are source/developer-validation paths unless a specific beta build says otherwise.

### Known issues

- Private beta builds may be unsigned or distributed outside the final public release channel, so operating systems may show trust or installer warnings.
- Gateway, plugin, and channel state can occasionally need manual `Reset gateway`, `Clean Slate`, or app restart recovery after provider auth changes, plugin setup changes, or interrupted runs.
- Provider OAuth sessions, API keys, quotas, and channel credentials can expire independently of DystopAI and may require reconnecting before retrying work.
- State backups skip symlinked plugin-skill entries and record them in the manifest instead of following the link target.
- Public release signing, public auto-update, paid distribution, multi-user cloud auth, and LAN/public control-plane exposure remain outside this beta milestone.
- The local Control Plane API and OpenClaw Gateway must remain loopback-only. Do not expose them to a LAN or the public internet.
- Beta feedback should use the GitHub issue template: https://github.com/hotboysupreme12-hash/DystopAI-Core/issues/new?template=beta_feedback.yml

### Security

- Added bounded failed-login throttling and lockout responses.
- Kept the Electron launch secret in the main process and replaced raw-token IPC with server-session bootstrap.
- Moved renderer bearer persistence from local storage to session storage with legacy-token cleanup.
- Bound every OAuth callback server explicitly to loopback.
- Added trusted-host, HTTPS, atomic-download, and SHA-256 verification for emergency Node runtime provisioning.
- Added release-manifest path containment and exact installer/update evidence verification.

### Reliability and recovery

- Upgraded the vendored OpenCLAW runtime and bundled Codex plugin to `2026.6.11`.
- Preserved OpenCLAW 2026.6.11 official external plugin/provider/channel catalogs in fallback plugin discovery.
- Surfaced plugin icon, package, install spec, and channel image metadata through runtime status and the Plugins panel.
- Added checksummed OpenClaw state backup, verification, atomic restore, and rollback retention.
- State backup manifests now record skipped symlink entries so realistic plugin-skill junctions do not abort beta backup verification.
- Added API soak qualification and behavioral unit tests.
- Preserved installer lifecycle logs inside signed release evidence.

### Release engineering

- Added a signed Windows release qualification workflow.
- Added Authenticode verification, fresh install, upgrade, rollback, uninstall, and corrupted-installer tests.
- Added an Ed25519-signed manual-download update manifest.
- Added full distribution evidence validation and checksum coverage for pre-signing evidence.
- Pinned GitHub Actions to immutable commit SHAs and added macOS source/build validation.
- Added generated third-party notices, a license-review checkpoint, and a data-handling notice to packaged resources.
