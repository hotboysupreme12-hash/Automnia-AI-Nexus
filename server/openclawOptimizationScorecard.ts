export type OpenClawOptimizationStatus = 'implemented' | 'partial' | 'planned'
export type OpenClawOptimizationPriority = 'p0' | 'p1' | 'p2'

export type OpenClawOptimizationCategoryId =
  | 'fast-path-runtime'
  | 'runtime-recovery'
  | 'bounded-operations'
  | 'durable-state'
  | 'gateway-console'
  | 'streaming-ux'
  | 'plugin-safety'
  | 'skill-workshop'
  | 'workboard-coordination'
  | 'provider-model-center'
  | 'channels-media-files'
  | 'ci-ui-ops'

type OpenClawOptimizationSourceItem = {
  title: string
  status: OpenClawOptimizationStatus
  priority: OpenClawOptimizationPriority
  evidence: string
  nextAction: string
}

type OpenClawOptimizationSourceCategory = {
  id: OpenClawOptimizationCategoryId
  title: string
  docTheme: string
  items: OpenClawOptimizationSourceItem[]
}

export type OpenClawOptimizationScorecardItem = OpenClawOptimizationSourceItem & {
  id: string
  category: OpenClawOptimizationCategoryId
  categoryTitle: string
  docTheme: string
}

export type OpenClawOptimizationScorecardCategory = {
  id: OpenClawOptimizationCategoryId
  title: string
  docTheme: string
  itemCount: number
  implemented: number
  partial: number
  planned: number
}

export type OpenClawOptimizationScorecard = {
  ok: true
  generatedAt: string
  source: {
    guide: string
    targetOpenClawVersion: string
    note: string
  }
  itemCount: number
  implemented: number
  partial: number
  planned: number
  completionPercent: number
  categories: OpenClawOptimizationScorecardCategory[]
  items: OpenClawOptimizationScorecardItem[]
}

const OPENCLAW_OPTIMIZATION_GUIDE = 'docs/OPENCLAW_BETA_OPTIMIZATION_GUIDE.md'
const OPENCLAW_TARGET_VERSION = '2026.6.10'

