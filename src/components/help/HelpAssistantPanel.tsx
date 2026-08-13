import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apiErrorMessage, apiRequest } from '../../api/client'
import './HelpAssistantPanel.css'

export type HelpNavigationTarget =
  | 'recruit'
  | 'agents'
  | 'command-console'
  | 'missions'
  | 'monitor'
  | 'plugins'
  | 'plugins-clawtalk'
  | 'plugins-telegram'
  | 'settings'
  | 'settings-account'
  | 'settings-appearance'
  | 'settings-workspace'
  | 'settings-voice'
  | 'settings-missions'
  | 'settings-agents'
  | 'settings-data'
  | 'agent-editor'
  | 'agent-editor-profile'
  | 'agent-editor-model'
  | 'agent-editor-heartbeat'
  | 'agent-editor-policy'
  | 'agent-editor-workspace'
  | 'agent-editor-skills'
  | 'agent-editor-files'

type HelpAssistantPanelProps = {
  isOpen: boolean
  onClose: () => void
  onNavigate: (target: HelpNavigationTarget) => void
}

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
}

type KnowledgeAnswer = {
  answerText?: string
  grounded?: boolean
  citations?: unknown[]
  sessionName?: string | null
  modelVersion?: string
}

type HelpTopic = {
  icon: 'clawtalk' | 'telegram' | 'agent' | 'console' | 'mail' | 'skill' | 'calendar' | 'team' | 'youtube' | 'browser' | 'instagram' | 'cloud'
  title: string
  question: string
}

const HELP_TOPICS: HelpTopic[] = [
  {
    icon: 'agent',
    title: 'Customize an agent',
    question: 'How do I customize an Automnia agent for a specific role? Give me the agent-first prompt, every Agent Editor tab, autosave behavior, safe permissions, a test, and the exact manual path.',
  },
  {
    icon: 'mail',
    title: 'Manage email with an agent',
    question: 'How do I set up safe email management with an Automnia agent using Gog and Google Workspace? Start with an agent-first prompt, explain Google Cloud OAuth, read-only Gmail triage, drafts, approvals, and the exact manual controls.',
  },
  {
    icon: 'clawtalk',
    title: 'Give an agent a phone number',
    question: 'How do I give an Automnia agent a phone number through ClawTalk? Walk me through the exact Plugins controls, account requirements, secure setup, safe test, and what an agent can complete for me.',
  },
  {
    icon: 'telegram',
    title: 'Set up Telegram with an agent',
    question: 'Help me set up Telegram for an Automnia agent using agent-first setup. Start with a ready-to-paste Command Console prompt for my configured primary agent, explain the secure BotFather token handoff, pairing, group safety, and testing, then give the exact manual Plugins path if I want to do it myself.',
  },
  {
    icon: 'agent',
    title: 'Bootstrap a first agent',
    question: 'Walk me through the smallest first-agent bootstrap in Automnia. Include the exact Recruit and Agent Editor controls, secure provider connection, model, workspace, skills, permissions, and a Command Console test. Then explain how this configured primary agent can lead later model, plugin, chat, and channel setup before the manual path.',
  },
  {
    icon: 'skill',
    title: 'Give an agent new skills',
    question: 'How do I give an Automnia agent new skills and powers safely? Have the assistant inspect the available skills and plugins, recommend the smallest capability set, explain ClawHub review, policy permissions, secure setup, a read-only test prompt, and the manual controls.',
  },
  {
    icon: 'calendar',
    title: 'Automate a recurring task',
    question: 'How do I turn a successful Automnia agent workflow into a safe recurring task? Compare Missions, Mission Cron, Heartbeat scheduler, and Monitor cron controls; include an agent-first design prompt, exact controls, cadence, approval gates, testing, stopping, and recovery.',
  },
  {
    icon: 'team',
    title: 'Build an advanced agent team',
    question: 'How do I build an advanced Automnia agent that combines multiple skills, plugins, models, and specialists? Start with an agent-first architecture prompt, then explain Recruit, Agent Editor, active party, dispatch modes, missions, handoffs, policies, approval gates, and verification.',
  },
  {
    icon: 'youtube',
    title: 'Research YouTube with an agent',
    question: 'How do I use an Automnia agent to research and manage YouTube content with summarize, browser automation, video frames, Gog, and Google Cloud or gcloud? Give me the safe public-research prompt, exact setup, what publishing still requires, and manual steps.',
  },
  {
    icon: 'browser',
    title: 'Automate browser workflows',
    question: 'How do I automate a browser workflow with an Automnia agent? Have it inspect browser skills and plugins, start with a public read-only dry run, explain secure browser sessions, policy boundaries, human approval for forms or login, a ready-to-paste prompt, and the manual path.',
  },
  {
    icon: 'instagram',
    title: 'Plan Instagram safely',
    question: 'How can an Automnia agent help manage Instagram without exposing my password? Create a content calendar, captions, alt text, browser dry-run, approval checklist, and manual setup. Clearly explain what Automnia can draft versus what still needs an authorized Instagram workflow and final approval.',
  },
  {
    icon: 'cloud',
    title: 'Use Google Cloud and Gog CLI',
    question: 'How do I set up Google Cloud, gcloud, Gog CLI, and an Automnia agent securely for Workspace or Vertex workflows? Have the agent inspect safe readiness only, then give exact local commands, required APIs and roles, secret boundaries, verification, and manual steps.',
  },
  {
    icon: 'console',
    title: 'Explore 100 agent ideas',
    question: 'What are 100 useful and creative things Automnia agents can do across research, email, content, browser workflows, channels, coding, media, monitoring, business, and missions? For each category, explain the skill/plugin, safe test, approval boundary, agent-first prompt pattern, and manual path.',
  },
  {
    icon: 'console',
    title: 'Run Automnia end to end',
    question: 'Explain how to run Automnia from a fresh checkout and packaged desktop app. Map authoritative docs, Help indexing, exact UI navigation, safe local/OpenClaw/Google Cloud paths, troubleshooting, verification, and how a configured primary agent can lead later setup.',
  },
]

