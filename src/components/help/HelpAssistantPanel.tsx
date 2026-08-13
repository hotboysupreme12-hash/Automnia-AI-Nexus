import { useEffect, useRef, useState } from 'react'
import { apiErrorMessage, apiRequest } from '../../api/client'
import './HelpAssistantPanel.css'

type HelpAssistantPanelProps = {
  isOpen: boolean
  onClose: () => void
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
  icon: 'gateway' | 'access' | 'credits' | 'missions'
  title: string
  question: string
}

const HELP_TOPICS: HelpTopic[] = [
  {
    icon: 'gateway',
    title: 'Reconnect OpenClaw',
    question: 'How do I reconnect the OpenClaw gateway?',
  },
  {
    icon: 'access',
    title: 'Fix provider access',
    question: 'Why did my agent request need authentication?',
  },
  {
    icon: 'credits',
    title: 'Credits & BYOK',
    question: 'How do hosted credits and BYOK work?',
  },
  {
    icon: 'missions',
    title: 'Launch a mission',
    question: 'How do I create and launch an agent mission?',
  },
]

function newMessageId() {
  return `help-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function TopicIcon({ name }: { name: HelpTopic['icon'] }) {
  if (name === 'gateway') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4.5 16.5a4 4 0 0 1 .8-7.92A7 7 0 0 1 18.8 10.5a3 3 0 0 1 .7 5.92" />
        <path d="m8 15 4-4 4 4M12 11v9" />
      </svg>
    )
  }
  if (name === 'access') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="10" width="16" height="10" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2.5" />
      </svg>
    )
  }
  if (name === 'credits') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M14.5 8.5h-3.25a2 2 0 1 0 0 4h1.5a2 2 0 1 1 0 4H9.5M12 6.5v2M12 16.5v2" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4.5 7v5c0 4.2 2.9 7.7 7.5 9 4.6-1.3 7.5-4.8 7.5-9V7L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

export function HelpAssistantPanel({ isOpen, onClose }: HelpAssistantPanelProps) {
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
              <p>Answers grounded in Automnia product knowledge</p>
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
                  <span className="dui-help-welcome__eyebrow">Automnia product expert</span>
                  <h3>How can I help today?</h3>
                  <p>Ask a question in your own words, or choose a common workflow to get started.</p>
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
                    <p>{message.text}</p>
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
                  placeholder="Ask about Automnia setup, agents, missions, or troubleshooting…"
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
