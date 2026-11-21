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

Manual `workflow_dispatch` runs produce unsigned candidates for CI installation checks and never publish customer downloads. Version-tagged releases ordinarily fail before packaging unless Windows Authenticode credentials and macOS Developer ID plus Apple notarization credentials are present. The v1.0.28, v1.0.29, and v1.0.30 releases each have a separate guarded exception enabled only for the matching tag by `AUTOMNIA_ALLOW_UNSIGNED_V1_0_28=true`, `AUTOMNIA_ALLOW_UNSIGNED_V1_0_29=true`, or `AUTOMNIA_ALLOW_UNSIGNED_V1_0_30=true`, respectively. Those exceptions skip platform signing and platform-signature evidence checks for their installers. The updater manifest remains signed with `AUTOMNIA_UPDATE_REQUIRE_SIGNING=1`; later tags continue to require platform signatures. See [Installer Support](INSTALLER_SUPPORT.md) for the tested architectures and OS requirements.

## Release Signing

Tagged releases set `AUTOMNIA_RELEASE_REQUIRE_SIGNING=1` so `distribution-signing.json` is required by release validation. The guarded v1.0.28, v1.0.29, and v1.0.30 exceptions set it to `0` only for their matching tags when the corresponding repository variable is enabled. Use `npm run release:sign` with `AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_FILE` or `AUTOMNIA_RELEASE_SIGNING_PRIVATE_KEY_PEM` when checksum evidence signing is enabled. The separate update-channel signing key remains required for every published update channel.

Configure these repository Actions secrets before tagging a customer release:

- `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` for the Windows signing certificate.
- `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` for the Developer ID Application certificate.
- `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` for notarization. `APPLE_TEAM_ID` is also passed to the Mac build.

Automnia AI remains a local desktop app with a localhost API only; do not treat localhost release evidence as proof for an internet-exposed control plane.

## Documentation set

Keep the public docs focused on these files:

- `README.md`
- `docs/USER_GUIDE.md`
- `docs/BETA_SUPPORT.md`
- `docs/BETA_RELEASE_NOTES.md`
- `docs/CI_EVIDENCE.md`
- `docs/INSTALLER_SUPPORT.md`
- `DATA_HANDLING.md`
- `SECURITY.md`
- `docs/RELEASE_GOVERNANCE.md`

## Visual baseline

When visual review is needed, use the optional packaged screenshot capture for Agents, Missions, Monitor, Plugins, Settings, and Agent Editor as the baseline for the reviewed build. Run it explicitly with `npm run capture:packaged-beta-screenshots` after packaging.
