export * from './github-ipc-foundation'
import { registerGitHubAuthHandlers } from './github-auth-ipc-handlers'
import { registerGitHubProjectHandlers } from './github-project-ipc-handlers'
import { registerGitHubRepositoryHandlers } from './github-repository-ipc-handlers'
import { registerGitHubReviewHandlers } from './github-review-ipc-handlers'
import { registerGitHubWorkItemHandlers } from './github-work-item-ipc-handlers'
import type { StatsCollector } from '../stats/collector'
import type { Store } from '../persistence'

export function registerGitHubHandlers(store: Store, stats: StatsCollector): void {
  registerGitHubWorkItemHandlers(store, stats)
  registerGitHubRepositoryHandlers(store, stats)
  registerGitHubReviewHandlers(store, stats)
  registerGitHubAuthHandlers(store, stats)
  registerGitHubProjectHandlers(store, stats)
}
