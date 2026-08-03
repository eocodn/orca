import { z } from 'zod'

import {
  defineMethod,
  type RpcAnyMethod
} from '../core'






















import {
  TerminalUnsubscribe,
  TerminalSetAutoRestoreFit
} from './terminal-schemas'

export const TERMINAL_TAIL_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'terminal.unsubscribe',
    params: TerminalUnsubscribe,
    handler: async (params, { runtime }) => {
      // Why: older builds send a bare-handle subscriptionId, so also try the reconstructed `${terminal}:${clientId}` composite key.
      runtime.cleanupSubscription(params.subscriptionId)
      if (params.client && !params.subscriptionId.includes(':')) {
        runtime.cleanupSubscription(`${params.subscriptionId}:${params.client.id}`)
      }
      return { unsubscribed: true }
    }
  }),
  defineMethod({
    name: 'terminal.getAutoRestoreFit',
    params: z.object({}),
    handler: async (_params, { runtime }) => ({
      ms: runtime.getMobileAutoRestoreFitMs()
    })
  }),
  defineMethod({
    name: 'terminal.setAutoRestoreFit',
    params: TerminalSetAutoRestoreFit,
    handler: async (params, { runtime }) => ({
      ms: runtime.setMobileAutoRestoreFitMs(params.ms)
    })
  })
]
