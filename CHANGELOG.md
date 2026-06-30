# Changelog

## Unreleased production-readiness package

### Security

- Added bounded failed-login throttling and lockout responses.
- Kept the Electron launch secret in the main process and replaced raw-token IPC with server-session bootstrap.
- Moved renderer bearer persistence from local storage to session storage with legacy-token cleanup.
- Bound every OAuth callback server explicitly to loopback.
- Added trusted-host, HTTPS, atomic-download, and SHA-256 verification for emergency Node runtime provisioning.
- Added release-manifest path containment and exact installer/update evidence verification.

### Reliability and recovery

- Added checksummed OpenClaw state backup, verification, atomic restore, and rollback retention.
- Added API soak qualification and behavioral unit tests.
- Preserved installer lifecycle logs inside signed release evidence.

### Release engineering

- Added a signed Windows release qualification workflow.
- Added Authenticode verification, fresh install, upgrade, rollback, uninstall, and corrupted-installer tests.
- Added an Ed25519-signed manual-download update manifest.
- Added full distribution evidence validation and checksum coverage for pre-signing evidence.
- Pinned GitHub Actions to immutable commit SHAs and added macOS source/build validation.
- Added generated third-party notices, a license-review checkpoint, and a data-handling notice to packaged resources.
