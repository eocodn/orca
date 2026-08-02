import type { Store } from '../persistence'
import type { StatsCollector } from '../stats/collector'
import { registerGitHubReviewQueryHandlers } from './github-review-query-ipc-handlers'
import { registerGitHubReviewMutationHandlers } from './github-review-mutation-ipc-handlers'

export function registerGitHubReviewHandlers(store: Store, stats: StatsCollector): void {
  registerGitHubReviewQueryHandlers(store, stats)
  registerGitHubReviewMutationHandlers(store, stats)
}
