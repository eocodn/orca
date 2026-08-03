import { defineMethod, type RpcMethod } from '../core'
import { ORCHESTRATION_LEGACY_RUN_ID } from '../../../../shared/orchestration-rpc-contract'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { ReplyParams, resolveRunScope } from './orchestration-support'

export const ORCHESTRATION_REPLY_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.reply',
    params: ReplyParams,
    handler: async (params, { runtime, legacyCoordinatorRunId }) => {
      const db = runtime.getOrchestrationDb()
      const original = db.getMessageById(params.id)
      if (!original) {
        throw new Error(`Message not found: ${params.id}`)
      }
      if (
        legacyCoordinatorRunId &&
        (original.run_id !== legacyCoordinatorRunId ||
          (params.run !== undefined && params.run !== legacyCoordinatorRunId))
      ) {
        throw new OrchestrationError(
          'request_mismatch',
          `Message ${params.id} does not belong to this adopted Run.`,
          { effectsApplied: false }
        )
      }
      if (
        original.run_id === ORCHESTRATION_LEGACY_RUN_ID ||
        original.delivery_contract === 'legacy_direct' ||
        original.delivery_contract === 'audit_only'
      ) {
        throw new OrchestrationError(
          'legacy_read_only',
          'Legacy orchestration messages are inspect-only; no reply was applied.',
          { effectsApplied: false }
        )
      }

      const question = db.getQuestion(params.id)
      if (question) {
        const run = resolveRunScope(runtime, {
          runId: params.run ?? question.run_id,
          callerTerminalHandle: params.from,
          requireCurrentConsumer: true,
          legacyCoordinatorRunId
        })
        const answered = db.answerQuestion({
          messageId: question.message_id,
          runId: run.id,
          consumerGeneration: run.consumer_generation,
          body: params.body
        })
        const federated = db.getFederatedDispatch(question.dispatch_id)
        if (federated) {
          db.enqueueFederationRelay({
            dispatchId: question.dispatch_id,
            direction: 'to_worker',
            kind: 'reply',
            payload: JSON.stringify({
              questionId: question.message_id,
              answerMessageId: answered.message.id,
              body: params.body
            })
          })
          runtime.ensureOrchestrationFederationRelay(run.id)
        } else {
          runtime.notifyMessageArrived(`dispatch:${question.dispatch_id}`, 'status')
        }
        return {
          message: answered.message,
          question: answered.question,
          duplicate: answered.duplicate
        }
      }

      db.markAsRead([original.id])

      const reply = db.insertMessage({
        from: params.from ?? original.to_handle,
        to: original.from_handle,
        subject: `Re: ${original.subject}`,
        body: params.body,
        threadId: original.thread_id ?? original.id,
        runId: original.run_id
      })

      runtime.notifyMessageArrived(original.from_handle, reply.type)
      return { message: reply }
    }
  }),

]
