import { useChecksPanelCommentFetch } from './checks-panel-comment-fetch'
import { useChecksPanelRefresh } from './checks-panel-refresh-controller'
import { useChecksPanelEntryRefresh } from './checks-panel-entry-refresh'
import type { PRCheckDetail, PRInfo } from '../../../../shared/types'

export type ChecksPanelRuntimeReviewEffectsArgs = {
  comments: Parameters<typeof useChecksPanelCommentFetch>[0]
  refresh: Parameters<typeof useChecksPanelRefresh>[0]
  entry: Parameters<typeof useChecksPanelEntryRefresh>[0]
}

export function useChecksPanelRuntimeReviewEffects(args: ChecksPanelRuntimeReviewEffectsArgs): {
  fetchComments: (options?: {
    force?: boolean
    prNumberOverride?: number | null
    prRepoOverride?: PRInfo['prRepo'] | null
  }) => Promise<void>
  handleLoadCheckDetails: (check: PRCheckDetail) => Promise<unknown>
  handleRefresh: () => Promise<void>
  handleEntryRefresh: (options: { refreshChecks: boolean; refreshComments: boolean }) => void
} {
  const { fetchComments, handleLoadCheckDetails } = useChecksPanelCommentFetch(args.comments) as {
    fetchComments: (options?: {
      force?: boolean
      prNumberOverride?: number | null
      prRepoOverride?: PRInfo['prRepo'] | null
    }) => Promise<void>
    handleLoadCheckDetails: (check: PRCheckDetail) => Promise<unknown>
  }
  const handleRefresh = useChecksPanelRefresh(args.refresh) as () => Promise<void>
  const { handleEntryRefresh } = useChecksPanelEntryRefresh({
    ...args.entry,
    fetchComments
  }) as {
    handleEntryRefresh: (options: { refreshChecks: boolean; refreshComments: boolean }) => void
  }
  return { fetchComments, handleLoadCheckDetails, handleRefresh, handleEntryRefresh }
}
