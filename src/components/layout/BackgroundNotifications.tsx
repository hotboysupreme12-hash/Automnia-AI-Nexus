import { useEffect } from 'react'
import { useNexusStore } from '../../store/nexusStore'
import { readPreferenceValue } from '../settings/preferenceStorage'

export function BackgroundNotifications() {
  useEffect(() => {
    const running = new Set<string>()
    for (const entry of useNexusStore.getState().agentResponses) if (entry.streaming) running.add(entry.id)
    const notifications = new Set<Notification>()
    const unsubscribe = useNexusStore.subscribe((state, previous) => {
      if (state.agentResponses === previous.agentResponses) return
      const currentIds = new Set(state.agentResponses.map((entry) => entry.id))
      for (const id of running) if (!currentIds.has(id)) running.delete(id)
      for (const entry of state.agentResponses) {
        if (entry.streaming) { running.add(entry.id); continue }
        if (!running.delete(entry.id) || !document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted' || readPreferenceValue('automnia-background-notifications-v1') !== 'on') continue
        const name = state.agents.find((agent) => agent.id === entry.agentId)?.name || 'Your agent'
        try {
          const notification = new Notification(entry.ok ? `${name} finished responding` : `${name} needs attention`, { body: entry.ok ? 'Your response is ready in Automnia.' : 'Open Automnia to review the response status.', tag: `automnia-response-${entry.id}` })
          notifications.add(notification)
          notification.onclose = () => notifications.delete(notification)
          notification.onclick = () => { window.focus(); useNexusStore.getState().setTab('agents'); notification.close() }
          // Keep long sessions bounded even when the OS never emits close.
          if (notifications.size > 20) { const oldest = notifications.values().next().value; oldest?.close(); if (oldest) notifications.delete(oldest) }
        } catch { /* Notification delivery is optional and must not interrupt a response. */ }
      }
    })
    return () => { unsubscribe(); for (const notification of notifications) notification.close() }
  }, [])
  return null
}
