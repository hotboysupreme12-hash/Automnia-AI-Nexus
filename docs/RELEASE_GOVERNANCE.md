# Automnia AI Release Governance

Automnia AI is stable for Windows, macOS, and Linux.

## Validation record

Release records should point to the hosted validation run, the package artifact, and the release notes for the build. Packaged screenshots are optional visual-review evidence and are not a blocking CI requirement.

## Branch Protection

Treat `main` as release-controlled even during fast iteration. Routine release work should use pull requests or a deliberate admin merge, and the required hosted check is `Control Plane CI / Hardened control plane`.

## Beta-Ready Release Gate

Do not call a build public-beta ready until hosted `Control Plane CI / Hardened control plane` has passed on the exact commit being evaluated.

The evaluated commit should include these hosted artifacts:

- `automnia-release-evidence`
- `automnia-windows-installer-candidate`

Local tests are useful developer evidence, but they do not replace hosted packaging, packaged launch, release validation, and artifact upload.

## Early Platform Distribution

Until platform-signing certificates are available, the tag-triggered public workflow may publish unsigned Windows and macOS packages. It uses `AUTOMNIA_SKIP_PLATFORM_SIGNING=1` and `AUTOMNIA_RELEASE_REQUIRE_SIGNING=0`, while keeping `AUTOMNIA_UPDATE_REQUIRE_SIGNING=1` so update metadata and payload selection remain cryptographically protected. Windows SmartScreen and macOS Gatekeeper warnings are expected for these packages.

## Release Signing

`AUTOMNIA_RELEASE_REQUIRE_SIGNING=1` remains available for the later signed-release phase. Use `npm run release:sign` with `AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_FILE` or `AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_PEM` when checksum evidence signing is enabled. The separate update-channel signing key remains required for every published update channel.

Automnia AI remains a local desktop app with a localhost API only; do not treat localhost release evidence as proof for an internet-exposed control plane.

## Documentation set

Keep the public docs focused on these files:

- `README.md`
- `docs/USER_GUIDE.md`
- `docs/BETA_SUPPORT.md`
- `docs/BETA_RELEASE_NOTES.md`
- `docs/CI_EVIDENCE.md`
- `DATA_HANDLING.md`
- `SECURITY.md`
- `docs/RELEASE_GOVERNANCE.md`

## Visual baseline

When visual review is needed, use the optional packaged screenshot capture for Agents, Missions, Monitor, Plugins, Settings, and Agent Editor as the baseline for the reviewed build. Run it explicitly with `npm run capture:packaged-beta-screenshots` after packaging.
