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
const OPENCLAW_TARGET_VERSION = '2026.11.5'

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
        status: 'implemented',
        priority: 'p0',
        evidence: 'Streaming and buffered turn routes resolve agent fastMode defaults and pass the effective value through Gateway dispatch and recovery.',
        nextAction: 'Keep the effective mode contract covered across all turn entry points.',
      },
      {
        title: 'Cache provider reasoning defaults',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Model Center snapshots resolve defaults through a 256-entry provider/model LRU that invalidates when normalized metadata changes.',
        nextAction: 'Keep defaults aligned with provider metadata and hosted-model policy.',
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
        status: 'implemented',
        priority: 'p0',
        evidence: 'Gateway chat remains the first console path when healthy; focused agent-turn tests assert no CLI fallback for a ready Gateway.',
        nextAction: 'Keep Gateway-first routing covered with the chat contract tests.',
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
        status: 'partial',
        priority: 'p1',
        evidence: 'CI runs a synthetic cold/warm provider-turn latency smoke with explicit budgets and no network or billing; it does not measure live model first-token latency.',
        nextAction: 'Add a separately opt-in, credential-gated live latency acceptance check.',
      },
      {
        title: 'Document provider onboarding checks',
        status: 'implemented',
        priority: 'p2',
        evidence: 'Provider Auth surfaces auth state, catalog freshness, advertised capabilities, and bounded probe limits; catalog refresh is explicit, and a discovered-model probe requires a separate billable confirmation and displays its bounded result.',
        nextAction: 'Keep catalog refresh explicit and require confirmation before every model probe.',
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
        evidence: 'The shared bounded process runner caps both streams and marks truncation; control-plane, managed Gateway, and picker paths use it while some operations retain their own capped collectors.',
        nextAction: 'Route the remaining collected subprocess paths through the shared helper.',
      },
      {
        title: 'Use explicit runtime command timeouts',
        status: 'partial',
        priority: 'p0',
        evidence: 'The shared bounded runner distinguishes timeout from process errors on adopted paths; timeout budgets remain caller-specific.',
        nextAction: 'Centralize operation budgets and apply them to every bounded runtime command.',
      },
      {
        title: 'Kill process trees after timeout',
        status: 'partial',
        priority: 'p1',
        evidence: 'The shared runner requests tree termination with detached POSIX groups and Windows-safe spawning. Tests verify the termination request but do not kill live OS process trees.',
        nextAction: 'Add isolated Windows and POSIX child-tree termination tests and cover remaining call sites.',
      },
      {
        title: 'Abort slow outbound fetches',
        status: 'partial',
        priority: 'p1',
        evidence: 'The shared bounded HTTP helper handles deadlines, caller abort, and response-byte caps for Gateway diagnostics and Google ADC/model paths; other outbound calls remain outside it.',
        nextAction: 'Migrate remaining provider and control-plane probes to the shared request path.',
      },
      {
        title: 'Send SSE keepalive events',
        status: 'implemented',
        priority: 'p1',
        evidence: 'The downstream SSE writer emits bounded 15-second heartbeats, detects stalls, and cancels on client disconnect.',
        nextAction: 'Keep heartbeat and disconnect behavior covered when the stream transport changes.',
      },
      {
        title: 'Apply retry budgets to repair actions',
        status: 'partial',
        priority: 'p2',
        evidence: 'Targeted plugin loader repair permits explicit manual retry only after a recognized process-start failure, with a durable attempt limit/cooldown and terminal uncertain outcomes for timeout, nonzero, or orphaned results.',
        nextAction: 'Extend this policy to other repair actions only where retry safety and idempotency are proven.',
      },
      {
        title: 'Detect stuck queued runs',
        status: 'partial',
        priority: 'p0',
        evidence: 'The console marks queued turns stale after 15 minutes and offers manual cancellation with a local reason; queue state and cancellation reasons are not persisted to a backend ledger.',
        nextAction: 'Persist stale queue state and operator cancellation reasons in a durable run ledger.',
      },
      {
        title: 'Bound plugin scans',
        status: 'implemented',
        priority: 'p2',
        evidence: 'Plugin inventory bounds directories, metadata, CLI entries, and scan time; it reports duration/completeness and rejects over-limit results instead of treating partial data as complete.',
        nextAction: 'Keep future plugin catalog sources under the same limits and completeness contract.',
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
        evidence: 'A bounded append-only ledger records install, update, update-all, uninstall, targeted repair, enable/disable/config, ClawTalk setup, and setup-terminal start/input/stop results with timestamps; it is exposed with plugin inventory and omits secret-bearing values.',
        nextAction: 'Add an authenticated actor identifier if local auth supplies a stable identity, then retain actor/result/timestamp coverage in the ledger.',
      },
      {
        title: 'Persist provider capability cache',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Provider capability snapshots persist through the Control Center state ledger with source, freshness, and schema metadata.',
        nextAction: 'Preserve snapshot provenance when provider catalog schemas change.',
      },
      {
        title: 'Prune upload metadata safely',
        status: 'partial',
        priority: 'p2',
        evidence: 'Version-2 upload manifests contain a hashed owner and seven-day expiry; attachment use checks owner/expiry and runs a bounded cleanup pass. Cleanup results are not yet persisted in diagnostics.',
        nextAction: 'Persist cleanup results and add a scheduled expiry worker with a safe legacy-manifest policy.',
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
        status: 'implemented',
        priority: 'p0',
        evidence: 'Gateway console turns use chat.send; the agent-turn contract test asserts the healthy-Gateway path.',
        nextAction: 'Keep the chat.send transport assertion with Gateway contract changes.',
      },
      {
        title: 'Read chat history for final reconciliation',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Focused Gateway tests compare the visible terminal reply with chat.history for the same session key and include a different-session mismatch fixture.',
        nextAction: 'Keep the session-key comparison with Gateway contract changes.',
      },
      {
        title: 'Keep tools.effective diagnostic only',
        status: 'implemented',
        priority: 'p2',
        evidence: 'gatewayChatService invokes tools.effective only when toolsEffectiveDiagnostic is explicitly enabled; normal turns use chat.send.',
        nextAction: 'Keep the diagnostic behind its explicit opt-in and cover it with a source assertion.',
      },
      {
        title: 'Fallback from Gateway to CLI intentionally',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Fallback transitions now return bounded, redacted source, destination, trigger, detail, and model fields.',
        nextAction: 'Keep fallback details credential-free and consistent across transports.',
      },
      {
        title: 'Fallback from CLI to embedded local runtime',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Buffered responses preserve runtimeFallback and the Console displays the selected transition.',
        nextAction: 'Keep the fallback label and UI projection in sync with routing behavior.',
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
        status: 'implemented',
        priority: 'p1',
        evidence: 'AgentResponseConsole stores prompt drafts and uploaded attachment drafts per target in remembered local state, flushing prompt text on pagehide and beforeunload.',
        nextAction: 'Keep per-target draft restoration covered as console state evolves.',
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
        status: 'partial',
        priority: 'p0',
        evidence: 'Plugin activation is blocked when required configuration fields are missing; the check does not resolve SecretRef bindings or validate their scopes.',
        nextAction: 'Validate SecretRef bindings and scopes before enabling a plugin.',
      },
      {
        title: 'Expose plugin repair actions',
        status: 'implemented',
        priority: 'p1',
        evidence: 'POST /api/plugins/:pluginId/repair targets a reported loader_error, deduplicates attempts by plugin/failure class, and writes bounded append-only repair evidence.',
        nextAction: 'Keep supported failure classes narrow and preserve idempotency and ledger coverage.',
      },
      {
        title: 'Detect loader errors early',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Doctor findings and full/summary Runtime Monitor health expose capped, credential-free plugin loader-failure summaries and app-owned recovery guidance.',
        nextAction: 'Keep the failure projection bounded and credential-free as plugin inventory evolves.',
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
        status: 'implemented',
        priority: 'p1',
        evidence: 'ClawHub preview stages the exact version in an isolated temporary state/config/workspace, reports bounded added/removed/modified content and modes, and binds explicit apply to a preview ID/ref/version with latest-version and hash revalidation.',
        nextAction: 'Keep staging isolated, expire previews, and preserve the explicit apply confirmation and provenance recheck.',
      },
      {
        title: 'Hash skill support files',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Skill Workshop persists verified file-hash baselines, exposes revision comparisons, and bounds ledger and snapshot storage.',
        nextAction: 'Keep baseline comparison and quota behavior covered as skill file support evolves.',
      },
      {
        title: 'Rollback broken skill updates',
        status: 'implemented',
        priority: 'p0',
        evidence: 'Skill Workshop stores verified snapshots and exposes rollback to a prior verified revision while preserving the active baseline on quota failure.',
        nextAction: 'Keep rollback atomic and retain the previous active revision if a write fails.',
      },
      {
        title: 'Quarantine invalid skills',
        status: 'partial',
        priority: 'p0',
        evidence: 'Skill Workshop quarantines changed/invalid skills and supports explicit restore; preflight covers skill management/indexing but not Gateway startup and every agent turn.',
        nextAction: 'Gate every skill load and execution path on quarantine state.',
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
        status: 'implemented',
        priority: 'p0',
        evidence: 'GET/POST/PATCH /api/workboard/tasks persists bounded mission-linked task cards in Control Center state and renders them in the Missions Workboard panel.',
        nextAction: 'Keep task identity stable when mission records change.',
      },
      {
        title: 'Track task dependencies',
        status: 'implemented',
        priority: 'p1',
        evidence: 'Workboard validates prerequisite DAGs, rejects cycles, and blocks starting or completing tasks until prerequisites are complete.',
        nextAction: 'Keep dependency checks atomic with persisted state updates.',
      },
      {
        title: 'Keep task comments and evidence',
        status: 'implemented',
        priority: 'p2',
        evidence: 'Workboard comments and evidence links are appended as bounded receipts; completed tasks reject status, dependency, and assignment mutation.',
        nextAction: 'Preserve append-only comment/evidence history and bounded payload sizes.',
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
        evidence: 'GET /api/auth/status reports provider state; the OAuth modal adds credential-free expiry guidance.',
        nextAction: 'Keep expiry guidance aligned with provider refresh metadata.',
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
        evidence: 'Telegram Settings provides manual Telegram/ClawTalk health checks and Telegram/ClawTalk last-observed activity. Pairing counts remain unqueried and activity is not a delivery receipt.',
        nextAction: 'Add safe pairing-count access and provider delivery receipt/error contracts when available.',
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
        status: 'implemented',
        priority: 'p1',
        evidence: 'scripts/post-upgrade-openclaw-readiness.mjs validates the OpenClaw and Codex bundle versions/dependencies, API and Gateway health, live runtime version, and secret-free provider auth status, then runs bounded OpenClaw/provider/Gateway smokes; its contract smoke verifies metadata and output redaction.',
        nextAction: 'Keep the version pins, provider status whitelist, and bounded smoke list synchronized with each OpenClaw/Codex release.',
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
      note: 'OpenClaw 2026.11.5 source audit; see the guide for 44 app-adoption items, evidence, and actions.',
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
