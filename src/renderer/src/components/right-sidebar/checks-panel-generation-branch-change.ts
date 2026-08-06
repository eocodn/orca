import { useCallback } from 'react'
import type { PullRequestGenerationContext } from '@/store/slices/pull-request-generation'
import { markPullRequestGenerationRequiresPushBeforeCreate } from '@/store/slices/pull-request-generation'

export function useChecksPanelGenerationBranchChange(args: {
  fetchUpstreamStatus: (
    worktreeId: string,
    worktreePath: string,
    connectionId?: string,
    branch?: string,
    options?: { runtimeTargetSettings?: unknown }
  ) => Promise<unknown>
  updatePullRequestGenerationRecord: (key: string, updater: (record: unknown) => unknown) => void
}) {
  return useCallback(
    async (generationKey: string, context: PullRequestGenerationContext): Promise<void> => {
      if (!context.worktreeId || !context.worktreePath) {
        return
      }
      args.updatePullRequestGenerationRecord(generationKey, (record) =>
        markPullRequestGenerationRequiresPushBeforeCreate({
          record,
          requestId: context.requestId
        })
      )
      try {
        await args.fetchUpstreamStatus(
          context.worktreeId,
          context.worktreePath,
          context.connectionId,
          undefined,
          { runtimeTargetSettings: context.runtimeTargetSettings }
        )
      } catch (error) {
        console.warn('[ChecksPanel] post-generation upstream refresh failed', error)
      }
    },
    [args]
  )
}
