import type { Express } from 'express'
import { apiFailure, apiSuccess } from '../controlPlaneHttp'
import type { ChannelDeliveryStatus } from '../services/channels/channelDeliveryStatusService'

export type ChannelDeliveryRoutesOptions = {
  getChannelDeliveryStatus: () => Promise<ChannelDeliveryStatus>
}

export function registerChannelDeliveryRoutes(app: Express, options: ChannelDeliveryRoutesOptions) {
  app.get('/api/openclaw/channel-delivery/status', async (_req, res) => {
    try {
      return apiSuccess(res, await options.getChannelDeliveryStatus())
    } catch {
      return apiFailure(res, 500, 'openclaw_command_failed', 'Could not check channel status. Try again shortly.')
    }
  })
}
