# Changelog

## 1.0.17 - 2026-09-16

### Windows lifecycle reliability

- Treats a race while removing the temporary lifecycle directory as a cleanup warning instead of failing an otherwise complete installer, integrity, rollback, and uninstall validation.

## 1.0.16 - 2026-09-16

### Update channel publication

- Keeps electron-builder debug metadata out of the public update channel so immutable stable payloads can be published repeatedly without conflicting with a prior release.

## 1.0.15 - 2026-09-16

### Update artifact selection

- Correctly identifies `x86_64` Linux AppImage filenames as `x64`, allowing the signed updater to select the published Linux artifact on x64 installations.

## 1.0.14 - 2026-09-16

### Release publication

- Disables Google Cloud parallel composite uploads for the least-privilege GitHub Actions publisher, preventing large-artifact publication from requiring temporary-object deletion permissions.

## 1.0.13 - 2026-09-16

### Windows installer lifecycle

- Prevents the silent NSIS installer from launching the application after installation, so automated fresh-install and upgrade checks can observe a deterministic installer exit before launching the packaged app under test.
- Replaces the hanging same-version NSIS repair fallback with an explicit silent uninstall and clean reinstall.
- Uses the deterministic NSIS install-root executable path instead of recursively scanning the bundled runtime after installation.
- Waits only for missing packaged payload files instead of sleeping through the full readiness timeout when they are already present.
- Captures the expected checksum-mismatch stderr during tamper testing so the lifecycle can verify rejection instead of treating it as an unhandled PowerShell error.
- Handles zero-argument packaged launches without passing an invalid empty argument collection to PowerShell `Start-Process`.
- Waits for the branded Windows launcher’s child Electron process to write its bounded E2E completion marker before validating packaged launch evidence.
- Waits for the installed executable, UI, and bundled API server payload to be visible before starting the packaged-app smoke check.
- Clears each packaged-launch evidence file before starting a new child process, preventing stale E2E markers from satisfying a later lifecycle attempt.

## 1.0.12 - 2026-09-16

### Electron shutdown ownership

- Keeps Chromium-managed renderer, GPU, utility, zygote, and crashpad processes out of Automnia helper cleanup so Linux desktop shutdown can complete without triggering a GPU-process restart.

## 1.0.11 - 2026-09-16

### Hosted Linux Electron stability

- Disables hardware acceleration only for the hosted Linux Electron E2E process, preventing Xvfb GPU-process shutdown failures while leaving normal packaged desktop rendering unchanged.

## 1.0.10 - 2026-09-16

### Bounded Linux renderer replacement

- Recreates the desktop window once when Linux Electron reports an unresponsive renderer and the documented reload path does not produce a new renderer process, while retaining the existing bounded reload fallback on other platforms.

## 1.0.9 - 2026-09-16

### Targeted Linux renderer recovery validation

- Limits the Linux software-rendering Electron flag to the intentional renderer-recovery probe, keeping the normal startup, tray, and renderer-journey smoke cases on their standard Linux path.

## 1.0.8 - 2026-09-16

### Linux renderer smoke stability

- Runs the Linux Electron recovery smoke with Chromium's GPU path disabled in hosted CI so the intentional renderer-recovery probe exercises a deterministic software-rendered process lifecycle.

## 1.0.7 - 2026-09-16

### Renderer recovery timing

- Reloaded immediately from Electron's `unresponsive` event before the bounded load retry, allowing Linux Chromium runners to recover the renderer after the intentional crash probe.

## 1.0.6 - 2026-09-16

### Cross-platform renderer recovery

- Added a bounded reload/load retry when Electron reports an unresponsive renderer, covering Linux environments that do not emit `render-process-gone` for the intentional recovery probe.

## 1.0.5 - 2026-09-16

### Electron recovery validation

- Reloaded immediately after the intentional renderer-crash probe so Linux CI exercises the documented fresh-renderer recovery path without timing out.

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
