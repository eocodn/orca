import React from 'react'
import { GitPullRequest } from 'lucide-react'
import type { PRInfo } from '../../../../shared/types'

export const PullRequestIcon = GitPullRequest

export { CHECK_ICON, CHECK_COLOR } from './checks-panel-checks-list'
export {
  buildMergeabilityRecalculationCommands,
  ConflictingFilesSection,
  MergeConflictNotice,
  PRTriageStrip,
  ConflictTriageStrip
} from './checks-panel-conflict-surface'
export { ChecksList, getFailedChecksForDetails } from './checks-panel-checks-list'
export { PRCommentsList } from './checks-panel-comments-list'
export { isMutablePRConversationComment } from './checks-panel-comment-actions'
export { CheckJobLogTail } from './check-job-log-tail'

export function prStateColor(state: PRInfo['state']): string {
  switch (state) {
    case 'merged':
      return 'bg-purple-500/15 text-purple-500 border-purple-500/20'
    case 'open':
      return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20'
    case 'closed':
      return 'bg-destructive/10 text-destructive border-destructive/20'
    case 'draft':
      return 'bg-muted text-muted-foreground/70 border-border'
  }
}
