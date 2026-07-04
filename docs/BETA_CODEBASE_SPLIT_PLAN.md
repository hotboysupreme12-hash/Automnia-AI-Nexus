# Automnia AI Beta Readiness And Codebase Split Plan

This plan tracks the non-signing beta readiness work for Automnia AI. The immediate target is a safer, more maintainable, testable public beta candidate before paid or stable public distribution work.

## Current priority

```text
Public beta candidate
+ cleaner backend boundaries
+ proven mission/runtime recovery
+ safer UI architecture
+ clear operator docs
+ repeatable local validation
```

## Release posture for this phase

- Treat the next milestone as **Public Beta Candidate**.
- Do not block this phase on public code signing, notarization, or paid distribution.
- Prioritize architecture splits, runtime truth, recovery evidence, user trust, and docs.
- Keep the app local-first and loopback-only.

## Primary engineering goal

Shrink `server/controlPlane.ts` from a giant composition-and-service module into a thin composition root. Routes are already extracted. The remaining work is to keep moving implementation logic into focused services.

## Target service areas

```text
server/services/gateway
server/services/runtime
server/services/missions
server/services/agents
server/services/providers
server/services/plugins
server/services/filesystem
server/services/browser
server/state
server/contracts
```

## Split rules

1. `server/controlPlane.ts` may wire dependencies but should not own new business logic.
2. Routes validate HTTP payloads and call services.
3. Services should be testable without starting Express.
4. Filesystem services enforce path containment at their boundary.
5. Runtime services produce evidence objects, not only strings.
6. Mission transitions stay idempotent and ledger-backed.
7. Renderer state should project backend truth, not invent runtime truth.
8. New backend features should declare a target service folder.

## Current completed direction

- Gateway services extracted.
- Runtime services extracted.
- Mission services extracted.
- Provider/auth services extracted.
- Plugin services extracted.
- Filesystem/upload/picker services extracted.
- Browser preflight extracted.
- Agent-turn services extracted.
- Renderer API/store boundaries split.
- UI primitive migration started.

## Remaining direction

- Continue reducing `server/controlPlane.ts` toward the next line budget.
- Continue moving doctor, recruit, config, shift, and runtime-default helpers into focused services.
- Keep service-boundary smoke checks wired into `npm test`.
- Keep UI primitive migration focused on beta-critical surfaces.
- Keep hosted CI and packaged beta evidence as the final proof gate.

## Success statement

This phase is complete when Automnia AI can be handed to a public beta group with confidence that core work paths, recovery paths, state paths, UI paths, and operator docs are real, even if paid distribution and stable-release signing remain later milestones.
