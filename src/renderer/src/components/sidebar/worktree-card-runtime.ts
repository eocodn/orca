import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE } from '../../../../shared/constants'
import {
  isRuntimeOwnedSshTargetId,
  parseExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { getExplicitRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  selectRuntimeAwareSshStatus,
  selectRuntimeAwareSshTargetLabel
} from '@/store/slices/runtime-environment-ssh'
import { hydrateRuntimeEnvironmentSshState } from '@/runtime/runtime-environment-ssh-state'
import { getWorkspacePortsByWorktreeId } from '@/lib/workspace-port-groups'
import { usePromptCacheCountdownStartedAt } from './CacheTimer'
import { useWorktreeAgentRows } from './useWorktreeAgentRows'
import { useWorktreeCardDetailsHoverControl } from './worktree-card-details-hover-state'
import {
  canShowWorkspaceDeleteQuickAction,
  useWorkspaceDeleteModifierPressed
} from './workspace-delete-quick-action'
import { hasWorktreeCardDetails } from './WorktreeCardMeta'
import { useWorktreeCardMetadata } from './worktree-card-metadata'
import { EMPTY_WORKSPACE_PORTS } from './worktree-card-model'
import type { WorktreeCardProps } from './worktree-card-model'
import type { WorktreeCardRuntime } from './worktree-card-runtime-types'

export function useWorktreeCardRuntime(
  props: Pick<
    WorktreeCardProps,
    | 'worktree'
    | 'repo'
    | 'hostContextLabel'
    | 'hideRepoBadge'
    | 'inPinnedSection'
    | 'affiliateListMode'
  >
): WorktreeCardRuntime {
  const {
    worktree,
    repo,
    hostContextLabel,
    hideRepoBadge,
    inPinnedSection = false,
    affiliateListMode = false
  } = props
  const settings = useAppStore((s) => s.settings)
  const cardProps = useAppStore((s) => s.worktreeCardProperties)
  const agentActivityDisplayMode =
    useAppStore((s) => s.agentActivityDisplayMode) ?? DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE
  const projectGroups = useAppStore((s) => s.projectGroups)
  const newCardStyle = settings?.experimentalNewWorktreeCardStyle === true
  const compactCards = !newCardStyle && settings?.compactWorktreeCards === true
  const deleteState = useAppStore((s) => s.deleteStateByWorktreeId[worktree.id])
  const conflictOperation = useAppStore((s) => s.gitConflictOperationByWorktree[worktree.id])
  const remoteBranchConflict = useAppStore((s) => s.remoteBranchConflictByWorktreeId[worktree.id])
  const workspacePorts = useAppStore(
    (s) =>
      getWorkspacePortsByWorktreeId(s.workspacePortScan?.result).get(worktree.id) ??
      EMPTY_WORKSPACE_PORTS
  )
  const sshOwnerEnvironmentId = useAppStore((s) =>
    repo?.connectionId ? getExplicitRuntimeEnvironmentIdForWorktree(s, worktree.id) : null
  )
  const sshStatus = useAppStore((s) => {
    if (!repo?.connectionId || isRuntimeOwnedSshTargetId(repo.connectionId)) {
      return null
    }
    return selectRuntimeAwareSshStatus(s, sshOwnerEnvironmentId, repo.connectionId)
  })
  useEffect(() => {
    if (sshOwnerEnvironmentId) {
      void hydrateRuntimeEnvironmentSshState(sshOwnerEnvironmentId).catch(() => {})
    }
  }, [sshOwnerEnvironmentId])
  const isSshDisconnected = sshStatus != null && sshStatus !== 'connected'
  const activeViewIsTerminal = useAppStore(
    (s) => (s.activeTabTypeByWorktree?.[worktree.id] ?? 'terminal') === 'terminal'
  )
  const parsedRepoHost = parseExecutionHostId(repo?.executionHostId)
  const runtimeOwnerEnvironmentId =
    worktree.runtimeOwnerEnvironmentId ??
    (parsedRepoHost?.kind === 'runtime' ? parsedRepoHost.environmentId : null)
  const runtimeHostId = runtimeOwnerEnvironmentId
    ? toRuntimeExecutionHostId(runtimeOwnerEnvironmentId)
    : null
  const runtimeEnvironmentName = useAppStore((s) =>
    runtimeOwnerEnvironmentId
      ? (s.runtimeEnvironments.find((environment) => environment.id === runtimeOwnerEnvironmentId)
          ?.name ?? null)
      : null
  )
  const runtimeHostLabel = runtimeHostId
    ? (getHostDisplayLabelOverrides(settings).get(runtimeHostId) ?? runtimeEnvironmentName)
    : null
  const isRuntimeDisconnected = useAppStore((s) =>
    runtimeOwnerEnvironmentId
      ? !s.runtimeStatusByEnvironmentId.get(runtimeOwnerEnvironmentId)?.status
      : false
  )
  const [showDisconnectedDialog, setShowDisconnectedDialog] = useState(false)
  const [titleRenaming, setTitleRenaming] = useState(false)
  const [showRenameErrorDialog, setShowRenameErrorDialog] = useState(false)
  const sshTargetLabel = useAppStore((s) =>
    repo?.connectionId
      ? selectRuntimeAwareSshTargetLabel(s, sshOwnerEnvironmentId, repo.connectionId)
      : ''
  )
  const metadata = useWorktreeCardMetadata({
    worktree,
    repo,
    settings,
    cardProps,
    projectGroups,
    newCardStyle
  })
  const { folderWorkspaceId, isFolder } = metadata
  const showStatus = cardProps.includes('status')
  const showIssue = cardProps.includes('issue')
  const showLinearIssue = cardProps.includes('linear-issue')
  const showJiraIssue = cardProps.includes('jira-issue')
  const showPR = cardProps.includes('pr')
  const showCli = cardProps.includes('cli')
  const showComment = cardProps.includes('comment')
  const showPorts = cardProps.includes('ports')
  const shouldRefreshHostedReview = newCardStyle ? showStatus : showPR
  const detailsHoverControl = useWorktreeCardDetailsHoverControl()
  const deleteModifierPressed = useWorkspaceDeleteModifierPressed()
  const showInlineAgentList = cardProps.includes('inline-agents') && (newCardStyle || !compactCards)
  const compactInlineAgentRows = useWorktreeAgentRows(
    worktree.id,
    showInlineAgentList && agentActivityDisplayMode === 'compact'
  )
  const compactInlineAgentRowsVisible =
    showInlineAgentList &&
    agentActivityDisplayMode === 'compact' &&
    compactInlineAgentRows.length > 0
  const showAggregateCacheTimer = !compactCards && !compactInlineAgentRowsVisible
  const cacheStartedAt = usePromptCacheCountdownStartedAt(worktree.id, showAggregateCacheTimer)
  const cacheTtlMs = useAppStore((s) =>
    showAggregateCacheTimer ? (s.settings?.promptCacheTtlMs ?? 0) : 0
  )
  const isDeleting = deleteState?.isDeleting ?? false
  const isQueuedForDeletion = deleteState?.phase === 'queued'
  const showDeleteQuickAction =
    !affiliateListMode &&
    canShowWorkspaceDeleteQuickAction({
      deleteModifierPressed,
      isDeleting,
      isMainWorktree: worktree.isMainWorktree
    })
  const showUnreadEmphasis = showStatus && worktree.isUnread
  const showPinnedRepoIcon = inPinnedSection && !!repo
  const showRepoIdentityInTitle = newCardStyle || compactCards
  const showInlineRepoBadge =
    showRepoIdentityInTitle && !!repo && !hideRepoBadge && !isFolder && !showPinnedRepoIcon
  const showRepoBadgeInMetaRow =
    !showRepoIdentityInTitle && !!repo && !hideRepoBadge && !showPinnedRepoIcon
  const showHostContextBadge = !compactCards && !!hostContextLabel
  const showDetachedHeadInMetaRow =
    !compactCards && !isFolder && metadata.detachedHeadDisplay !== null
  const showBranch =
    !isFolder &&
    metadata.branch.length > 0 &&
    !newCardStyle &&
    (!compactCards || metadata.branch !== worktree.displayName)
  const showConflictOperationBadge =
    !!conflictOperation && conflictOperation !== 'unknown' && conflictOperation !== 'rebase'
  const showUnreadQuickAction = !affiliateListMode && showStatus && !newCardStyle
  const showCombinedStatusSlot = showStatus
  const showTitleRowPrimary = compactCards && worktree.isMainWorktree && !isFolder
  const hasDetails = hasWorktreeCardDetails({
    issue: showIssue ? metadata.issueDisplay : null,
    linearIssue: showLinearIssue ? metadata.linearIssueDisplay : null,
    jiraIssue: showJiraIssue ? metadata.jiraIssueDisplay : null,
    review: newCardStyle ? null : showPR ? metadata.prDisplay : null,
    comment: showComment ? worktree.comment : null,
    cliProvenance: showCli ? worktree.cliProvenance : null
  })
  const hasPorts = showPorts && workspacePorts.length > 0
  const showMetaRowDetails = !newCardStyle && !compactCards && (hasDetails || hasPorts)
  const showTitleRowIndicators = (newCardStyle || compactCards) && (hasDetails || hasPorts)
  return {
    settings,
    cardProps,
    agentActivityDisplayMode,
    projectGroups,
    newCardStyle,
    compactCards,
    deleteState,
    conflictOperation,
    remoteBranchConflict,
    workspacePorts,
    sshStatus,
    sshTargetLabel,
    sshOwnerEnvironmentId,
    isSshDisconnected,
    activeViewIsTerminal,
    runtimeOwnerEnvironmentId,
    parsedRepoHost,
    runtimeHostLabel,
    isRuntimeDisconnected,
    showDisconnectedDialog,
    setShowDisconnectedDialog,
    titleRenaming,
    setTitleRenaming,
    showRenameErrorDialog,
    setShowRenameErrorDialog,
    detailsHoverControl,
    hoverDetailsOpen: detailsHoverControl.hoverOpen,
    deleteModifierPressed,
    metadata,
    showStatus,
    showIssue,
    showLinearIssue,
    showJiraIssue,
    showPR,
    showCli,
    showComment,
    showPorts,
    shouldRefreshHostedReview,
    showInlineAgentList,
    compactInlineAgentRows,
    compactInlineAgentRowsVisible,
    showAggregateCacheTimer,
    cacheStartedAt,
    cacheTtlMs,
    folderWorkspaceId,
    isFolder,
    isDeleting,
    isQueuedForDeletion,
    showDeleteQuickAction,
    showUnreadEmphasis,
    showPinnedRepoIcon,
    showRepoIdentityInTitle,
    showInlineRepoBadge,
    showRepoBadgeInMetaRow,
    showHostContextBadge,
    showDetachedHeadInMetaRow,
    showBranch,
    showConflictOperationBadge,
    showUnreadQuickAction,
    showCombinedStatusSlot,
    showTitleRowPrimary,
    showMetaRowDetails,
    showTitleRowIndicators
  }
}
