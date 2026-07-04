# Automnia AI Release Governance

Automnia AI is released as a local-first desktop operator console. Public release controls are intentionally stricter than ordinary pull-request validation because release evidence is what operators use to trust packaged artifacts after download.

## Branch Protection

Protect `main` in the repository settings before treating a build as release eligible:

- Require pull requests before merging and block direct pushes to `main`.
- Require the `Control Plane CI / Hardened control plane` check to pass before merge.
- Require at least one approving review when practical.
- Keep administrator bypass disabled for routine release work.

## Beta-Ready Release Gate

Do not apply a beta-ready label, publish a beta handoff, or call a build public-beta ready until the hosted Control Plane CI check has passed on the exact commit being evaluated. A local `npm test` pass is useful developer evidence, but it does not replace the hosted gate because beta readiness depends on Windows packaging, packaged launch, release evidence, screenshots, and artifact upload running in GitHub Actions.

The evaluated commit should include release evidence, packaged launch logs, unit coverage output, bundle-budget output, release validation output, and packaged beta screenshots.

If any artifact is missing, empty, or generated from a different commit, the release remains a beta candidate only. Record the green workflow URL, commit SHA, and artifact names in `docs/CI_EVIDENCE.md` only after the hosted run exists.

## Beta Screenshot Visual Freeze

After the packaged beta screenshot artifact exists for the evaluated commit, treat the captured Agents, Missions, Monitor, Plugins, Settings, and Agent Editor screens as the public beta visual baseline. Do not accept cosmetic redesigns, layout churn, palette changes, animation changes, or selector-only UI rewrites on those surfaces before the public beta cut.

Allowed post-baseline UI changes are limited to accessibility fixes, readability fixes, broken-state corrections, screenshot-capture repairs, and clear regressions found during release qualification. Any allowed change must rerun `npm run capture:packaged-beta-screenshots`, keep all packaged screenshots present, and record the reason in the release handoff or ledger.

## Public Release Signing

Public release validation must fail closed when signing evidence is absent. A public release is qualified by the dedicated `Public Release Candidate` workflow on a version tag or manual release-candidate run.

Public consumer builds should include platform distribution evidence:

- Windows: signed installer evidence.
- macOS: Developer ID signing, notarization, and stapling for macOS artifacts before publication.
- Updates: signed update manifest plus rollback evidence.
- Lifecycle tests: fresh install, upgrade, uninstall, and corrupted-update rollback tests.

The exact release sequence and stop conditions are documented in [`PRODUCTION_RELEASE_RUNBOOK.md`](PRODUCTION_RELEASE_RUNBOOK.md).

## Signed Update Channel

The update manifest is a manual-download integrity channel. It does not silently install updates. Generate it only after the final platform artifacts exist, and keep the update signing path separate from release evidence signing so keys can be rotated independently.
