# Release Governance

DystopAI Core is released as a local-first desktop operator console. Public release controls are intentionally stricter than ordinary pull-request validation because release evidence is what operators use to trust packaged artifacts after download.

## Branch Protection

Protect `main` in the repository settings before treating a build as release eligible:

- Require pull requests before merging and block direct pushes to `main`.
- Require the `Control Plane CI / Hardened control plane` check to pass before merge.
- Require at least one approving review, and dismiss stale approvals when new commits are pushed.
- Require signed commits where the repository and contributor setup can support it. If signed commits are not enforceable yet, require signed version tags and signed release evidence before publishing.
- Keep administrator bypass disabled for routine release work. Emergency bypasses should leave an issue or incident note with the release SHA and reason.

These settings are governance requirements. The repository can document and smoke-test their expected names, but GitHub branch protection itself must be enforced in GitHub settings or the GitHub API by a repository administrator.

## Beta-Ready Release Gate

Do not apply a beta-ready label, publish a beta handoff, or call a build public-beta ready until the `Control Plane CI / Hardened control plane` check has passed on the exact commit being evaluated. A local `npm test` pass is useful developer evidence, but it does not replace the hosted Control Plane CI gate because beta readiness depends on the Windows packaging, packaged launch, release evidence, and artifact upload path running in GitHub Actions.

The Control Plane CI artifact set for the evaluated commit must include:

- `dystopai-release-evidence`, including release SBOM/checksum evidence plus `release/evidence/ci-logs/npm-test.log`, `release/evidence/ci-logs/unit-coverage.log`, `release/evidence/bundle-budgets/renderer-bundle-budgets.log`, `release/evidence/ci-logs/packaged-electron-launch.log`, `release/evidence/ci-logs/packaged-beta-screenshots.log`, and `release/evidence/ci-logs/release-validate.log`;
- `dystopai-packaged-beta-screenshots`, containing the packaged-production screenshot manifest and PNG set from `npm run capture:packaged-beta-screenshots`;
- when the run is not a pull request and unsigned beta packaging is allowed, `dystopai-windows-installer-candidate`.

If any artifact upload is missing, empty, or generated from a different commit, the release remains a beta candidate only. Record the green workflow URL, commit SHA, and artifact names in `docs/CI_EVIDENCE.md` only after the hosted run exists.

## Beta Screenshot Visual Freeze

After the packaged beta screenshot artifact exists for the evaluated commit, treat the captured Agents, Missions, Monitor, Plugins, Settings, and Agent Editor screens as the public beta visual baseline. Do not accept cosmetic redesigns, layout churn, palette changes, animation changes, or selector-only UI rewrites on those surfaces before the public beta cut.

Allowed post-baseline UI changes are limited to accessibility fixes, readability fixes, broken-state corrections, screenshot-capture repairs, and clear regressions found during release qualification. Any allowed change must rerun `npm run capture:packaged-beta-screenshots`, keep all 18 packaged screenshots present, and record the reason in the release handoff or ledger.

## Public Release Signing

Public release validation must fail closed when signing evidence is absent. A public release is qualified by the dedicated `Public Release Candidate` workflow on a `v*` tag or a manual `workflow_dispatch` run. The workflow sets `DYSTOPAI_RELEASE_REQUIRE_SIGNING=true`; local validation can enforce the same policy explicitly.

The required evidence files are:

- `release/evidence/dystopai-sbom.cdx.json`
- `release/evidence/checksums.sha256`
- `release/evidence/release-evidence.json`
- `release/evidence/checksums.sha256.sig`
- `release/evidence/signing-public-key.pem`
- `release/evidence/release-signing.json`
- `release/evidence/distribution-signing.json`
- `release/updates/update-manifest.json`
- `release/updates/update-manifest.json.sig`
- `release/updates/update-manifest-public-key.pem`
- `release/updates/update-signing.json`

The Ed25519 signature signs the checksum manifest. It is necessary release evidence, but it does not replace operating-system distribution trust. Public consumer builds must also include platform distribution evidence:

- Windows: an NSIS/MSI/MSIX/AppX installer signed with Authenticode, verified with a timestamped signature.
- macOS: Developer ID signing, notarization, and stapling for macOS artifacts before publication.
- Updates: a signed update manifest/channel plus rollback evidence.
- Lifecycle tests: fresh install, upgrade, uninstall, and corrupted-update rollback tests.

Create `release/evidence/distribution-signing.json` after platform signing and lifecycle tests, before `npm run release:evidence`. Release evidence generation includes that file in `checksums.sha256`, and `npm run release:validate` rejects public builds when it is missing or not covered by the signed checksum manifest.

