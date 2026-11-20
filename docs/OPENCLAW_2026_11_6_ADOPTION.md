# OpenClaw 2026.11.6 adoption and reliability audit

The Automnia runtime and bundled Codex plugin target the [OpenClaw 2026.11.6 stable release](https://github.com/openclaw/openclaw/releases/tag/v2026.11.6). The runtime package is verified by its published SHA-512; the matching Codex plugin is verified separately. The plugin uses `@openai/codex` 0.169.0 and `smol-toml` 1.9.1. The runtime's npm tarball does not contain a shrinkwrap, so Automnia generates and commits a production dependency lock rather than presenting it as an upstream-published lock. The Codex dependency lock is also committed, including the six supported OS/CPU variants.

## Release changes reviewed

These are upstream changes carried by the 2026.11.6 core. Their presence in the package does not by itself prove every scenario works in Automnia, and some apply only to optional channels or plugins. The linked release notes are the source of the behavior descriptions.

1. Upgrade bridging from the 2026.11.5 updater to the new release path.
2. Windows staged plugin dependency validation.
3. Background turns survive configuration edits.
4. Subagent turns survive configuration edits.
5. Final-answer delivery can recover from an interrupted Gateway restart.
6. Reduced Gateway startup memory pressure.
7. Reduced resident memory on constrained hosts.
8. Unused local credential runtimes load later.
9. Plugin tool discovery no longer blocks the Gateway.
10. Provider history remains append-only for long model turns.
11. Responses tool-argument bytes are preserved.
12. Long tool-heavy Claude CLI turns retain their final reply.
13. Loaded chat history remains visible during compaction in upstream UI.
14. Responses conversation-item conflicts recover without replaying completed effects.
15. Subagent results survive Gateway restarts.
16. Requester settlement resumes without consuming results twice.
17. Delivery failures remain distinct from successful result consumption.
18. Large file reads stop after the requested page.
19. Inline environment credentials are redacted in configuration reads.
20. SecretRef-backed skill keys are retained as references.
21. Interrupted configuration writes preserve malformed sources and rollback snapshots.
22. PostgreSQL upgrades stop if the required backup fails.
23. Large session rewinds avoid exhausting the shared database worker.
24. Slow session-history reads do not block transcript writes.
25. Scheduled automations continue when their chat identifier changes.
26. Windows Knowledge writes are restored.

The 2026.11.6 release record did not provide npm Telegram beta end-to-end evidence. Automnia must run its own Telegram delivery, long-running task, restart, and compaction acceptance tests before claiming those scenarios are proven.

## Existing Automnia reliability capabilities checked during adoption

The existing [2026.11.5 adoption guide](OPENCLAW_BETA_OPTIMIZATION_GUIDE.md) and runtime scorecard remain the historical baseline. The following are existing Automnia capabilities carried forward; they are not 15 newly created features in this upgrade:

1. Gateway-first interactive chat with local fallback.
2. Gateway chat prewarming and readiness diagnostics.
3. Fast-mode selection on agent turns.
4. Provider reasoning-default caching.
5. Explicit provider model and fallback ordering.
6. Doctor diagnostics and guided repair controls.
7. Gateway health and restart diagnostics.
8. Bounded runtime-command output and timeout handling on adopted paths.
9. SSE heartbeats, stall detection, and disconnect cancellation.
10. Telegram agent routing and progress status.
11. Telegram policy and Full-access tool checks.
12. Context pruning and bounded compaction settings.
13. Safe settled-turn finalization without replaying completed tool work.
14. Explicit ClawHub skill preview, version revalidation, and review confirmation.
15. Signed update-manifest verification.
16. Workboard prerequisite and dependency-cycle checks.
17. Credential-free provider status summaries.
18. Runtime dependency and artifact integrity checks.

The upgrade adds a checked-in Codex transitive dependency lock, selects npm's supported `--cpu` and `--os` options for the requested target, carries forward Telegram status/routing fixes, and distinguishes non-retryable Vertex access errors from transient upstream failures. These measures do not fix a cloud billing or region entitlement. A real provider request, actual Telegram delivery, and the installed user's runtime must be checked separately from isolated package and source tests.
