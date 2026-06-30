# DystopAI 150-Point Production Release Plan

This is the final release checklist for moving DystopAI from strong early-access prototype to a trustworthy public release. It is intentionally concrete: every point should either produce evidence, remove risk, improve user trust, or make the app easier to support.

## Release targets

| Stage | Target score | Meaning |
| --- | ---: | --- |
| Internal dogfood | 6.0+ | Safe enough for the builder to use daily and break aggressively. |
| Trusted private beta | 7.0+ | Safe enough for a few known testers with clear expectations. |
| Early-access beta | 7.5+ | Strong enough for broader testing with fast updates and caveats. |
| Paid public release | 8.0+ | Strong installer, docs, update path, support, recovery, and release evidence. |
| Commercial-ready release | 8.5+ | Repeatable signed releases, strong observability, low support friction, and proven recovery. |

## Golden release rule

Do not ship based on vibes. Ship from evidence: green CI, signed artifacts, verified installers, clean release notes, recovery proof, and a documented user path.

## Phase 1: Release governance and product boundary

1. Define the first release as **DystopAI Early Access Beta** unless every paid-release gate is green.
2. Write the release promise in plain English: local-first desktop control center for OpenClaw agents.
3. State clearly that DystopAI is not a cloud account system or hostile multi-tenant service.
4. Keep the local API and Gateway boundary loopback-only for the first release.
5. Add a release owner for every release candidate.
6. Add a release date, release SHA, and release channel to each candidate build.
7. Require `main` branch protection before any public release.
8. Require pull requests before merging release-critical changes.
9. Require the main Control Plane CI workflow to pass before merging release candidates.
10. Require at least one reviewer for release branches.
11. Require signed tags for public release versions where possible.
12. Require release evidence artifacts to be stored with the release notes.
13. Keep administrator bypass disabled for normal release work.
14. Document any emergency bypass with SHA, reason, and follow-up issue.
15. Maintain a release decision log in `docs/PRODUCTION_HARDENING_LEDGER.md` or release notes.

## Phase 2: Legal, data, and trust documents

16. Keep `SECURITY.md` in the repository root.
17. Keep `DATA_HANDLING.md` in the repository root because packaging includes it as a legal resource.
18. Keep `CHANGELOG.md` updated for every release candidate.
19. Keep `THIRD_PARTY_NOTICES.txt` generated from the current lockfile.
20. Keep `docs/RELEASE_GOVERNANCE.md` aligned with the actual workflows.
21. Keep `docs/PRODUCTION_RELEASE_RUNBOOK.md` aligned with the actual commands.
22. Add a support/contact path for users who hit install, auth, runtime, or model issues.
23. Add a private vulnerability reporting path in `SECURITY.md`.
24. Explain that provider keys, OAuth credentials, messages, and logs can exist in local state.
25. Explain that data can leave the machine through configured providers, plugins, browser tools, and channels.
26. Document where DystopAI state is stored by default.
27. Document where OpenClaw state is stored by default.
28. Document how to remove local state when uninstalling or retiring a device.
29. Document how to back up and restore local OpenClaw state safely.
30. Confirm all packaged legal files exist before every desktop package build.

## Phase 3: CI and release evidence

31. Run `npm ci` from a clean checkout before every release candidate.
32. Run `npm run lint` before every release candidate.
33. Run `npm run typecheck` before every release candidate.
34. Run `npm run test:unit` before every release candidate.
35. Run `npm run test:unit:coverage` before every release candidate.
36. Run `npm test` as the full local quality gate.
37. Run `npm run verify:release-candidate` before packaging.
38. Run `npm run smoke:api-soak` before declaring release-candidate stability.
39. Run `npm run check:bundle-budgets` before publishing screenshots or installers.
40. Run `npm run secret:scan` before packaging.
41. Run `npm run audit:dependencies` before packaging.
42. Run `npm run notices:check` before packaging.
43. Keep CI pinned to immutable GitHub Action SHAs.
44. Upload release evidence artifacts from CI.
45. Do not publish a build if the CI evidence was created from a dirty tree or different SHA.

## Phase 4: Installer and packaged app proof

