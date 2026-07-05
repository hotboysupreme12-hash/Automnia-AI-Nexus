# CI Evidence

Last updated: 2026-07-05

This file records visible hosted GitHub Actions proof for Automnia AI Nexus. It is evidence for the listed commit only. A later release candidate still needs its own green hosted run and artifacts before it can be called public-beta ready.

## Latest Recorded Hosted Main Proof

- Repository: `hotboysupreme12-hash/Automnia-AI-Nexus`
- Commit SHA: `ad92a1e4ce5c0ffa4a477034104cc7ab8826f6a9`
- Source: merge commit for PR #56, `Update Automnia package metadata`
- Workflow run: `https://github.com/hotboysupreme12-hash/Automnia-AI-Nexus/actions/runs/28728220470`
- Required hosted check: `Control Plane CI / Hardened control plane`
- Result: passed

Additional hosted checks for the same merge:

- `Cross-Platform Quality / ubuntu-latest source and build validation`: passed
- `Cross-Platform Quality / macos-latest source and build validation`: passed
- `Server Composition Architecture`: passed

Hosted release artifacts for the same merge:

- `automnia-release-evidence` - uploaded by current Automnia Control Plane CI
- `automnia-packaged-beta-screenshots` - uploaded by current Automnia Control Plane CI
- `automnia-windows-installer-candidate` - uploaded by current Automnia Control Plane CI

## Release Gate

Do not call a later commit public-beta ready just because this proof exists. The evaluated release commit must have its own green hosted Control Plane CI run and packaged artifacts. When checking release readiness, compare the current `main` commit SHA to the hosted workflow run `headSha`; if they differ, wait for or trigger a hosted run on the current `main` SHA before approving the build.
