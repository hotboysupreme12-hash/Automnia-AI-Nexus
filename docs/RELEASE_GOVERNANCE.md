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

## Public Release Signing

Public release validation must fail closed when signing evidence is absent. A public release is any version-tag run matching `refs/tags/v*`, a manual `workflow_dispatch` run with `public_release: true`, or any CI run with `DYSTOPAI_RELEASE_REQUIRE_SIGNING=true`.

The required evidence files are:

- `release/evidence/dystopai-sbom.cdx.json`
- `release/evidence/checksums.sha256`
- `release/evidence/release-evidence.json`
- `release/evidence/checksums.sha256.sig`
- `release/evidence/signing-public-key.pem`
- `release/evidence/release-signing.json`

Local release validation can enforce the same policy:

```bash
npm run release:evidence
DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_FILE="C:/secure/dystopai-release-ed25519.pem" npm run release:sign
DYSTOPAI_RELEASE_REQUIRE_SIGNING=1 npm run release:validate
```

In GitHub Actions, configure `DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM` as a secret and `DYSTOPAI_RELEASE_SIGNING_KEY_ID` as a variable. The signing key must be Ed25519 and must never be committed to the repository.

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