46. Run `npm run build:standalone` from a clean checkout.
47. Run `npm run prepare:runtime-bundles` before desktop packaging.
48. Run `npm run prepare:openclaw-vendor` before desktop packaging.
49. Run `npm run package:desktop` to create an unpacked package for quick smoke testing.
50. Run `npm run smoke:packaged-electron-launch` against the unpacked package.
51. Run `npm run dist:win` for the Windows release candidate.
52. Run `npm run dist:mac` for the macOS release candidate when macOS release is targeted.
53. Run `npm run dist:linux` for Linux AppImage and Debian candidates when Linux release is targeted.
54. Confirm the packaged app starts with no dev server running.
55. Confirm the packaged app can bootstrap a local desktop session.
56. Confirm the packaged app can find the bundled UI assets.
57. Confirm the packaged app can find the bundled API server.
58. Confirm the packaged app can find OpenClaw runtime resources or report the missing runtime clearly.
59. Confirm the packaged app can quit cleanly from the tray/menu.
60. Confirm uninstall does not delete user data unless the user explicitly chooses that behavior.

## Phase 5: Security and local control plane

61. Keep every privileged API route behind bearer authentication.
62. Keep public API routes limited to readiness, health, login, and auth status where appropriate.
63. Keep CORS restricted to loopback origins used by the app.
64. Keep the control-plane API loopback-only.
65. Keep the OpenClaw Gateway loopback-only for the first release.
66. Keep Electron `nodeIntegration` disabled.
67. Keep Electron `contextIsolation` enabled.
68. Keep Electron sandboxing enabled.
69. Keep renderer permissions denied by default.
70. Validate every IPC sender before serving privileged preload calls.
71. Keep the preload bridge narrow and explicit.
72. Keep session tokens expiring, bounded, and revocable.
73. Keep login attempt throttling enabled.
74. Keep secrets, tokens, OAuth codes, and provider keys redacted from diagnostics.
75. Add an explicit warning to docs that LAN or internet exposure requires a new security design.

## Phase 6: Runtime, Gateway, and recovery reliability

76. Prove the API server starts reliably inside Electron.
77. Prove the API server restart path works after unexpected exit.
78. Prove Gateway start/restart/stop controls work from the tray and Monitor.
79. Prove runtime shutdown works on app quit.
80. Prove helper cleanup runs on quit.
81. Prove stale sessions can be identified and cleaned.
82. Prove cron jobs can be listed, reviewed, and cleared.
83. Prove the runtime monitor can clear logs without corrupting ledgers.
84. Prove doctor diagnostics run and return redacted errors.
85. Prove the app reports missing OpenClaw runtime cleanly.
86. Prove OpenClaw version mismatch is visible to the operator.
87. Prove runtime logs never expose known secret patterns.
88. Prove JSONL fallback preserves valid rows when malformed rows exist.
89. Prove SQLite ledger opens with WAL and busy timeout.
90. Prove state backup, verify, and restore work on a realistic local state directory.

## Phase 7: Mission and agent correctness

91. Prove instant missions start, run, report, and complete.
92. Prove timed missions stop at the expected duration.
93. Prove continuous missions can be manually stopped.
94. Prove indefinite missions stay visible and cancellable.
95. Prove mission start is idempotent when the same idempotency key is reused.
96. Prove mission cancellation cleans up scheduled jobs.
97. Prove mission reports show unavailable metrics as unavailable rather than invented values.
98. Prove mission reports distinguish completed, failed, cancelled, timed-out, retried, and fallback runs.
99. Prove mission reports include command and tool failure counts.
100. Prove mission reports include runtime run IDs, session IDs, and cron references where available.
101. Prove agent turn streaming handles partial, block, preview, final, and failure events.
102. Prove buffered agent turns still produce user-visible progress.
103. Prove busy agents do not accept conflicting concurrent turns unless explicitly allowed.
104. Prove command-console attachments are size-limited, type-limited, and path-contained.
105. Prove agent workspace policies are enforced before filesystem access.

## Phase 8: Restart durability and disaster recovery

