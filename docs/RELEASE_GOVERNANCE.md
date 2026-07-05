# Automnia AI Release Governance

Automnia AI is stable for Windows, macOS, and Linux.

## Validation record

Release records should point to the hosted validation run, the package artifact, the screenshot artifact, and the release notes for the build.

## Branch Protection

Treat `main` as release-controlled even during fast iteration. Routine release work should use pull requests or a deliberate admin merge, and the required hosted check is `Control Plane CI / Hardened control plane`.

## Beta-Ready Release Gate

Do not call a build public-beta ready until hosted `Control Plane CI / Hardened control plane` has passed on the exact commit being evaluated.

The evaluated commit should include these hosted artifacts:

- `automnia-release-evidence`
- `automnia-packaged-beta-screenshots`
- `automnia-windows-installer-candidate`

Local tests are useful developer evidence, but they do not replace hosted packaging, packaged launch, release validation, screenshot capture, and artifact upload.

## Release Signing

Public release validation must fail closed when `AUTOMNIA_RELEASE_REQUIRE_SIGNING=1`. Use `npm run release:sign` with `AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_FILE` or `AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_PEM` before publishing.

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

Use the packaged screenshots for Agents, Missions, Monitor, Plugins, Settings, and Agent Editor as the visual baseline for each reviewed build.
