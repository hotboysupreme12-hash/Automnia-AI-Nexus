import { useEffect, useRef } from 'react'
import { apiRequest, apiErrorMessage } from '../../api/client'
import { isUploadResponse } from '../../api/responseValidation'
import { useNexusStore } from '../../store/nexusStore'
import type { AgentTurnAttachment } from '../../types/nexus'
import { compressAttachmentImage } from '../monitor/attachmentImage'
import { buildAgentAttachmentMessage } from '../../utils/agentAttachmentMessage'
import { publishCursorAgentStatus, readCursorAgentSettings } from './cursorAgentSettings'

type UploadPayload = { attachment: AgentTurnAttachment }

async function uploadQuickAttachment(input: { name: string; mimeType: string; size: number; data: ArrayBuffer }): Promise<AgentTurnAttachment> {
  const file = new File([input.data], input.name, { type: input.mimeType || 'application/octet-stream' })
  const controller = new AbortController()
  const uploadFile = await compressAttachmentImage(file, controller.signal)
  if (uploadFile.type.startsWith('image/') && uploadFile.size > 6 * 1024 * 1024) {
    throw new Error(`${input.name} is too large to send as an image. Resize it and try again.`)
  }
  if (uploadFile.size > 18 * 1024 * 1024) throw new Error(`${input.name} is too large to send. Choose a file under 18 MB.`)
  const result = await apiRequest<UploadPayload>(`/api/files/upload?name=${encodeURIComponent(uploadFile.name)}&mimeType=${encodeURIComponent(uploadFile.type || 'application/octet-stream')}`, {
    validate: isUploadResponse,
    method: 'POST',
    timeoutMs: 90_000,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Type': uploadFile.type || 'application/octet-stream',
    },
    body: uploadFile,
  })
  if (!result.ok) throw new Error(apiErrorMessage(result.error))
  return result.data.attachment
}

export function CursorAgentRuntime() {
  const agents = useNexusStore((state) => state.agents)
  const sendPromptToAgent = useNexusStore((state) => state.sendPromptToAgent)
  const lastAppliedSettingsKey = useRef('')

  useEffect(() => () => {
    void window.automniaDesktop?.cursorAgent?.setSettings({ enabled: false, agentId: '', includeClipboard: false })
  }, [])

  useEffect(() => {
    const desktop = window.automniaDesktop
    const quickAgent = desktop?.quickAgentRuntime
    if (!quickAgent) {
      if (desktop && !desktop.cursorAgent) {
        publishCursorAgentStatus('Restart Automnia to finish applying the Cursor Agent update.')
      }
      return
    }
    const settings = readCursorAgentSettings()
    const selectedAgent = agents.find((agent) => agent.id === settings.agentId)
    if (!desktop.cursorAgent) {
      publishCursorAgentStatus('Restart Automnia to finish applying the Cursor Agent update.')
    } else {
      const nextSettings = {
        ...settings,
        enabled: settings.enabled && Boolean(selectedAgent),
        agentName: selectedAgent?.name || '',
      }
      const settingsKey = JSON.stringify(nextSettings)
      if (lastAppliedSettingsKey.current !== settingsKey) {
        lastAppliedSettingsKey.current = settingsKey
        void desktop.cursorAgent.setSettings(nextSettings).then((status) => {
          publishCursorAgentStatus(status.message || (status.enabled
            ? 'Ready. Hide Automnia, then double-click the pointer mark to open quick chat.'
            : settings.enabled && !selectedAgent
              ? 'The saved agent is unavailable. Choose another agent in Settings.'
              : 'Cursor agent is off.'))
        }).catch((error: unknown) => {
          publishCursorAgentStatus(error instanceof Error ? error.message : 'System-wide pointer access could not start.')
        })
      }
    }

    return quickAgent.onSubmit((request) => {
      void (async () => {
        try {
          const agent = agents.find((entry) => entry.id === request.agentId)
          if (!agent) throw new Error('The selected agent is no longer available. Choose another agent in Settings.')
          const uploaded: AgentTurnAttachment[] = []
          for (const attachment of request.attachments) uploaded.push(await uploadQuickAttachment(attachment))
          if (uploaded.some((attachment) => attachment.delivery === 'workspace')) throw new Error('An attachment is too large for direct delivery. Resize it and try again.')
          if (uploaded.reduce((total, attachment) => total + attachment.size, 0) > 18 * 1024 * 1024) {
            throw new Error('Attachments exceed the combined 18 MB limit after processing. Send them separately.')
          }
          if (!useNexusStore.getState().agents.some((entry) => entry.id === agent.id)) throw new Error('The selected agent is no longer available. Choose another agent in Settings.')
          const parts = [request.prompt.trim()]
          if (request.clipboardText) parts.push(`Copied clipboard text:\n${request.clipboardText}`)
          const base = parts.filter(Boolean).join('\n\n') || 'Please help me with this content.'
          const message = buildAgentAttachmentMessage(base, uploaded)
          const dispatch = sendPromptToAgent(agent.id, message, uploaded, undefined, base)
          // The store promise resolves after the agent turn finishes. The quick
          // composer only needs to wait until the message has been handed off.
          quickAgent.complete(request.requestId, { ok: true })
          void dispatch.catch((error: unknown) => {
            publishCursorAgentStatus(error instanceof Error
              ? `Cursor Agent message failed: ${error.message}`
              : 'Cursor Agent message failed after it was queued.')
          })
        } catch (error) {
          quickAgent.complete(request.requestId, {
            ok: false,
            message: error instanceof Error ? error.message : 'The request could not be sent to the selected agent.',
          })
        }
      })()
    })
  }, [agents, sendPromptToAgent])

  return null
}
