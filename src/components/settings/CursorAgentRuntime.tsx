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
            ? 'Ready. Hide Automnia to show the pointer mark and right-click bubble.'
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
          const parts = [request.prompt.trim()]
          if (request.clipboardText) parts.push(`Copied clipboard text:\n${request.clipboardText}`)
          const base = parts.filter(Boolean).join('\n\n') || 'Please help me with this content.'
          const message = buildAgentAttachmentMessage(base, uploaded)
          await sendPromptToAgent(agent.id, message, uploaded)
          quickAgent.complete(request.requestId, { ok: true })
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