function newMessageId() {
  return `help-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

type HelpDestinationMatch = {
  alias: string
  label: string
  target: HelpNavigationTarget
  title: string
}

const HELP_DESTINATION_MATCHES: HelpDestinationMatch[] = [
  { alias: 'Command Console', label: 'Command Console', target: 'command-console', title: 'Open Agents with the Command Console ready.' },
  { alias: 'Agent Editor', label: 'Agent Editor', target: 'agent-editor', title: 'Open the editor for the selected agent.' },
  { alias: 'Edit menu', label: 'Edit menu', target: 'agent-editor', title: 'Open the edit menu for the selected agent.' },
  { alias: 'Edit settings', label: 'Edit settings', target: 'agent-editor', title: 'Open agent edit settings for the selected agent.' },
  { alias: 'Agent settings', label: 'Agent settings', target: 'agent-editor', title: 'Open agent settings for the selected agent.' },
  { alias: 'Profile', label: 'Profile', target: 'agent-editor-profile', title: 'Open the selected agent editor on Profile.' },
  { alias: 'Model', label: 'Model', target: 'agent-editor-model', title: 'Open the selected agent editor on Model.' },
  { alias: 'Agent Registry', label: 'Agent Registry', target: 'agents', title: 'Open the Agents registry.' },
  { alias: 'Agent files', label: 'Agent files', target: 'agent-editor-files', title: 'Open the selected agent editor on Agent files.' },
  { alias: 'Files', label: 'Files', target: 'agent-editor-files', title: 'Open the selected agent editor on Agent files.' },
  { alias: 'Heartbeat scheduler', label: 'Heartbeat scheduler', target: 'agent-editor-heartbeat', title: 'Open the selected agent editor on Heartbeat scheduler.' },
  { alias: 'Policy sandbox', label: 'Policy sandbox', target: 'agent-editor-policy', title: 'Open the selected agent editor on Policy sandbox.' },
  { alias: 'Execution Policy', label: 'Execution Policy', target: 'agent-editor-policy', title: 'Open the selected agent editor on Policy sandbox.' },
  { alias: 'Sandbox', label: 'Sandbox', target: 'agent-editor-policy', title: 'Open the selected agent editor on Policy sandbox.' },
  { alias: 'Workspace', label: 'Workspace', target: 'agent-editor-workspace', title: 'Open the selected agent editor on Workspace.' },
  { alias: 'Skills', label: 'Skills', target: 'agent-editor-skills', title: 'Open the selected agent editor on Skills.' },
  { alias: 'Account & License', label: 'Account & License', target: 'settings-account', title: 'Open Settings at Account & License.' },
  { alias: 'Data & reset', label: 'Data & reset', target: 'settings-data', title: 'Open Settings at Data & reset.' },
  { alias: 'Appearance', label: 'Appearance', target: 'settings-appearance', title: 'Open Settings at Appearance.' },
  { alias: 'UI settings', label: 'UI settings', target: 'settings-appearance', title: 'Open Settings at Appearance.' },
  { alias: 'Workspace settings', label: 'Workspace settings', target: 'settings-workspace', title: 'Open Settings at Workspace.' },
  { alias: 'Registry settings', label: 'Registry settings', target: 'settings-workspace', title: 'Open Settings at Workspace.' },
  { alias: 'Voice', label: 'Voice', target: 'settings-voice', title: 'Open Settings at Voice.' },
  { alias: 'Voice settings', label: 'Voice settings', target: 'settings-voice', title: 'Open Settings at Voice.' },
  { alias: 'Mission defaults', label: 'Mission defaults', target: 'settings-missions', title: 'Open Settings at Missions.' },
  { alias: 'Missions settings', label: 'Missions settings', target: 'settings-missions', title: 'Open Settings at Missions.' },
  { alias: 'Agent runtime', label: 'Agent runtime', target: 'settings-agents', title: 'Open Settings at Agent runtime.' },
  { alias: 'Runtime settings', label: 'Runtime settings', target: 'settings-agents', title: 'Open Settings at Agent runtime.' },
  { alias: 'Google Workspace', label: 'Google Workspace', target: 'command-console', title: 'Open Agents and use the Command Console for this workflow.' },
  { alias: 'ClawTalk', label: 'ClawTalk', target: 'plugins-clawtalk', title: 'Open Plugins and filter for ClawTalk.' },
  { alias: 'Telegram', label: 'Telegram', target: 'plugins-telegram', title: 'Open Plugins and filter for Telegram.' },
  { alias: 'YouTube', label: 'YouTube', target: 'command-console', title: 'Open Agents and use the Command Console for research or drafting.' },
  { alias: 'Missions', label: 'Missions', target: 'missions', title: 'Open the Missions workspace.' },
  { alias: 'Monitor', label: 'Monitor', target: 'monitor', title: 'Open the Monitor workspace.' },
  { alias: 'Plugins', label: 'Plugins', target: 'plugins', title: 'Open the Plugins workspace.' },
  { alias: 'Settings', label: 'Settings', target: 'settings', title: 'Open the Settings workspace.' },
  { alias: 'Recruit', label: 'Recruit', target: 'recruit', title: 'Open the Recruit agent flow.' },
  { alias: 'Agents', label: 'Agents', target: 'agents', title: 'Open the Agents workspace.' },
  { alias: 'Gog', label: 'Gog', target: 'command-console', title: 'Open Agents and use the Command Console to check Gog readiness.' },
]

const HELP_DESTINATION_ALIASES = HELP_DESTINATION_MATCHES
  .flatMap((match) => [match.alias, '**' + match.alias + '**'])
  .sort((left, right) => right.length - left.length)

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^()|[\]\\]/g, '\\$&').replace(/\$/g, '\\$&')
}

function isDestinationBoundary(value: string, start: number, end: number) {
  const before = value[start - 1]
  const after = value[end]
  return !before || !/[\p{L}\p{N}_]/u.test(before) || !after || !/[\p{L}\p{N}_]/u.test(after)
}

function findNextHelpDestination(value: string, start: number): { match: HelpDestinationMatch; start: number; end: number; matchedText: string } | null {
  let best: { match: HelpDestinationMatch; start: number; end: number; matchedText: string } | null = null

  for (const alias of HELP_DESTINATION_ALIASES) {
    const expression = new RegExp(escapeRegExp(alias), 'gi')
    expression.lastIndex = start
    const found = expression.exec(value)
    if (!found || !isDestinationBoundary(value, found.index, found.index + found[0].length)) continue

    const match = HELP_DESTINATION_MATCHES.find((entry) => entry.alias.toLowerCase() === alias.replace(/^\*\*|\*\*$/g, '').toLowerCase())
    if (!match) continue
    const candidate = { match, start: found.index, end: found.index + found[0].length, matchedText: found[0] }
    if (!best || candidate.start < best.start || (candidate.start === best.start && candidate.end > best.end)) best = candidate
  }

  return best
}

function renderLinkedHelpText(value: string, onNavigate: (target: HelpNavigationTarget) => void, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let nodeIndex = 0

  while (cursor < value.length) {
    const next = findNextHelpDestination(value, cursor)
    if (!next) {
      nodes.push(value.slice(cursor).replace(/\*\*/g, ''))
      break
    }

    if (next.start > cursor) nodes.push(value.slice(cursor, next.start).replace(/\*\*/g, ''))
    nodes.push(
      <button
        key={keyPrefix + '-link-' + nodeIndex}
        type="button"
        className="dui-help-inline-link"
        title={next.match.title}
        onClick={() => onNavigate(next.match.target)}
      >
        {next.matchedText.replace(/\*\*/g, '') || next.match.label}
      </button>,
    )
    cursor = next.end
    nodeIndex += 1
  }

  return nodes
}

function renderHelpMessage(text: string, onNavigate: (target: HelpNavigationTarget) => void): ReactNode {
  const nodes: ReactNode[] = []
  const codeCharacter = String.fromCharCode(96)
  const codePattern = new RegExp(
    '(' + codeCharacter.repeat(3) + '[\\s\\S]*?' + codeCharacter.repeat(3) + '|' + codeCharacter + '[^' + codeCharacter + '\\n]*' + codeCharacter + ')',
    'g',
  )
  let cursor = 0
  let segmentIndex = 0
  let match: RegExpExecArray | null

  while ((match = codePattern.exec(text))) {
    if (match.index > cursor) nodes.push(...renderLinkedHelpText(text.slice(cursor, match.index), onNavigate, 'message-' + segmentIndex))
    nodes.push(
      <span key={'message-code-' + segmentIndex} className="dui-help-code">
        {match[0]}
      </span>,
    )
    cursor = match.index + match[0].length
    segmentIndex += 1
  }

  if (cursor < text.length) nodes.push(...renderLinkedHelpText(text.slice(cursor), onNavigate, 'message-' + segmentIndex))
  return nodes
}

function TopicIcon({ name }: { name: HelpTopic['icon'] }) {
  if (name === 'mail') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m5 7 7 5 7-5" />
      </svg>
    )
  }
  if (name === 'skill') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M18.5 15.5 19.2 18l2.3.8-2.3.7-.7 2.5-.8-2.5-2.2-.7 2.2-.8.8-2.5Z" />
      </svg>
    )
  }
  if (name === 'calendar') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="5.5" width="16" height="15" rx="2" /><path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
      </svg>
    )
  }
  if (name === 'team') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="8" r="2.5" /><circle cx="16.5" cy="9" r="2" /><path d="M3.8 19a5.2 5.2 0 0 1 10.4 0M14 18a4 4 0 0 1 6.2 1" />
      </svg>
    )
  }
  if (name === 'youtube') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5.5" width="18" height="13" rx="3" /><path d="m10 9 5 3-5 3V9Z" />
      </svg>
    )
  }
  if (name === 'browser') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9h17M7 6.75h.01M10 6.75h.01M13 6.75h.01" />
      </svg>
    )
  }
  if (name === 'instagram') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4" /><circle cx="12" cy="12" r="3.5" /><path d="M17.25 6.75h.01" />
      </svg>
    )
  }
  if (name === 'cloud') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7.5 18.5h9a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.2 9.3 4.6 4.6 0 0 0 7.5 18.5Z" /><path d="M9 15h6M12 12v6" />
      </svg>
    )
  }
  if (name === 'clawtalk') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 5.5h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-5.8L7 20v-3.5a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" />
        <path d="M8.5 11.2h.01M12 11.2h.01M15.5 11.2h.01" />
      </svg>
    )
  }
  if (name === 'telegram') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m21 3-7.5 18-3.5-7-7-3.5L21 3Z" />
        <path d="M10 14 21 3" />
      </svg>
    )
  }
  if (name === 'agent') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0M18.5 7.5h3M20 6v3" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 5h14v10H9l-4 4V5Z" />
      <path d="M8.5 9.5h7M8.5 12.5h4" />
    </svg>
  )
}

export function HelpAssistantPanel({ isOpen, onClose, onNavigate }: HelpAssistantPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sessionName, setSessionName] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [messages, busy])

  if (!isOpen) return null

  const resetConversation = () => {
    setMessages([])
    setDraft('')
    setError('')
    setSessionName(null)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  const askQuestion = async (question = draft) => {
    const query = question.trim()
    if (!query || busy) return
    setMessages((current) => [...current, { id: newMessageId(), role: 'user', text: query }])
    setDraft('')
    setError('')
    if (inputRef.current) inputRef.current.style.height = ''
    setBusy(true)
    try {
      const result = await apiRequest<KnowledgeAnswer>('/api/knowledge/answer', {
        method: 'POST',
        body: { query, ...(sessionName ? { sessionName } : {}) },
        timeoutMs: 45_000,
      })
      if (!result.ok) throw new Error(apiErrorMessage(result.error))
      const answer = result.data.answerText?.trim()
      if (!answer) throw new Error('The assistant did not find a grounded answer. Try asking the question another way.')
      if (result.data.sessionName) setSessionName(result.data.sessionName)
      setMessages((current) => [...current, {
        id: newMessageId(),
        role: 'assistant',
        text: answer,
      }])
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Could not reach Automnia Assistant.'
      setError(message)
      setMessages((current) => [...current, {
        id: newMessageId(),
        role: 'assistant',
        text: `I couldn’t complete that answer. ${message}`,
      }])
    } finally {
      setBusy(false)
    }
  }

  const hasConversation = messages.length > 0

  return (
    <div className="dui-help-overlay" role="presentation">
      <section className="dui-help-panel" role="dialog" aria-modal="true" aria-labelledby="automnia-help-title">
        <header className="dui-help-panel__header">
          <div className="dui-help-panel__title">
            <span className="dui-help-panel__glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3.25 13.45 8a4 4 0 0 0 2.65 2.65L20.75 12l-4.65 1.35a4 4 0 0 0-2.65 2.65L12 20.75 10.55 16a4 4 0 0 0-2.65-2.65L3.25 12l4.65-1.35A4 4 0 0 0 10.55 8L12 3.25Z" />
              </svg>
            </span>
            <div>
              <span>Product support</span>
              <h2 id="automnia-help-title">Automnia Assistant</h2>
              <p>Outcome-based setup, prompts, controls, and safe next steps</p>
            </div>
          </div>
          <div className="dui-help-panel__actions">
            <span className="dui-help-panel__status"><i aria-hidden="true" /> Grounded reasoning online</span>
            <button type="button" className="dui-help-panel__new" onClick={resetConversation} disabled={busy || !hasConversation}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>New chat</span>
            </button>
            <button type="button" className="dui-help-panel__close" onClick={onClose} aria-label="Close Automnia Assistant">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="dui-help-panel__workspace">
          <main className="dui-help-conversation">
            <div ref={transcriptRef} className="dui-help-transcript" aria-live="polite" aria-label="Automnia Assistant conversation">
              {!hasConversation && (
                <section className="dui-help-welcome" aria-label="Start a help conversation">
                  <div className="dui-help-welcome__orb" aria-hidden="true">
                    <span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3.25 13.45 8a4 4 0 0 0 2.65 2.65L20.75 12l-4.65 1.35a4 4 0 0 0-2.65 2.65L12 20.75 10.55 16a4 4 0 0 0-2.65-2.65L3.25 12l4.65-1.35A4 4 0 0 0 10.55 8L12 3.25Z" />
                      </svg>
                    </span>
                  </div>
                  <span className="dui-help-welcome__eyebrow">Automnia capability playbook</span>
                  <h3>What should your agent do next?</h3>
                  <p>Pick a playbook or ask in your own words. I’ll recommend the skills and plugins, give you a ready-to-paste agent prompt, then show the exact Automnia controls and safe test.</p>
                  <div className="dui-help-suggestions" aria-label="Suggested questions">
                    {HELP_TOPICS.map((topic) => (
                      <button key={topic.question} type="button" onClick={() => void askQuestion(topic.question)} disabled={busy}>
                        <span><TopicIcon name={topic.icon} /></span>
                        <strong>{topic.title}</strong>
                        <small>{topic.question}</small>
                        <i aria-hidden="true">↗</i>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {messages.map((message) => (
                <article key={message.id} className={`dui-help-message dui-help-message--${message.role}`}>
                  <span className="dui-help-message__avatar" aria-hidden="true">
                    {message.role === 'assistant' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3.25 13.45 8a4 4 0 0 0 2.65 2.65L20.75 12l-4.65 1.35a4 4 0 0 0-2.65 2.65L12 20.75 10.55 16a4 4 0 0 0-2.65-2.65L3.25 12l4.65-1.35A4 4 0 0 0 10.55 8L12 3.25Z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="8" r="3.25" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
                      </svg>
                    )}
                  </span>
                  <div className="dui-help-message__content">
                    <span className="dui-help-message__label">{message.role === 'assistant' ? 'Automnia Assistant' : 'You'}</span>
                    <p>{message.role === 'assistant' ? renderHelpMessage(message.text, onNavigate) : message.text}</p>
                  </div>
                </article>
              ))}

              {busy && (
                <article className="dui-help-message dui-help-message--assistant dui-help-message--thinking">
                  <span className="dui-help-message__avatar" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3.25 13.45 8a4 4 0 0 0 2.65 2.65L20.75 12l-4.65 1.35a4 4 0 0 0-2.65 2.65L12 20.75 10.55 16a4 4 0 0 0-2.65-2.65L3.25 12l4.65-1.35A4 4 0 0 0 10.55 8L12 3.25Z" />
                    </svg>
                  </span>
                  <div className="dui-help-message__content">
                    <span className="dui-help-message__label">Automnia Assistant</span>
                    <p className="dui-help-thinking"><i /><i /><i /><span>Searching product knowledge</span></p>
                  </div>
                </article>
              )}
            </div>

            <div className="dui-help-composer-dock">
              {error && <p className="dui-help-error" role="alert">{error}</p>}
              <div className="dui-help-composer" role="group" aria-label="Send a question to Automnia Assistant">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => {
                    const textarea = event.currentTarget
                    setDraft(textarea.value)
                    textarea.style.height = '0px'
                    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      onClose()
                      return
                    }
                    event.stopPropagation()
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void askQuestion()
                    }
                  }}
                  placeholder="Ask about setup, Google Workspace, agents, plugins, skills, or troubleshooting…"
                  aria-label="Ask Automnia Assistant"
                  rows={1}
                  maxLength={5_000}
                  disabled={busy}
                />
                <button type="button" className="is-primary" onClick={() => void askQuestion()} disabled={busy || !draft.trim()} aria-label="Send question">
                  <span>{busy ? 'Working' : 'Send'}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m21 3-7.5 18-3.5-7-7-3.5L21 3Z" /><path d="M10 14 21 3" />
                  </svg>
                </button>
              </div>
              <div className="dui-help-composer-meta">
                <span><kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</span>
                <span className="dui-help-composer-meta__privacy">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
                  </svg>
                  Don’t share secrets
                </span>
              </div>
            </div>
          </main>
        </div>
      </section>
    </div>
  )
}

export default HelpAssistantPanel