Minimum Windows public-release manifest:

```json
{
  "schema": 1,
  "generatedAt": "2026-06-25T00:00:00.000Z",
  "artifacts": [
    {
      "platform": "windows",
      "artifact": "release/DystopAI Setup 0.0.6.exe",
      "signing": {
        "type": "authenticode",
        "status": "verified",
        "signer": "DystopAI",
        "thumbprint": "certificate-thumbprint",
        "timestamp": "2026-06-25T00:00:00.000Z",
        "verificationCommand": "signtool verify /pa /tw \"release/DystopAI Setup 0.0.6.exe\""
      }
    }
  ],
  "updateChannel": {
    "signed": true,
    "rollbackTested": true,
    "verificationCommand": "verify signed update manifest and rollback path"
  },
  "installTests": {
    "freshInstall": { "status": "passed", "evidence": "fresh-install log or artifact reference" },
    "upgrade": { "status": "passed", "evidence": "upgrade log or artifact reference" },
    "uninstall": { "status": "passed", "evidence": "uninstall log or artifact reference" },
    "corruptedUpdate": { "status": "passed", "evidence": "corrupted-update rollback log or artifact reference" }
  }
}
```

Local release validation can enforce the same policy:

```bash
npm run dist:win
# Write release/evidence/distribution-signing.json from Authenticode/update/install evidence.
npm run release:evidence
DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE="C:/secure/dystopai-release-ed25519.pem" npm run release:sign
DYSTOPAI_RELEASE_REQUIRE_SIGNING=1 npm run release:validate
```

In GitHub Actions, configure the Windows or Apple platform-signing credentials plus `DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM` and `DYSTOPAI_UPDATE_SIGNING_PRIVATE_KEY_PEM` as secrets. Configure key IDs as repository variables. Each signing key must be Ed25519 and must never be committed to the repository.

The exact release sequence and stop conditions are documented in [`PRODUCTION_RELEASE_RUNBOOK.md`](PRODUCTION_RELEASE_RUNBOOK.md).


## Signed Update Channel

The update manifest is a manual-download integrity channel. It does not silently install updates. Generate it only after the final platform artifacts exist:

```bash
DYSTOPAI_UPDATE_SIGNING_PRIVATE_KEY_FILE="C:/secure/dystopai-update-ed25519.pem" npm run release:update-manifest
DYSTOPAI_UPDATE_REQUIRE_SIGNING=1 npm run release:update-verify
```

The verifier rejects unsigned manifests when signing is required, unsafe relative paths, duplicate artifacts, wrong sizes, checksum mismatches, invalid signatures, and artifacts outside the release root. The update key must be separate from the checksum-evidence key so either key can be rotated independently.

## State Backup And Restore

Stop DystopAI before backing up or restoring OpenClaw state. Every backup carries a manifest with relative paths, file sizes, and SHA-256 hashes. Restore verifies the complete archive before staging files and keeps the previous target state as rollback evidence when `--force` is used.

```bash
npm run state:backup -- --source "$HOME/.openclaw" --output "backups/openclaw-state"
npm run state:verify -- --archive "backups/openclaw-state"
npm run state:restore -- --archive "backups/openclaw-state" --target "$HOME/.openclaw" --force
```

Keep backups encrypted at rest because they can contain provider credentials, agent doctrine, messages, and operational logs.

## Release Evidence

Run full CI from a clean release SHA before publishing. Keep the uploaded `dystopai-release-evidence` artifact with the release notes, along with the commit SHA, workflow run URL, artifact digest, checksum manifest, SBOM, detached checksum signature, public key, and signing summary.

Do not publish a public build when CI used a dirty tree, an unsigned public-release run, a missing evidence artifact, or a locally regenerated checksum manifest that was not produced from the same packaged output.

## Threat Model

DystopAI Core's release threat model is a local-only desktop app:

- The control-plane API is localhost API only, bound to loopback addresses such as `127.0.0.1`.
- The app must not bind privileged APIs to LAN interfaces.
- There is no cloud exposure unless authentication, transport security, authorization, auditing, and operator identity are redesigned for a multi-user networked service.
- The desktop renderer is trusted only through the packaged app origin and the narrow preload bridge.
- The bearer token is a local session capability, not an internet-facing account credential.
- OpenClaw/Gateway integrations may operate tools and shell commands inside the local operator boundary; exposing that boundary to a network changes the security model.

Any feature that needs LAN or cloud access must start with a fresh security design before implementation, including TLS, per-user authentication, scoped authorization, revocation, audit logs, origin policy, rate limiting, and recovery procedures.
