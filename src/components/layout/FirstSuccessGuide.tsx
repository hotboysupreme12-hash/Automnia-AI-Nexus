import { useEffect, useState, useSyncExternalStore } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import type { HelpNavigationTarget } from '../help/HelpAssistantPanel'
import { readPreferenceValue, savePreferenceEntries, PREFERENCE_STORAGE_STATUS_EVENT } from '../settings/preferenceStorage'
import { Button } from '../ui'

const KEY = 'automnia-first-success-v1'
const readGuideState = () => readPreferenceValue(KEY) || ''
const subscribeGuideState = (listener: () => void) => { window.addEventListener(PREFERENCE_STORAGE_STATUS_EVENT, listener); window.addEventListener('storage', listener); return () => { window.removeEventListener(PREFERENCE_STORAGE_STATUS_EVENT, listener); window.removeEventListener('storage', listener) } }
export function FirstSuccessGuide({ onNavigate }: { onNavigate: (target: HelpNavigationTarget) => void }) {
  const hasAgent = useNexusStore((state) => state.agents.length > 0)
  const hasModel = useNexusStore((state) => state.agents.some((agent) => Boolean(agent.model?.primary)))
  const hasParty = useNexusStore((state) => state.activePartyIds.length > 0)
  const hasSuccess = useNexusStore((state) => state.agentResponses.some((response) => response.ok && !response.streaming && Boolean(response.response.trim())))
  const saved = useSyncExternalStore(subscribeGuideState, readGuideState, readGuideState)
  const [open, setOpen] = useState(() => !readPreferenceValue(KEY) && !hasParty)
  useEffect(() => {
    if (!hasSuccess || saved === 'complete') return
    savePreferenceEntries([[KEY, 'complete']])
  }, [hasSuccess, saved])
  const complete = hasSuccess || saved === 'complete'
  const steps: Array<{ label: string; done: boolean; target: HelpNavigationTarget }> = [
    { label: 'Choose an agent', done: hasAgent, target: 'recruit' },
    { label: 'Choose its model', done: hasModel, target: 'agent-editor-model' },
    { label: 'Add an agent to your team', done: hasParty, target: 'agents' },
    { label: 'Send a first message', done: complete, target: 'command-console' },
  ]
  return <details className="dui-first-success" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Setup guide <span>{complete ? 'First response received' : `${steps.filter((step) => step.done).length} of 4 ready`}</span></summary>
    <ol>{steps.map((step) => <li key={step.label} data-complete={step.done ? 'true' : 'false'}>
      <span aria-hidden="true">{step.done ? '✓' : '○'}</span><span className="sr-only">{step.done ? 'Complete: ' : 'Next: '}</span>
      <Button variant="quiet" size="compact" onClick={() => onNavigate(step.target)}>{step.label}</Button>
    </li>)}</ol>
    <div className="mt-2 flex flex-wrap items-center gap-3"><span className="text-sm text-slate-400">Try: “Introduce yourself and suggest one task you can help with.”</span>
      <Button size="compact" variant="quiet" onClick={() => { setOpen(false); if (!complete) { savePreferenceEntries([[KEY, 'dismissed']]) } }}>Hide guide</Button>
    </div>
  </details>
}
