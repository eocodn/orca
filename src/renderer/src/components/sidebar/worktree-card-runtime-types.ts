import type { AppState } from '@/store/types'
import type { WorktreeCardProperty } from '../../../../shared/types'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import type { selectRuntimeAwareSshStatus } from '@/store/slices/runtime-environment-ssh'
import type { parseExecutionHostId } from '../../../../shared/execution-host'
import type { useWorktreeAgentRows } from './useWorktreeAgentRows'
import type { useWorktreeCardDetailsHoverControl } from './worktree-card-details-hover-state'
import type { useWorktreeCardMetadata } from './worktree-card-metadata'

export type WorktreeCardRuntime = {
  settings: AppState['settings']
  cardProps: readonly WorktreeCardProperty[]
  agentActivityDisplayMode: AppState['agentActivityDisplayMode']
  projectGroups: AppState['projectGroups']
  newCardStyle: boolean
  compactCards: boolean
  deleteState: AppState['deleteStateByWorktreeId'][string] | undefined
  conflictOperation: AppState['gitConflictOperationByWorktree'][string]
  remoteBranchConflict: AppState['remoteBranchConflictByWorktreeId'][string] | undefined
  workspacePorts: WorkspacePort[]
  sshStatus: ReturnType<typeof selectRuntimeAwareSshStatus>
  sshTargetLabel: string
  sshOwnerEnvironmentId: string | null
  isSshDisconnected: boolean
  activeViewIsTerminal: boolean
  runtimeOwnerEnvironmentId: string | null
  parsedRepoHost: ReturnType<typeof parseExecutionHostId>
  runtimeHostLabel: string | null
  isRuntimeDisconnected: boolean
  showDisconnectedDialog: boolean
  setShowDisconnectedDialog: (value: boolean) => void
  titleRenaming: boolean
  setTitleRenaming: (value: boolean) => void
  showRenameErrorDialog: boolean
  setShowRenameErrorDialog: (value: boolean) => void
  detailsHoverControl: ReturnType<typeof useWorktreeCardDetailsHoverControl>
  hoverDetailsOpen: boolean
  deleteModifierPressed: boolean
  metadata: ReturnType<typeof useWorktreeCardMetadata>
  showStatus: boolean
  showIssue: boolean
  showLinearIssue: boolean
  showJiraIssue: boolean
  showPR: boolean
  showAutomation: boolean
  showCli: boolean
  showComment: boolean
  showPorts: boolean
  shouldRefreshHostedReview: boolean
  showInlineAgentList: boolean
  compactInlineAgentRows: ReturnType<typeof useWorktreeAgentRows>
  compactInlineAgentRowsVisible: boolean
  showAggregateCacheTimer: boolean
  cacheStartedAt: number | null | undefined
  cacheTtlMs: number
  folderWorkspaceId: string | null
  isFolder: boolean
  isDeleting: boolean
  isQueuedForDeletion: boolean
  showDeleteQuickAction: boolean
  showUnreadEmphasis: boolean
  showPinnedRepoIcon: boolean
  showRepoIdentityInTitle: boolean
  showInlineRepoBadge: boolean
  showRepoBadgeInMetaRow: boolean
  showHostContextBadge: boolean
  showDetachedHeadInMetaRow: boolean
  showBranch: boolean
  showConflictOperationBadge: boolean
  showUnreadQuickAction: boolean
  showCombinedStatusSlot: boolean
  showTitleRowPrimary: boolean
  showMetaRowDetails: boolean
  showTitleRowIndicators: boolean
}