106. Start a continuous mission, kill the backend, restart, and confirm projection recovers it.
107. Start a scheduled mission, kill the app, restart, and confirm cron jobs reconcile.
108. Start an agent run, kill the renderer, and confirm the shell recovers or reports the failure.
109. Start the app with a corrupted ledger row and confirm valid history still loads.
110. Start the app with SQLite unavailable and confirm JSONL fallback works.
111. Restore a previous OpenClaw state backup and confirm DystopAI can start afterward.
112. Simulate a missing provider credential and confirm the UI asks for setup instead of failing silently.
113. Simulate a missing Gateway and confirm recovery controls are visible.
114. Simulate a failed OpenClaw command and confirm the final report captures the failure.
115. Simulate a blocked approval action and confirm the agent does not execute the final step.
116. Simulate a stale session lock and confirm cleanup can recover it.
117. Simulate a plugin install failure and confirm the user sees a safe, redacted error.
118. Simulate a renderer crash loop and confirm the error boundary prevents a blank screen.
119. Simulate a full local-state backup and restore before publishing release notes.
120. Record restart-recovery evidence in the release artifact set.

## Phase 9: UI, accessibility, and user experience

121. Verify all core screens render in production mode.
122. Verify the first-run flow explains token/bootstrap behavior clearly.
123. Verify Settings controls persist and rehydrate correctly.
124. Verify Monitor shows connected, offline, quiet, busy, warning, and failure states.
125. Verify the command console remains usable when many messages exist.
126. Verify agent cards do not overflow at supported window sizes.
127. Verify Mission controls remain clear for instant, timed, continuous, and indefinite modes.
128. Verify Plugins shows configured, missing-auth, failed, and unavailable states.
129. Verify Provider Auth modals explain what is required before a model can be used.
130. Verify all important buttons have accessible names.
131. Remove mixed tab/nav semantics from the side rail before accessibility signoff.
132. Keep `aria-current="page"` for workspace navigation.
133. Keep skip-link behavior working for keyboard users.
134. Verify focus-visible styling is obvious on dark backgrounds.
135. Verify reduced-motion mode is honored by settings and CSS.
136. Verify text contrast for small labels, chips, placeholders, and disabled states.
137. Verify destructive actions require confirmation or review.
138. Replace hidden right-click-only destructive controls with visible alternatives where possible.
139. Capture fresh screenshots from the packaged production UI.
140. Freeze visual changes after release candidate screenshots are captured.

## Phase 10: Support, launch, and post-release operations

141. Publish release notes that include known limitations.
142. Include the release SHA in release notes.
143. Include installer hashes in release notes.
144. Include links to data handling, security, and user guide docs in release notes.
145. Provide a small “how to recover” guide for stuck Gateway, stuck mission, and failed auth.
146. Provide a small “how to send logs safely” guide with redaction warnings.
147. Provide a beta feedback channel and label all beta reports clearly.
148. Track first-user friction in issues or a release board.
149. Patch small release blockers quickly, but batch risky architectural changes into planned updates.
150. After the first beta wave, decide whether the next milestone is stability, onboarding, plugin marketplace, or paid distribution.

## Additional release polish beyond the 150 points

- Keep a one-page launch checklist in the release PR description.
- Keep one screenshot set per release candidate.
- Keep one known-issues section in every release note.
- Keep a rollback build available when publishing to testers.
- Keep the first public version modestly named: **Early Access Beta**, not stable.
- Keep pricing separate from release readiness until install, update, and recovery are proven.
- Keep the architecture work going after release: `controlPlane.ts` should continue shrinking into service modules.

## Minimum “go” criteria for the first trusted beta

```text
Green Control Plane CI
Green packaged launch smoke
Restored release docs
Validated DATA_HANDLING.md packaging
Mission restart recovery proof
No known secret leaks in diagnostics
No missing installer resource references
Fresh production screenshots
Clear early-access release notes
```

## Minimum “go” criteria for paid public release

```text
All trusted-beta gates
Signed Windows installer evidence
Signed update manifest
SBOM and checksum evidence
Fresh install test
Upgrade test
Uninstall test
Corrupted update rollback test
Support/security reporting path
User-facing recovery guide
```
