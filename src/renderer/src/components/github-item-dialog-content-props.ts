import type React from 'react'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  GitHubAssignableUser,
  GitHubIssueTimelineItem,
  GitHubOwnerRepo,
  GitHubPRFile,
  GitHubWorkItem,
  GitHubWorkItemDetails,
  PRCheckDetail,
  PRComment
} from '../../../shared/types'
import type {
  GitHubItemDialogProjectOrigin,
  ItemDialogTab
} from './github-item-dialog-model'

export type GitHubItemDialogContentProps = {
  workItem: GitHubWorkItem
  isIssuePage: boolean
  ownerRepo: GitHubOwnerRepo | null
  issueStateBadgeTone: string
  localState: GitHubWorkItem['state']
  localLabels: string[]
  linkCopied: boolean
  backLabel: string
  issueAttachedWorkspace: { id: string } | null
  issueAttachedWorkspaceLabel: string | null
  effectiveRepoId: string | null
  repoPath: string | null
  projectOrigin?: GitHubItemDialogProjectOrigin
  sourceContext?: TaskSourceContext | null
  canUseDetailsRepoContext: boolean
  details: GitHubWorkItemDetails | null
  displayWorkItem: GitHubWorkItem | null
  body: string
  comments: PRComment[]
  timelineItems: GitHubIssueTimelineItem[]
  files: GitHubPRFile[]
  checks: PRCheckDetail[]
  headSha: string | undefined
  baseSha: string | undefined
  loading: boolean
  detailsLoaded: boolean
  filesUnavailable: boolean
  pendingViewedPaths: Set<string>
  detailsCacheKey: string | null
  error: string | null
  tab: ItemDialogTab
  setTab: (tab: ItemDialogTab) => void
  setLinkCopyButtonRef: React.RefCallback<HTMLButtonElement>
  handleCopyWorkItemLink: () => Promise<void>
  handleOpenOrUseIssueWorkspace: (item: GitHubWorkItem) => void
  onUse: (item: GitHubWorkItem) => void
  onClose: () => void
  setLocalState: (state: GitHubWorkItem['state']) => void
  setLocalLabels: (labels: string[]) => void
  invalidateCurrentDetailsCache: () => void
  appendOptimisticComment: (comment: PRComment) => void
  handlePRFileViewedChange: (path: string, viewed: boolean) => Promise<boolean>
  onReviewRequestsChange?: (
    itemKey: { id: string; repoId: string },
    reviewRequests: GitHubAssignableUser[]
  ) => void
}
