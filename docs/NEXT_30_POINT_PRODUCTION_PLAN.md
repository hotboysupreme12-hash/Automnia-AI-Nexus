# DystopAI Next 30-Point Production Plan

This plan starts from the current audit position:

```text
Codebase readiness: about 8.3 / 10
Hosted-proof-adjusted readiness: about 8.1 / 10
Current release label: Public Beta Candidate
```

The goal is not to add another large feature wave. The goal is to prove the product behaves reliably, finish the remaining major architecture extractions, and turn the current beta candidate into something safe enough for a broader public beta.

## Release target

```text
Target score after this plan: 8.5 / 10
Target label: Public Beta Ready
Not yet: Stable paid commercial release
```

## 30-point plan

### 1. Get hosted CI evidence

1. Make the main GitHub Actions workflows visibly run on the current `main` commit or a release-candidate PR.
2. Fix any repository, runner, permission, billing, or workflow trigger issue that prevents hosted runs from appearing.
3. Require the full Control Plane CI workflow to pass before calling a build beta-ready.
4. Upload or preserve CI artifacts for test logs, release evidence, packaged launch smoke, bundle budgets, and screenshots.
5. Add a short `docs/CI_EVIDENCE.md` file linking the latest green run, commit SHA, and artifact set.

### 2. Prove packaged beta behavior

6. Run `npm run package:desktop` from a clean checkout.
7. Run `npm run smoke:packaged-electron-launch` against the packaged app, not the dev Electron app.
8. Capture fresh screenshots from the packaged app for Agents, Missions, Monitor, Plugins, Settings, and Agent Editor.
9. Run `npm run release:evidence` and `npm run release:validate` in non-public beta mode.
10. Create a beta release note that includes known limitations, installer caveats, and recovery instructions.

### 3. Finish the highest-value backend extractions

11. Extract `streamProviderAgentTurn` into `server/services/agents/agentStreamingService.ts`.
12. Extract `runBufferedAgentTurnForStream` into `server/services/agents/agentTurnService.ts`.
13. Extract `runGatewayAgentTurnForStream` into `server/services/agents/gatewayAgentTurnService.ts`.
14. Extract `runControlCenterAgentRuntimeTurn` into `server/services/agents/agentRuntimeService.ts`.
15. Add focused tests and smoke coverage for streamed turns, buffered turns, Gateway turns, fallback turns, redacted failures, and cancellation.

### 4. Finish browser and filesystem hardening

16. Extract `checkBrowserPreflight` into `server/services/browser/browserPreflightService.ts`.
17. Add tests for browser relay missing, browser relay offline, invalid browser payload, and redacted browser preflight errors.
18. Add file-signature sniffing for high-risk upload classes: PNG, JPEG, WebP, GIF, PDF, and common audio types where practical.
19. Keep extension/MIME allowlists, but require file signatures to agree for image and PDF uploads.
20. Add tests proving misleading MIME headers cannot bypass unsupported file extensions or file signatures.

### 5. Lower architecture budgets

21. Lower the `server/controlPlane.ts` budget from the current extraction ceiling to `15,000` lines after the agent-turn and browser-preflight extractions.
22. Add a second warning budget at `12,000` lines for the next milestone after public beta.
23. Keep `0` inline Express API routes in `controlPlane.ts`.
24. Keep `src/store/nexusStore.ts` free of raw `/api` path literals, raw `fetch`, and direct `apiRequest` calls.
25. Keep plugin, provider, mission, runtime, Gateway, filesystem, and renderer-store boundary smoke checks in `npm test`.

### 6. Finish UI primitive migration for beta-critical screens

26. Migrate shell rail actions, workspace status chips, and header controls to the local UI primitives.
27. Migrate Monitor and Command Console controls to `Button`, `IconButton`, `Panel`, `Badge`, and `StatusChip` primitives.
28. Migrate Missions and Plugins panel action rows to the primitives and remove any old selectors made obsolete by the migration.
29. Add Playwright or screenshot smoke coverage for the packaged UI’s core screens.
30. Freeze visual changes after beta screenshots and only accept accessibility, readability, or regression fixes until the public beta cut.

## Minimum go criteria after these 30 items

```text
Green hosted CI
Packaged launch smoke passes
Release evidence validates in beta mode
Agent-turn services extracted and tested
Browser preflight extracted and tested
Upload signature sniffing added for core file classes
controlPlane.ts budget lowered to 15,000 lines
Main UI screens use primitives for critical actions
Fresh packaged screenshots captured
Known-issues beta release note ready
```

## What waits until after public beta

```text
Paid licensing or payment flow
Mandatory public code signing/notarization for every platform
Silent auto-update
Cloud account system
LAN or internet-exposed control plane
Full design-system rewrite
ControlPlane budget below 10,000 lines
```

## Why this plan matters

DystopAI is now close enough that the remaining work is about trust. The next win is not another feature. The next win is proof: hosted CI, packaged app behavior, extracted agent-turn paths, browser preflight isolation, stronger upload validation, and a cleaner UI primitive migration.

Once these 30 items are complete, DystopAI should be a credible public beta candidate with an estimated readiness score around `8.5 / 10`.