export const OPENCLAW_OPTIMIZATION_CATEGORIES: OpenClawOptimizationSourceCategory[] = [
  {
    id: 'fast-path-runtime',
    title: 'Fast Path Runtime',
    docTheme: 'Fast mode, provider routing, and lower first-output latency',
    items: [
      {
        title: 'Expose the recommended OpenClaw runtime target',
        status: 'implemented',
        priority: 'p0',
        evidence: 'The diagnostics payload reports the recommended OpenClaw runtime version.',
        nextAction: 'Keep the runtime target aligned with each OpenClaw upgrade guide.',
      },
      {
        title: 'Surface fast-mode readiness in health diagnostics',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Health diagnostics include gateway chat defaults readiness and runtime status.',
        nextAction: 'Show the same readiness signal beside every interactive run surface.',
      },
      {
        title: 'Send automatic fast-mode hints through agent turns',
        status: 'partial',
        priority: 'p0',
        evidence: 'Runtime defaults readiness is tracked, but every turn path still needs explicit fast-mode evidence.',
        nextAction: 'Attach params.fastMode:auto to each Gateway-backed agent-turn request.',
      },
      {
        title: 'Cache provider reasoning defaults',
        status: 'partial',
        priority: 'p1',
        evidence: 'Provider and model routes exist; per-model reasoning defaults need a dedicated cache.',
        nextAction: 'Persist reasoning level defaults by provider and model in the model center cache.',
      },
      {
        title: 'Prewarm Gateway chat before the first console turn',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Gateway prewarm state, ready state, and prewarmedAt are exposed by health diagnostics.',
        nextAction: 'Record cold-start and warm-start first-output latency separately.',
      },
      {
        title: 'Prefer Gateway chat before local fallback',
        status: 'partial',
        priority: 'p0',
        evidence: 'Gateway status and fallback runtime fields exist; every console path needs route-level assertions.',
        nextAction: 'Add a smoke that verifies console turns take the Gateway path when it is ready.',
      },
      {
        title: 'Track transport on each agent response',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Agent responses include transport fields for runtime visibility.',
        nextAction: 'Aggregate transport usage by day so fallback regressions are obvious.',
      },
      {
        title: 'Gate slow-path regressions in CI',
        status: 'planned',
        priority: 'p1',
        evidence: 'The scorecard identifies the regression target; no latency budget gate exists yet.',
        nextAction: 'Add a smoke that fails when first output exceeds the accepted warm-session budget.',
      },
      {
        title: 'Document provider onboarding checks',
        status: 'planned',
        priority: 'p2',
        evidence: 'Provider routes exist; onboarding acceptance criteria are not yet centralized.',
        nextAction: 'Publish provider onboarding criteria beside the model center diagnostics.',
      },
    ],
  },
  {
    id: 'runtime-recovery',
    title: 'Runtime Recovery',
    docTheme: 'Doctor, runtime recovery, and actionable diagnostics',
    items: [
      {
        title: 'Run Doctor from the control plane',
        status: 'implemented',
        priority: 'p0',
        evidence: 'POST /api/doctor/run executes runtime Doctor checks plus structured OpenClaw doctor --lint JSON findings with categorized fix hints and guided next actions; POST /api/doctor/repair runs the documented non-interactive repair before rechecking.',
        nextAction: 'Split broad Doctor repair into dedicated plugin/auth/session mutators when OpenClaw exposes narrower repair selectors.',
      },
      {
        title: 'Read recent Doctor diagnostics',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/doctor/recent returns the latest diagnostic summary, and Runtime Monitor renders persisted Doctor findings with checkId, category, location, guided action, command hint, and fix hint.',
        nextAction: 'Keep finding rows compact as richer OpenClaw repair metadata becomes available.',
      },
      {
        title: 'Include Gateway health in Doctor checks',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Doctor coverage includes Gateway health, chat readiness, and a compact ledger-backed restart timeline.',
        nextAction: 'Connect guided actions to targeted plugin/auth/session repairs as OpenClaw exposes finer repair contracts.',
      },
      {
        title: 'Abort stale runtime chats',
        status: 'implemented',
        priority: 'p0',
        evidence: 'POST /api/openclaw/runtime/chat/abort-stale is registered in the control plane.',
        nextAction: 'Auto-suggest stale-chat aborts when active runs exceed their timeout budget.',
      },
      {
        title: 'Restart Gateway from runtime controls',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Gateway start, stop, and restart runtime routes are registered.',
        nextAction: 'Attach restart reason and result evidence to the Gateway ledger.',
      },
      {
        title: 'Close runtime sessions deliberately',
        status: 'implemented',
        priority: 'p1',
        evidence: 'POST /api/openclaw/runtime/session/close is available for session cleanup.',
        nextAction: 'Show the session identity being closed before destructive cleanup actions.',
      },
      {
        title: 'Classify runtime failures',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Agent and mission response types include failureKind fields.',
        nextAction: 'Roll up failureKind counts in diagnostics for faster support triage.',
      },
      {
        title: 'Create support bundles from diagnostics',
        status: 'planned',
        priority: 'p1',
        evidence: 'Doctor and ledgers provide source data; bundle export is not yet exposed.',
        nextAction: 'Add a redacted support bundle endpoint that includes Doctor, health, and ledger tails.',
      },
      {
        title: 'Publish a runtime recovery playbook',
        status: 'partial',
        priority: 'p2',
        evidence: 'The app exposes recovery controls, but the operator flow is not yet a guided playbook.',
        nextAction: 'Turn common Doctor findings into one-click guided recovery actions.',
      },
    ],
  },
  {
    id: 'bounded-operations',
    title: 'Bounded Operations',
    docTheme: 'Timeouts, caps, retries, and stuck-run protection',
    items: [
      {
        title: 'Check disk free space in health',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/health includes the disk free-space check.',
        nextAction: 'Raise warning thresholds before long-running package installs.',
      },
      {
        title: 'Cap child process stdout and stderr',
        status: 'partial',
        priority: 'p0',
        evidence: 'Command routes preserve stdout and stderr evidence; global truncation still needs a shared helper.',
        nextAction: 'Route every spawned runtime command through one capped output collector.',
      },
      {
        title: 'Use explicit runtime command timeouts',
        status: 'partial',
        priority: 'p0',
        evidence: 'Runtime routes support bounded actions, but timeout policy is not centralized.',
        nextAction: 'Move command timeouts into a single runtime operation budget map.',
      },
      {
        title: 'Kill process trees after timeout',
        status: 'partial',
        priority: 'p1',
        evidence: 'Process spawning exists; cross-platform tree cleanup needs one audited implementation.',
        nextAction: 'Add a process-tree cleanup helper and smoke it on Windows.',
      },
      {
        title: 'Abort slow outbound fetches',
        status: 'partial',
        priority: 'p1',
        evidence: 'Health and provider checks perform remote work; AbortController policy needs centralization.',
        nextAction: 'Add a boundedFetch helper for provider, plugin, and Gateway probes.',
      },
      {
        title: 'Send SSE keepalive events',
        status: 'partial',
        priority: 'p1',
        evidence: 'SSE routes are present; keepalive behavior needs a shared assertion.',
        nextAction: 'Use one SSE writer that emits heartbeat events and closes on disconnect.',
      },
      {
        title: 'Apply retry budgets to repair actions',
        status: 'planned',
        priority: 'p2',
        evidence: 'Repair controls exist in places, but retry count and cooldown policy are not centralized.',
        nextAction: 'Add retry budgets to Gateway, plugin, and provider repair commands.',
      },
      {
        title: 'Detect stuck queued runs',
        status: 'partial',
        priority: 'p0',
        evidence: 'Agent responses expose queuedAt and startedAt timing fields.',
        nextAction: 'Raise a stuck-run diagnostic when queuedAt exists without startedAt past the budget.',
      },
      {
        title: 'Bound plugin scans',
        status: 'partial',
        priority: 'p2',
        evidence: 'Plugin list and search routes are registered; scan timeout evidence is not centralized.',
        nextAction: 'Limit plugin discovery by time and file count before rendering plugin status.',
      },
    ],
  },
  {
    id: 'durable-state',
    title: 'Durable State',
    docTheme: 'SQLite, ledgers, replayable state, and transcript durability',
    items: [
      {
        title: 'Persist runtime run ledgers',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Runtime run ledger append and tail readers are configured.',
        nextAction: 'Expose runtime run tails in a support bundle.',
      },
      {
        title: 'Persist Gateway event ledgers',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Gateway event ledger append and tail readers are configured.',
        nextAction: 'Add filters for restart, error, and first-output events.',
      },
      {
        title: 'Persist diagnostic run ledgers',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Doctor results are appended to the diagnostic run ledger.',
        nextAction: 'Store scorecard snapshots beside Doctor runs after upgrades.',
      },
      {
        title: 'Persist mission event ledgers',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Mission event ledger append and tail readers are configured.',
        nextAction: 'Link mission events to related runtime run ids.',
      },
      {
        title: 'Persist mission report ledgers',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Mission report ledger append and tail readers are configured.',
        nextAction: 'Add report retention status to diagnostics.',
      },
      {
        title: 'Expose ledger persistence health',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Health diagnostics include runtime ledger status.',
        nextAction: 'Warn when the app is running without SQLite persistence.',
      },
      {
        title: 'Persist plugin action results',
        status: 'partial',
        priority: 'p1',
        evidence: 'Plugin endpoints return action results, but a durable plugin action ledger is not complete.',
        nextAction: 'Append install, update, uninstall, and repair results to a plugin ledger.',
      },
      {
        title: 'Persist provider capability cache',
        status: 'planned',
        priority: 'p1',
        evidence: 'Model catalog routes exist; durable provider capability snapshots need a ledger.',
        nextAction: 'Store provider capability snapshots with freshness and source metadata.',
      },
      {
        title: 'Prune upload metadata safely',
        status: 'planned',
        priority: 'p2',
        evidence: 'File upload routes exist; retention policy is not yet represented in diagnostics.',
        nextAction: 'Add retention windows and cleanup results to file diagnostics.',
      },
    ],
  },
  {
    id: 'gateway-console',
    title: 'Gateway Console',
    docTheme: 'Gateway command console and persistent chat sessions',
    items: [
      {
        title: 'Stream ClawTalk console output',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/openclaw/clawtalk-console/stream is registered.',
        nextAction: 'Assert stream events include delta, final, error, and aborted variants.',
      },
      {
        title: 'Read final ClawTalk console messages',
        status: 'implemented',
        priority: 'p0',
        evidence: 'POST /api/openclaw/clawtalk-console/final is registered.',
        nextAction: 'Validate final payloads against persisted transcript state.',
      },
      {
        title: 'Prewarm persistent Gateway chat sessions',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Health exposes Gateway prewarm state and readiness.',
        nextAction: 'Record prewarm duration in the runtime ledger.',
      },
      {
        title: 'Use chat.send for console turns',
        status: 'partial',
        priority: 'p0',
        evidence: 'The Gateway console guide requires chat.send; route-level confirmation is still needed.',
        nextAction: 'Add a transport assertion for console turns that verifies chat.send usage.',
      },
      {
        title: 'Read chat history for final reconciliation',
        status: 'partial',
        priority: 'p1',
        evidence: 'Final console endpoints exist; chat.history reconciliation needs stronger evidence.',
        nextAction: 'Compare final stream payloads with chat.history in a smoke path.',
      },
      {
        title: 'Keep tools.effective diagnostic only',
        status: 'planned',
        priority: 'p2',
        evidence: 'The guide warns against using tools.effective as the primary run path.',
        nextAction: 'Add a console smoke that rejects tools.effective as the default transport.',
      },
      {
        title: 'Fallback from Gateway to CLI intentionally',
        status: 'partial',
        priority: 'p1',
        evidence: 'Runtime snapshot exposes fallback information; fallback event logging needs consistency.',
        nextAction: 'Log each fallback reason and source transport in the Gateway ledger.',
      },
      {
        title: 'Fallback from CLI to embedded local runtime',
        status: 'partial',
        priority: 'p1',
        evidence: 'Local runtime options exist; final fallback should be explicit in diagnostics.',
        nextAction: 'Add an embedded-local fallback label to every agent response.',
      },
      {
        title: 'Expose last Gateway restart reason',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Runtime status, summary status, Monitor, and Doctor expose a bounded durable restart lifecycle timeline plus restart diagnostics correlated with Gateway stability active/queued work.',
        nextAction: 'Attach one-click guided recovery actions to the restart diagnostics when Doctor exposes safe repairs.',
      },
    ],
  },
  {
    id: 'streaming-ux',
    title: 'Streaming UX',
    docTheme: 'First-output latency, streaming state, drafts, and transcript scale',
    items: [
      {
        title: 'Track queuedAt for agent responses',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Agent response types include queuedAt.',
        nextAction: 'Display queue delay in the live operation monitor.',
      },
      {
        title: 'Track startedAt for agent responses',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Agent response types include startedAt.',
        nextAction: 'Calculate queue duration from queuedAt to startedAt.',
      },
      {
        title: 'Track firstTokenAt for first-output latency',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Agent response types include firstTokenAt.',
        nextAction: 'Add p50 and p95 first-output latency to runtime summary.',
      },
      {
        title: 'Track completedAt for run duration',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Agent response types include completedAt.',
        nextAction: 'Show total run duration in mission event details.',
      },
      {
        title: 'Mark buffered responses',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Agent response types include buffered.',
        nextAction: 'Warn operators when buffering replaces live streaming.',
      },
      {
        title: 'Estimate token count for response load',
        status: 'implemented',
        priority: 'p2',
        evidence: 'Agent response types include tokenCountEstimate.',
        nextAction: 'Use the estimate to choose compact transcript rendering.',
      },
      {
        title: 'Persist draft inputs across refresh',
        status: 'planned',
        priority: 'p1',
        evidence: 'The guide calls for draft persistence; no durable draft store is exposed yet.',
        nextAction: 'Persist drafts per workspace, mission, and agent target.',
      },
      {
        title: 'Virtualize large transcripts',
        status: 'planned',
        priority: 'p1',
        evidence: 'Transcript timing metadata exists; large transcript virtualization is not yet enforced.',
        nextAction: 'Virtualize long message lists and preserve scroll anchor on streaming updates.',
      },
      {
        title: 'Display failureKind in streaming errors',
        status: 'partial',
        priority: 'p0',
        evidence: 'failureKind exists in response types; every streaming UI needs visible mapping.',
        nextAction: 'Map failureKind to concise operator-facing recovery copy.',
      },
    ],
  },
  {
    id: 'plugin-safety',
    title: 'Plugin Safety',
    docTheme: 'Plugin installer, SecretRef, repair, and package safety',
    items: [
      {
        title: 'List installed plugins',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/plugins is registered.',
        nextAction: 'Include plugin source and install state freshness in the list response.',
      },
      {
        title: 'Search installable plugins',
        status: 'implemented',
        priority: 'p1',
        evidence: 'GET /api/plugins/search is registered.',
        nextAction: 'Cache search results with a short freshness window.',
      },
      {
        title: 'Install plugins through the control plane',
        status: 'implemented',
        priority: 'p0',
        evidence: 'POST /api/plugins/install is registered.',
        nextAction: 'Record installer package metadata in a durable plugin ledger.',
      },
      {
        title: 'Update plugins individually and in batch',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Plugin update and update-all routes are registered.',
        nextAction: 'Show update batch progress and partial failures in one place.',
      },
      {
        title: 'Uninstall plugins deliberately',
        status: 'implemented',
        priority: 'p1',
        evidence: 'POST /api/plugins/:pluginId/uninstall is registered.',
        nextAction: 'Require uninstall evidence in the plugin action ledger.',
      },
      {
        title: 'Stream plugin setup terminal output',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Plugin setup terminal stream route preserves SSE output.',
        nextAction: 'Attach output caps and timeout budgets to setup sessions.',
      },
      {
        title: 'Validate SecretRef bindings',
        status: 'planned',
        priority: 'p0',
        evidence: 'The OpenClaw guide calls out SecretRef safety; validation is not first-class yet.',
        nextAction: 'Reject plugin activation when required SecretRef bindings are missing or unsafe.',
      },
      {
        title: 'Expose plugin repair actions',
        status: 'partial',
        priority: 'p1',
        evidence: 'Doctor lint findings are categorized as plugin/auth/secret/session/etc. and shown in Monitor with guided plugin inspect, SecretRef audit, session cleanup preview, and related command hints; plugin-specific mutation still depends on a common OpenClaw selector contract.',
        nextAction: 'Add plugin-targeted repair actions with bounded retries and ledger evidence.',
      },
      {
        title: 'Detect loader errors early',
        status: 'partial',
        priority: 'p1',
        evidence: 'Plugin inspect routes exist; loader error summaries should surface in health.',
        nextAction: 'Add plugin loader status to Doctor diagnostics.',
      },
    ],
  },
  {
    id: 'skill-workshop',
    title: 'Skill Workshop',
    docTheme: 'Skill Workshop governance, previews, provenance, and rollback',
    items: [
      {
        title: 'List available skills',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/skills/list is registered.',
        nextAction: 'Show skill origin and last refresh in the list payload.',
      },
      {
        title: 'Expose the skill library',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Skill library routes are registered.',
        nextAction: 'Add library item provenance fields.',
      },
      {
        title: 'Read skill details',
        status: 'implemented',
        priority: 'p1',
        evidence: 'GET /api/skills/info/:skillName is registered.',
        nextAction: 'Include validation findings with the detail payload.',
      },
      {
        title: 'Install and update Clawhub skills',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Clawhub search, install, and update routes are registered.',
        nextAction: 'Store Clawhub install results in an audit ledger.',
      },
      {
        title: 'Learn new skills from operator input',
        status: 'implemented',
        priority: 'p2',
        evidence: 'POST /api/skills/learn is registered.',
        nextAction: 'Require preview and provenance before applying learned skills.',
      },
      {
        title: 'Preview skill file diffs before apply',
        status: 'planned',
        priority: 'p1',
        evidence: 'Skill apply governance is called out in the guide; file diff previews are not enforced.',
        nextAction: 'Add a preview endpoint for SKILL.md and support files before install.',
      },
      {
        title: 'Hash skill support files',
        status: 'planned',
        priority: 'p1',
        evidence: 'Support file integrity is not yet part of the skill diagnostics contract.',
        nextAction: 'Persist hashes for skill support files and validate them before execution.',
      },
      {
        title: 'Rollback broken skill updates',
        status: 'planned',
        priority: 'p0',
        evidence: 'Skill update routes exist; rollback is not represented as a control.',
        nextAction: 'Keep the previous skill revision and expose a rollback command.',
      },
      {
        title: 'Quarantine invalid skills',
        status: 'planned',
        priority: 'p0',
        evidence: 'Skill checks exist; quarantine state is not first-class.',
        nextAction: 'Move invalid skills out of the active path and surface the reason in diagnostics.',
      },
    ],
  },
  {
    id: 'workboard-coordination',
    title: 'Workboard Coordination',
    docTheme: 'Workboard task cards, mission state, owners, and evidence',
    items: [
      {
        title: 'List missions',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/missions is registered.',
        nextAction: 'Expose active optimization work as a mission collection.',
      },
      {
        title: 'Read mission lifecycle state',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/missions/:missionId/lifecycle is registered.',
        nextAction: 'Link lifecycle events to Workboard task-card status.',
      },
      {
        title: 'Read mission events',
        status: 'implemented',
        priority: 'p1',
        evidence: 'GET /api/missions/:missionId/events is registered.',
        nextAction: 'Group events by agent, failureKind, and runtime transport.',
      },
      {
        title: 'Read mission reports',
        status: 'implemented',
        priority: 'p1',
        evidence: 'GET /api/missions/:missionId/report is registered.',
        nextAction: 'Attach report links to Workboard evidence rows.',
      },
      {
        title: 'Project mission summaries',
        status: 'implemented',
        priority: 'p1',
        evidence: 'GET /api/missions/projection is registered.',
        nextAction: 'Add optimization scorecard rollups to mission projections.',
      },
      {
        title: 'Dispatch party work',
        status: 'implemented',
        priority: 'p1',
        evidence: 'POST /api/party/dispatch is registered.',
        nextAction: 'Persist dispatch result evidence by Workboard task id.',
      },
      {
        title: 'Represent task cards directly',
        status: 'planned',
        priority: 'p0',
        evidence: 'The guide asks for Workboard task cards; no dedicated task-card API is registered.',
        nextAction: 'Add task-card create, update, owner, dependency, and evidence endpoints.',
      },
      {
        title: 'Track task dependencies',
        status: 'planned',
        priority: 'p1',
        evidence: 'Mission state exists; dependency graph data is not first-class.',
        nextAction: 'Store blocked-by and unlocks relationships for Workboard task cards.',
      },
      {
        title: 'Keep task comments and evidence',
        status: 'planned',
        priority: 'p2',
        evidence: 'Mission reports provide evidence, but task-level comments are not durable yet.',
        nextAction: 'Add task comments with links to runtime runs, files, and Doctor checks.',
      },
    ],
  },
  {
    id: 'provider-model-center',
    title: 'Provider And Model Center',
    docTheme: 'Provider auth, model catalog, capability cache, and routing safety',
    items: [
      {
        title: 'List auth providers',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/auth/providers is registered.',
        nextAction: 'Show provider readiness beside model selection.',
      },
      {
        title: 'Expose auth status',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/auth/status is registered.',
        nextAction: 'Include token age and expiry warnings when available.',
      },
      {
        title: 'Start provider OAuth flows',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Provider OAuth start and session routes are registered.',
        nextAction: 'Attach OAuth session age and manual completion status to diagnostics.',
      },
      {
        title: 'Configure provider credentials',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Provider create and delete routes are registered.',
        nextAction: 'Redact and validate every provider credential field before saving.',
      },
      {
        title: 'List available models',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/models/available is registered.',
        nextAction: 'Store catalog source, freshness, and fallback status.',
      },
      {
        title: 'Cache model capabilities',
        status: 'partial',
        priority: 'p1',
        evidence: 'Model routes exist; durable capability snapshots need stronger freshness metadata.',
        nextAction: 'Persist context, media, tool, and reasoning capability fields per model.',
      },
      {
        title: 'Run provider smoke tests',
        status: 'planned',
        priority: 'p1',
        evidence: 'Provider auth routes exist; active model smoke tests are not first-class.',
        nextAction: 'Add a bounded provider smoke test endpoint for each configured provider.',
      },
      {
        title: 'Warn on expiring provider tokens',
        status: 'planned',
        priority: 'p2',
        evidence: 'OAuth flows exist; expiry warning UX is not yet represented in diagnostics.',
        nextAction: 'Store token expiry metadata and show warning thresholds.',
      },
      {
        title: 'Explain provider fallback selection',
        status: 'partial',
        priority: 'p1',
        evidence: 'Provider and model selection routes exist; fallback reason is not always shown.',
        nextAction: 'Attach route reason, fallback model, and capability mismatch to model decisions.',
      },
    ],
  },
  {
    id: 'channels-media-files',
    title: 'Channels, Media, And Files',
    docTheme: 'Channel Center, inbound queue, delivery health, media jobs, and assets',
    items: [
      {
        title: 'List command console files',
        status: 'implemented',
        priority: 'p1',
        evidence: 'GET /api/files is registered.',
        nextAction: 'Include file age, size, and retention state.',
      },
      {
        title: 'Upload command console files',
        status: 'implemented',
        priority: 'p1',
        evidence: 'POST /api/files/upload is registered.',
        nextAction: 'Add malware-safe extension and size diagnostics to upload responses.',
      },
      {
        title: 'Read and update command files',
        status: 'implemented',
        priority: 'p2',
        evidence: 'GET and PUT /api/files/:file are registered.',
        nextAction: 'Record edit provenance in file metadata.',
      },
      {
        title: 'Pick party folders',
        status: 'implemented',
        priority: 'p2',
        evidence: 'Folder picker routes are registered.',
        nextAction: 'Cache recent folder picks per workspace.',
      },
      {
        title: 'Pick and upload avatars',
        status: 'implemented',
        priority: 'p2',
        evidence: 'Avatar picker, preview, and upload routes are registered.',
        nextAction: 'Add image dimension and content-type validation evidence.',
      },
      {
        title: 'Expose ClawTalk channel setup',
        status: 'partial',
        priority: 'p1',
        evidence: 'ClawTalk plugin setup route exists; broader channel center is not complete.',
        nextAction: 'Add channel connection, pairing, and last-delivery status.',
      },
      {
        title: 'Queue inbound channel messages',
        status: 'planned',
        priority: 'p0',
        evidence: 'The guide calls for an inbound queue; no dedicated channel inbox API is registered.',
        nextAction: 'Persist inbound messages with source, status, and assigned agent.',
      },
      {
        title: 'Track outbound delivery health',
        status: 'planned',
        priority: 'p1',
        evidence: 'Channel setup exists; delivery retries and health are not first-class.',
        nextAction: 'Store delivery attempts, retry schedule, and final status per message.',
      },
      {
        title: 'Track media jobs',
        status: 'planned',
        priority: 'p2',
        evidence: 'Files and avatars exist; generic media job state is not yet exposed.',
        nextAction: 'Add media job records for generation, upload, conversion, and cleanup.',
      },
    ],
  },
  {
    id: 'ci-ui-ops',
    title: 'CI, UI, And Ops',
    docTheme: 'Post-upgrade checks, route inventory, runtime status cache, and UI polish',
    items: [
      {
        title: 'Enforce route inventory',
        status: 'implemented',
        priority: 'p0',
        evidence: 'smoke:route-inventory compares registered routes to the canonical inventory.',
        nextAction: 'Keep every new route in the inventory with its smoke contract.',
      },
      {
        title: 'Enforce canonical API envelopes',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Control-plane smoke tests assert apiSuccess and apiFailure usage.',
        nextAction: 'Extend the check to newly extracted route modules as they are added.',
      },
      {
        title: 'Cache runtime status summaries',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Runtime status payloads include cache metadata and summary routes.',
        nextAction: 'Show cache age in any UI that renders runtime status.',
      },
      {
        title: 'Expose post-upgrade readiness',
        status: 'partial',
        priority: 'p1',
        evidence: 'Version, Doctor, disk, and scorecard diagnostics exist; no single upgrade checklist is exposed.',
        nextAction: 'Add a post-upgrade checklist endpoint that references Doctor and scorecard results.',
      },
      {
        title: 'Reduce grey theme drift in OpenClaw controls',
        status: 'partial',
        priority: 'p2',
        evidence: 'Theme CSS has targeted overrides for the agent registry toolbar.',
        nextAction: 'Move cyan and #07090b control tokens into shared theme variables.',
      },
      {
        title: 'Keep selected controls visually active',
        status: 'partial',
        priority: 'p2',
        evidence: 'Selected toolbar controls have brighter cyan overrides.',
        nextAction: 'Audit all segmented controls for the same selected-state contrast rule.',
      },
      {
        title: 'Automate screenshot checks for key views',
        status: 'planned',
        priority: 'p1',
        evidence: 'Manual screenshots informed the toolbar fix; screenshot regression checks are not complete.',
        nextAction: 'Add Playwright screenshots for runtime, party, plugin, and registry screens.',
      },
      {
        title: 'Measure client bundle drift',
        status: 'planned',
        priority: 'p2',
        evidence: 'Client builds run successfully; bundle budget reporting is not part of CI.',
        nextAction: 'Add bundle size reporting and fail only on meaningful regressions.',
      },
      {
        title: 'Publish an OpenClaw scorecard endpoint',
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET /api/openclaw/optimization-scorecard serves this 100-plus item scorecard.',
        nextAction: 'Render the scorecard in the app and save snapshots after OpenClaw upgrades.',
      },
    ],
  },
]

