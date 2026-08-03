import { defineMethod, type RpcMethod } from '../core'
import { InboxParams } from './orchestration-support'

export const ORCHESTRATION_INBOX_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.inbox',
    params: InboxParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      // Why: stale/unknown handles return empty rather than error — historical rows survive handle deletion (design doc §3.3).
      const messages = params.terminal
        ? db.getAllMessagesForHandle(params.terminal, params.limit)
        : db.getInbox(params.limit)
      return { messages, count: messages.length }
    }
  }),

]