export const OPENCLAW_OPTIMIZATION_ITEM_COUNT = OPENCLAW_OPTIMIZATION_CATEGORIES.reduce(
  (count, category) => count + category.items.length,
  0,
)

function countStatus(items: OpenClawOptimizationSourceItem[], status: OpenClawOptimizationStatus) {
  return items.filter((item) => item.status === status).length
}

function toPercent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

export function buildOpenClawOptimizationScorecard(): OpenClawOptimizationScorecard {
  const items = OPENCLAW_OPTIMIZATION_CATEGORIES.flatMap((category, categoryIndex) =>
    category.items.map((item, itemIndex) => ({
      id: `oc-opt-${String(categoryIndex + 1).padStart(2, '0')}-${String(itemIndex + 1).padStart(2, '0')}`,
      category: category.id,
      categoryTitle: category.title,
      docTheme: category.docTheme,
      ...item,
    })),
  )
  const implemented = items.filter((item) => item.status === 'implemented').length
  const partial = items.filter((item) => item.status === 'partial').length
  const planned = items.filter((item) => item.status === 'planned').length

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: {
      guide: OPENCLAW_OPTIMIZATION_GUIDE,
      targetOpenClawVersion: OPENCLAW_TARGET_VERSION,
      note: 'OpenClaw optimization scorecard based on the local beta optimization guide.',
    },
    itemCount: items.length,
    implemented,
    partial,
    planned,
    completionPercent: toPercent(implemented, items.length),
    categories: OPENCLAW_OPTIMIZATION_CATEGORIES.map((category) => ({
      id: category.id,
      title: category.title,
      docTheme: category.docTheme,
      itemCount: category.items.length,
      implemented: countStatus(category.items, 'implemented'),
      partial: countStatus(category.items, 'partial'),
      planned: countStatus(category.items, 'planned'),
    })),
    items,
  }
}
