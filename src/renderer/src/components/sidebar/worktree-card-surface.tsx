import React, { useEffect, useCallback, useState } from 'react'
import { useAppStore } from '@/store'
import { LoaderCircle } from 'lucide-react'
import { usePromptCacheCountdownStartedAt } from './CacheTimer'
import WorktreeContextMenu from './WorktreeContextMenu'
import { SshDisconnectedDialog } from './SshDisconnectedDialog'
import { AutoRenameFailedDialog } from './AutoRenameFailedDialog'
import { useWorktreeAgentRows } from './useWorktreeAgentRows'
import { cn } from '@/lib/utils'
import { activateWorktreeFromSidebar } from '@/lib/sidebar-worktree-activation'
import type { GitHubWorkItem } from '../../../../shared/types'
import {
  WorktreeCardDetailsHover,
  hasWorktreeCardDetails,
  WorktreeCardMetaBadges
} from './WorktreeCardMeta'
import { WorktreeCardPortsDetails, WorktreeCardPortsTrigger } from './WorktreeCardPorts'
import { writeWorkspaceDragData } from './workspace-status'
import { isEventTargetInsideCurrentTarget } from './worktree-card-dom-events'
import { getWorkspacePortsByWorktreeId } from '@/lib/workspace-port-groups'
import { installWindowVisibilityInterval, isWindowVisible } from '@/lib/window-visibility-interval'
import { isMacAppDataPath } from '@/lib/passive-macos-app-data-access'
import { runWorktreeDelete } from './delete-worktree-flow'
import {
  canShowWorkspaceDeleteQuickAction,
  useWorkspaceDeleteModifierPressed
} from './workspace-delete-quick-action'
import { useWorktreeCardDetailsHoverControl } from './worktree-card-details-hover-state'
import {
  getFlushWorktreeCardPaddingLeft,
  getNewCardStyleParentContentMarginLeft
} from './worktree-list-indentation'
import { translate } from '@/i18n/i18n'
import { recordRendererCrashBreadcrumb } from '@/lib/crash-diagnostics'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  getRepoExecutionHostId,
  isRuntimeOwnedSshTargetId,
  parseExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE } from '../../../../shared/constants'
import { getExplicitRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  selectRuntimeAwareSshStatus,
  selectRuntimeAwareSshTargetLabel
} from '@/store/slices/runtime-environment-ssh'
import { hydrateRuntimeEnvironmentSshState } from '@/runtime/runtime-environment-ssh-state'
import { WorktreeCardContent } from './worktree-card-content'
import { useWorktreeCardMetadata } from './worktree-card-metadata'
import {
  EMPTY_WORKSPACE_PORTS,
  HOSTED_REVIEW_CARD_REFRESH_INTERVAL_MS,
  isWebClient
} from './worktree-card-model'
import type { WorktreeCardProps } from './worktree-card-model'
const WorktreeCardSurface = React.memo(function WorktreeCardSurface({
  worktree,
  repo,
  isActive,
  isActiveSurface = isActive,
  activeSurfaceVariant = 'primary',
  isMultiSelected = false,
  revealHighlight = false,
  revealHighlightTone = 'default',
  selectedWorktrees,
  onActivate,
  onImmediateActivate,
  onSelectionGesture,
  onContextMenuSelect,
  onAssignWorkspaceStatus,
  onCardDragStart,
  onCardDragEnd,
  nativeDragEnabled = true,
  hideRepoBadge,
  hostContextLabel,
  inPinnedSection = false,
  activationRowKey,
  renameRowKey,
  contentIndent = 0,
  flushSurface = false,
  lineageChildCount = 0,
  lineageCollapsed = false,
  lineageChildren,
  lineageChildrenStyle,
  onLineageToggle,
  isLineageDropTarget = false,
  affiliateListMode = false,
  statusPrDisplay = null
}: WorktreeCardProps) {
  const openModal = useAppStore((s) => s.openModal)
  const openTaskPage = useAppStore((s) => s.openTaskPage)
  const openAutomationsPage = useAppStore((s) => s.openAutomationsPage)
  const setPendingAutomationRunNavigation = useAppStore((s) => s.setPendingAutomationRunNavigation)
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)
  const deleteFolderWorkspace = useAppStore((s) => s.deleteFolderWorkspace)
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)
  const renamingWorktreeId = useAppStore((s) => s.renamingWorktreeId)
  const setRenamingWorktreeId = useAppStore((s) => s.setRenamingWorktreeId)
  const fetchHostedReviewForBranch = useAppStore((s) => s.fetchHostedReviewForBranch)
  const settings = useAppStore((s) => s.settings)
  const fetchIssue = useAppStore((s) => s.fetchIssue)
  const fetchLinearIssue = useAppStore((s) => s.fetchLinearIssue)
  const cardProps = useAppStore((s) => s.worktreeCardProperties)
  const agentActivityDisplayMode =
    useAppStore((s) => s.agentActivityDisplayMode) ?? DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE
  const projectGroups = useAppStore((s) => s.projectGroups)
  const newCardStyle = settings?.experimentalNewWorktreeCardStyle === true
  const compactCards = !newCardStyle && settings?.compactWorktreeCards === true
  const handleEditIssue = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      openModal('edit-meta', {
        worktreeId: worktree.id,
        currentDisplayName: worktree.displayName,
        currentIssue: worktree.linkedIssue,
        currentPR: worktree.linkedPR,
        currentComment: worktree.comment,
        focus: 'issue'
      })
    },
    [worktree, openModal]
  )

  const handleEditComment = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      openModal('edit-meta', {
        worktreeId: worktree.id,
        currentDisplayName: worktree.displayName,
        currentIssue: worktree.linkedIssue,
        currentPR: worktree.linkedPR,
        currentComment: worktree.comment,
        focus: 'comment'
      })
    },
    [worktree, openModal]
  )

  const handleOpenAutomation = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const automationId = worktree.automationProvenance?.automationId
      if (!automationId) {
        return
      }
      const hostId = worktree.automationProvenance?.hostId ?? worktree.hostId
      setPendingAutomationRunNavigation({
        automationId,
        runId: null,
        ...(hostId ? { hostId } : {})
      })
      openAutomationsPage()
    },
    [
      openAutomationsPage,
      setPendingAutomationRunNavigation,
      worktree.automationProvenance?.automationId,
      worktree.automationProvenance?.hostId,
      worktree.hostId
    ]
  )

  const handleOpenAutomationRun = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const provenance = worktree.automationProvenance
      if (!provenance) {
        return
      }
      const hostId = provenance.hostId ?? worktree.hostId
      setPendingAutomationRunNavigation({
        automationId: provenance.automationId,
        runId: provenance.automationRunId,
        ...(hostId ? { hostId } : {})
      })
      openAutomationsPage()
    },
    [
      openAutomationsPage,
      setPendingAutomationRunNavigation,
      worktree.automationProvenance,
      worktree.hostId
    ]
  )

  const deleteState = useAppStore((s) => s.deleteStateByWorktreeId[worktree.id])
  const conflictOperation = useAppStore((s) => s.gitConflictOperationByWorktree[worktree.id])
  const remoteBranchConflict = useAppStore((s) => s.remoteBranchConflictByWorktreeId[worktree.id])
  const workspacePorts = useAppStore(
    (s) =>
      getWorkspacePortsByWorktreeId(s.workspacePortScan?.result).get(worktree.id) ??
      EMPTY_WORKSPACE_PORTS
  )

  // SSH disconnected state
  const sshOwnerEnvironmentId = useAppStore((s) =>
    repo?.connectionId ? getExplicitRuntimeEnvironmentIdForWorktree(s, worktree.id) : null
  )
  const sshStatus = useAppStore((s) => {
    // Why: runtime-owned SSH targets suppress their ssh:state-changed broadcasts, so don't show a false "disconnected" chip for them.
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
  // Why: terminal views have their own reconnect overlay; reserve the blocking dialog for non-terminal views (default to terminal when ambiguous).
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
  // Why: runtime ("Orca server") hosts get the same disconnected dimming as SSH when their environment has no live status.
  const isRuntimeDisconnected = useAppStore((s) => {
    if (!runtimeOwnerEnvironmentId) {
      return false
    }
    return !s.runtimeStatusByEnvironmentId.get(runtimeOwnerEnvironmentId)?.status
  })
  // Why: the reconnect dialog blocks, so it never auto-shows for the active card (would steal app-wide focus); opens only on deliberate focus (handleClick).
  const [showDisconnectedDialog, setShowDisconnectedDialog] = useState(false)
  const [titleRenaming, setTitleRenaming] = useState(false)
  const [showRenameErrorDialog, setShowRenameErrorDialog] = useState(false)
  // Why: read the target label from its owning host's store instead of exposing HUB-private SSH metadata as client-local state.
  const sshTargetLabel = useAppStore((s) =>
    repo?.connectionId
      ? selectRuntimeAwareSshTargetLabel(s, sshOwnerEnvironmentId, repo.connectionId)
      : ''
  )

  const {
    detachedHeadDisplay,
    branch,
    folderWorkspaceId,
    isFolder,
    branchIdentityDisplay,
    identityDisplay,
    showIdentityInNewCard,
    folderMetaRowContent,
    hostedReviewCacheKey,
    issueCacheKey,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    cachedBranchFallbackGitHubPRNumber,
    prDisplay,
    issueDisplay,
    linearIssue,
    linearIssueDisplay,
    jiraIssueDisplay,
    visibleCardTitle
  } = useWorktreeCardMetadata({
    worktree,
    repo,
    settings,
    cardProps,
    projectGroups,
    newCardStyle
  })

  const isDeleting = deleteState?.isDeleting ?? false
  const isQueuedForDeletion = deleteState?.phase === 'queued'
  const deleteLabel = isQueuedForDeletion
    ? translate('auto.components.sidebar.WorktreeCard.ef18787206', 'Queued for deletion')
    : translate('auto.components.sidebar.WorktreeCard.691ccfd622', 'Deleting…')
  const showStatus = cardProps.includes('status')
  const showIssue = cardProps.includes('issue')
  const showLinearIssue = cardProps.includes('linear-issue')
  const showJiraIssue = cardProps.includes('jira-issue')
  const showPR = cardProps.includes('pr')
  const showAutomation = cardProps.includes('automation')
  const showCli = cardProps.includes('cli')
  const showComment = cardProps.includes('comment')
  const showPorts = cardProps.includes('ports')
  const shouldRefreshHostedReview = newCardStyle ? showStatus : showPR
  const detailsHoverControl = useWorktreeCardDetailsHoverControl()
  const hoverDetailsOpen = detailsHoverControl.hoverOpen
  const deleteModifierPressed = useWorkspaceDeleteModifierPressed()

  // Why: card surfaces are presentational, so skip hosted-review fetches when hidden to save rate-limit budget.
  useEffect(() => {
    // Why: paired web must not fan out per-card decoration RPCs during startup; host session/tab parity is critical.
    if (isWebClient()) {
      return
    }
    if (
      !repo ||
      isFolder ||
      worktree.isBare ||
      !hostedReviewCacheKey ||
      !shouldRefreshHostedReview ||
      isMacAppDataPath(repo.path)
    ) {
      return
    }
    const refreshHostedReview = (): void => {
      // Why: branch lookup is lossy for fork/deleted-head PRs; reuse a known PR number from explicit metadata when we have one.
      void fetchHostedReviewForBranch(repo.path, branch, {
        repoId: repo.id,
        linkedGitHubPR: worktree.linkedPR ?? null,
        ...(cachedBranchFallbackGitHubPRNumber !== null
          ? { fallbackGitHubPR: cachedBranchFallbackGitHubPRNumber }
          : {}),
        currentHeadOid: worktree.head ?? null,
        linkedGitLabMR,
        linkedBitbucketPR,
        linkedAzureDevOpsPR,
        linkedGiteaPR,
        staleWhileRevalidate: true
      })
    }
    // Why: PRs created outside Orca (e.g. `gh pr create`) emit no renderer event; poll visible cards to discover them.
    return installWindowVisibilityInterval({
      run: refreshHostedReview,
      intervalMs: HOSTED_REVIEW_CARD_REFRESH_INTERVAL_MS
    })
  }, [
    repo,
    isFolder,
    worktree.isBare,
    worktree.linkedPR,
    worktree.head,
    cachedBranchFallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    fetchHostedReviewForBranch,
    branch,
    hostedReviewCacheKey,
    shouldRefreshHostedReview
  ])

  useEffect(() => {
    if (
      !newCardStyle ||
      !hoverDetailsOpen ||
      shouldRefreshHostedReview ||
      isWebClient() ||
      !repo ||
      isFolder ||
      worktree.isBare ||
      !hostedReviewCacheKey ||
      isMacAppDataPath(repo.path)
    ) {
      return
    }
    // Why: hidden card metadata is revealed on whole-card hover, so fetch lazily instead of always-on polling.
    void fetchHostedReviewForBranch(repo.path, branch, {
      repoId: repo.id,
      linkedGitHubPR: worktree.linkedPR ?? null,
      ...(cachedBranchFallbackGitHubPRNumber !== null
        ? { fallbackGitHubPR: cachedBranchFallbackGitHubPRNumber }
        : {}),
      currentHeadOid: worktree.head ?? null,
      linkedGitLabMR,
      linkedBitbucketPR,
      linkedAzureDevOpsPR,
      linkedGiteaPR,
      staleWhileRevalidate: true
    })
  }, [
    hoverDetailsOpen,
    newCardStyle,
    shouldRefreshHostedReview,
    repo,
    isFolder,
    worktree.isBare,
    worktree.linkedPR,
    worktree.head,
    cachedBranchFallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    fetchHostedReviewForBranch,
    branch,
    hostedReviewCacheKey
  ])

  // Why: same as above for issues — hidden-surface polling only burns GitHub calls for invisible data.
  useEffect(() => {
    // Why: per-card decoration lookups from the browser flood the RPC path at paired-web startup; the host is authoritative.
    if (
      isWebClient() ||
      !repo ||
      isFolder ||
      !worktree.linkedIssue ||
      !issueCacheKey ||
      !showIssue
    ) {
      return
    }

    const issueNumber = worktree.linkedIssue

    // Why: fallback poll behind activity triggers; stopped while hidden to avoid waking idle workspaces.
    return installWindowVisibilityInterval({
      run: () => void fetchIssue(repo.path, issueNumber, { repoId: repo.id }),
      intervalMs: 5 * 60_000
    })
  }, [repo, isFolder, worktree.linkedIssue, fetchIssue, issueCacheKey, showIssue])

  useEffect(() => {
    if (
      !newCardStyle ||
      !hoverDetailsOpen ||
      showIssue ||
      isWebClient() ||
      !repo ||
      isFolder ||
      !worktree.linkedIssue ||
      !issueCacheKey
    ) {
      return
    }
    void fetchIssue(repo.path, worktree.linkedIssue, { repoId: repo.id })
  }, [
    newCardStyle,
    hoverDetailsOpen,
    showIssue,
    repo,
    isFolder,
    worktree.linkedIssue,
    fetchIssue,
    issueCacheKey
  ])

  useEffect(() => {
    if (!worktree.linkedLinearIssue || !showLinearIssue) {
      return
    }
    const linearIssueId = worktree.linkedLinearIssue
    const refreshLinearIssueIfVisible = (): void => {
      if (!isWindowVisible()) {
        return
      }
      void fetchLinearIssue(linearIssueId, 'all')
    }
    refreshLinearIssueIfVisible()
    window.addEventListener('focus', refreshLinearIssueIfVisible)
    document.addEventListener('visibilitychange', refreshLinearIssueIfVisible)
    return () => {
      window.removeEventListener('focus', refreshLinearIssueIfVisible)
      document.removeEventListener('visibilitychange', refreshLinearIssueIfVisible)
    }
  }, [worktree.linkedLinearIssue, fetchLinearIssue, showLinearIssue])

  useEffect(() => {
    if (!newCardStyle || !hoverDetailsOpen || showLinearIssue || !worktree.linkedLinearIssue) {
      return
    }
    void fetchLinearIssue(worktree.linkedLinearIssue, 'all')
  }, [
    newCardStyle,
    hoverDetailsOpen,
    showLinearIssue,
    worktree.linkedLinearIssue,
    fetchLinearIssue
  ])

  // Stable click handler – ignore clicks that are really text selections.
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isEventTargetInsideCurrentTarget(event.currentTarget, event.target)) {
        return
      }
      const selection = window.getSelection()
      // Why: only suppress the click for a selection inside this card; a foreign selection must not block worktree switching.
      if (selection && selection.toString().length > 0) {
        const card = event.currentTarget
        const anchor = selection.anchorNode
        const focus = selection.focusNode
        const selectionInsideCard =
          (anchor instanceof Node && card.contains(anchor)) ||
          (focus instanceof Node && card.contains(focus))
        if (selectionInsideCard) {
          return
        }
      }
      const selectionOnly = affiliateListMode
        ? false
        : (onSelectionGesture?.(event, worktree.id) ?? false)
      if (selectionOnly) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (isDeleting) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      // Why: route sidebar clicks through the shared activation path so the back/forward stack stays complete.
      recordRendererCrashBreadcrumb('sidebar_worktree_activate', {
        worktreeId: worktree.id,
        repoId: worktree.repoId,
        wasActive: isActive,
        sshDisconnected: isSshDisconnected
      })
      onImmediateActivate?.(worktree.id, activationRowKey)
      void activateWorktreeFromSidebar(
        worktree.id,
        worktree.hostId ?? (repo ? getRepoExecutionHostId(repo) : undefined)
      )
      // Why: a deliberate card click warrants the blocking reconnect prompt; skip it when a terminal already shows the overlay.
      if (isSshDisconnected && !activeViewIsTerminal) {
        setShowDisconnectedDialog(true)
      }
      onActivate?.()
    },
    [
      affiliateListMode,
      worktree.id,
      worktree.repoId,
      worktree.hostId,
      repo,
      isActive,
      isDeleting,
      activationRowKey,
      isSshDisconnected,
      activeViewIsTerminal,
      onActivate,
      onImmediateActivate,
      onSelectionGesture
    ]
  )

  const handleRenameTitle = useCallback(
    (displayName: string) => updateWorktreeMeta(worktree.id, { displayName }),
    [updateWorktreeMeta, worktree.id]
  )

  const handleOpenRenameErrorDialog = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setShowRenameErrorDialog(true)
  }, [])

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (affiliateListMode) {
        return
      }
      if (!isEventTargetInsideCurrentTarget(event.currentTarget, event.target)) {
        return
      }
      openModal('edit-meta', {
        worktreeId: worktree.id,
        currentDisplayName: worktree.displayName,
        currentIssue: worktree.linkedIssue,
        currentPR: worktree.linkedPR,
        currentComment: worktree.comment
      })
    },
    [
      openModal,
      affiliateListMode,
      worktree.comment,
      worktree.displayName,
      worktree.id,
      worktree.linkedIssue,
      worktree.linkedPR
    ]
  )

  const handleToggleUnreadQuick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      updateWorktreeMeta(worktree.id, { isUnread: !worktree.isUnread })
    },
    [worktree.id, worktree.isUnread, updateWorktreeMeta]
  )
  // Why: delete is destructive, so it only appears while holding Option/Alt, not in the ordinary hover chrome.
  const showDeleteQuickAction =
    !affiliateListMode &&
    canShowWorkspaceDeleteQuickAction({
      deleteModifierPressed,
      isDeleting,
      isMainWorktree: worktree.isMainWorktree
    })
  const handleWorkspaceQuickAction = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (showDeleteQuickAction) {
        if (folderWorkspaceId) {
          void deleteFolderWorkspace(folderWorkspaceId).then((deleted) => {
            if (
              deleted &&
              useAppStore.getState().activeWorktreeId === folderWorkspaceKey(folderWorkspaceId)
            ) {
              setActiveWorktree(null)
            }
          })
          return
        }
        runWorktreeDelete(worktree.id)
      }
    },
    [
      deleteFolderWorkspace,
      folderWorkspaceId,
      setActiveWorktree,
      showDeleteQuickAction,
      worktree.id
    ]
  )
  const unreadTooltip = worktree.isUnread ? 'Mark read' : 'Mark unread'
  const lineageChildAriaLabel =
    lineageChildCount === 1
      ? lineageCollapsed
        ? translate(
            'auto.components.sidebar.WorktreeList.20bebf9c7f',
            'Show {{value0}} child workspace',
            { value0: lineageChildCount }
          )
        : translate(
            'auto.components.sidebar.WorktreeList.e97297cb75',
            'Hide {{value0}} child workspace',
            { value0: lineageChildCount }
          )
      : lineageCollapsed
        ? translate(
            'auto.components.sidebar.WorktreeList.c1f4a31623',
            'Show {{value0}} child workspaces',
            { value0: lineageChildCount }
          )
        : translate(
            'auto.components.sidebar.WorktreeList.0cd15956d4',
            'Hide {{value0}} child workspaces',
            { value0: lineageChildCount }
          )
  const childWorkspaceShortLabel = `${lineageChildCount} ${
    lineageChildCount === 1
      ? translate('auto.components.sidebar.WorktreeList.0c6ee14f23', 'child')
      : translate('auto.components.sidebar.WorktreeList.045a8aed48', 'children')
  }`
  const showLineageChildChip = lineageChildCount > 0 && onLineageToggle !== undefined

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isEventTargetInsideCurrentTarget(event.currentTarget, event.target)) {
        event.preventDefault()
        return
      }
      if (isDeleting) {
        event.preventDefault()
        return
      }
      const dragIds =
        isMultiSelected && selectedWorktrees && selectedWorktrees.length > 1
          ? selectedWorktrees.map((item) => item.id)
          : worktree.id
      writeWorkspaceDragData(event.dataTransfer, dragIds)
      onCardDragStart?.(event, worktree.id, Array.isArray(dragIds) ? dragIds : [dragIds])
    },
    [isDeleting, isMultiSelected, onCardDragStart, selectedWorktrees, worktree.id]
  )

  const handleDragEnd = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isEventTargetInsideCurrentTarget(event.currentTarget, event.target)) {
        return
      }
      onCardDragEnd?.(event)
    },
    [onCardDragEnd]
  )

  const handleContextMenuSelect = useCallback(
    (event: React.MouseEvent<HTMLElement>) => onContextMenuSelect?.(event, worktree) ?? [worktree],
    [onContextMenuSelect, worktree]
  )

  const stopQuickActionPointerPropagation = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      // Why: document-level pointer handling dismisses the Kanban board; quick actions must not count as card activation.
      event.stopPropagation()
    },
    []
  )

  // Why: unread lives in the left status lane, so the Status toggle owns both the dot/PR slot and unread emphasis.
  const showUnreadEmphasis = showStatus && worktree.isUnread
  const hoverIssue = issueDisplay
  const hoverLinearIssue = linearIssueDisplay
  const hoverJiraIssue = jiraIssueDisplay
  const hoverReview = prDisplay
  const statusLaneReview = statusPrDisplay ?? hoverReview
  const hoverComment = worktree.comment
  const metaIssue = showIssue ? hoverIssue : null
  const metaLinearIssue = showLinearIssue ? hoverLinearIssue : null
  const metaJiraIssue = showJiraIssue ? hoverJiraIssue : null
  const metaReview = showPR ? hoverReview : null
  const metaAutomationProvenance = showAutomation ? worktree.automationProvenance : null
  const metaCliProvenance = showCli ? worktree.cliProvenance : null
  const metaComment = showComment ? hoverComment : null
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
  const handleOpenGitHubIssueInOrca = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const issueUrl = hoverIssue && 'url' in hoverIssue ? hoverIssue.url : undefined
      if (!repo || !hoverIssue || !issueUrl) {
        return
      }
      const item: GitHubWorkItem = {
        id: issueUrl,
        type: 'issue',
        number: hoverIssue.number,
        title: hoverIssue.title,
        state: 'state' in hoverIssue ? (hoverIssue.state ?? 'open') : 'open',
        url: issueUrl,
        labels: 'labels' in hoverIssue ? (hoverIssue.labels ?? []) : [],
        updatedAt: new Date().toISOString(),
        author: null,
        repoId: repo.id
      }
      openTaskPage({ taskSource: 'github', preselectedRepoId: repo.id, openGitHubWorkItem: item })
    },
    [hoverIssue, openTaskPage, repo]
  )
  const handleOpenReviewInOrca = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!repo || !hoverReview?.url || hoverReview.provider !== 'github') {
        return
      }
      const item: GitHubWorkItem = {
        id: hoverReview.url,
        type: 'pr',
        number: hoverReview.number,
        title: hoverReview.title,
        state: hoverReview.state ?? 'open',
        url: hoverReview.url,
        labels: [],
        updatedAt: 'updatedAt' in hoverReview ? hoverReview.updatedAt : new Date().toISOString(),
        author: null,
        headSha: 'headSha' in hoverReview ? hoverReview.headSha : undefined,
        repoId: repo.id
      }
      openTaskPage({ taskSource: 'github', preselectedRepoId: repo.id, openGitHubWorkItem: item })
    },
    [hoverReview, openTaskPage, repo]
  )
  const hoverReviewProvider = hoverReview?.provider
  const hasExplicitLinkedReview =
    (hoverReviewProvider === 'github' && worktree.linkedPR !== null) ||
    (hoverReviewProvider === 'gitlab' && linkedGitLabMR !== null) ||
    (hoverReviewProvider === 'bitbucket' && linkedBitbucketPR !== null) ||
    (hoverReviewProvider === 'azure-devops' && linkedAzureDevOpsPR !== null) ||
    (hoverReviewProvider === 'gitea' && linkedGiteaPR !== null)
  const handleUnlinkReview = useCallback(() => {
    switch (hoverReviewProvider) {
      case 'github':
        void updateWorktreeMeta(worktree.id, { linkedPR: null })
        return
      case 'gitlab':
        void updateWorktreeMeta(worktree.id, { linkedGitLabMR: null })
        return
      case 'bitbucket':
        void updateWorktreeMeta(worktree.id, { linkedBitbucketPR: null })
        return
      case 'azure-devops':
        void updateWorktreeMeta(worktree.id, { linkedAzureDevOpsPR: null })
        return
      case 'gitea':
        void updateWorktreeMeta(worktree.id, { linkedGiteaPR: null })
        break
      case 'unsupported':
      case undefined:
        break
    }
  }, [hoverReviewProvider, updateWorktreeMeta, worktree.id])
  const handleOpenLinearIssueInOrca = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!linearIssue) {
        return
      }
      openTaskPage({ taskSource: 'linear', openLinearIssue: linearIssue })
    },
    [linearIssue, openTaskPage]
  )
  const hasDetails = hasWorktreeCardDetails({
    issue: metaIssue,
    linearIssue: metaLinearIssue,
    jiraIssue: metaJiraIssue,
    review: newCardStyle ? null : metaReview,
    comment: metaComment,
    automationProvenance: metaAutomationProvenance,
    cliProvenance: metaCliProvenance
  })
  const hasPorts = showPorts && workspacePorts.length > 0
  const cacheStartedAt = usePromptCacheCountdownStartedAt(worktree.id, showAggregateCacheTimer)
  const cacheTtlMs = useAppStore((s) =>
    showAggregateCacheTimer ? (s.settings?.promptCacheTtlMs ?? 0) : 0
  )
  // Why: pinned trees mix repos, so the repo icon shows regardless of groupBy's hideRepoBadge.
  const showPinnedRepoIcon = inPinnedSection && !!repo
  // Why: new card style retired the Compact/Detailed switch; repo identity uses the compact chip, not a lower pill.
  const showRepoIdentityInTitle = newCardStyle || compactCards
  const showInlineRepoBadge =
    showRepoIdentityInTitle && !!repo && !hideRepoBadge && !isFolder && !showPinnedRepoIcon
  const showRepoBadgeInMetaRow =
    !showRepoIdentityInTitle && !!repo && !hideRepoBadge && !showPinnedRepoIcon
  const showHostContextBadge = !compactCards && !!hostContextLabel
  const showDetachedHeadInMetaRow = !compactCards && !isFolder && detachedHeadDisplay !== null
  const showBranch =
    !isFolder &&
    branch.length > 0 &&
    !newCardStyle &&
    (!compactCards || branch !== worktree.displayName)
  // Why: rebases already surface in source control, so dense cards skip the persistent rebase chip.
  const showConflictOperationBadge =
    !!conflictOperation && conflictOperation !== 'unknown' && conflictOperation !== 'rebase'
  const hasMetadataBadge = showConflictOperationBadge
  const showUnreadQuickAction = !affiliateListMode && showStatus && !newCardStyle
  // Why: the slot owns the unread/status lane; legacy keeps the bell toggle, the new card keeps the glyph passive.
  const showCombinedStatusSlot = showStatus
  const showTitleRowPrimary = compactCards && worktree.isMainWorktree && !isFolder
  const showMetaRowDetails = !newCardStyle && !compactCards && (hasDetails || hasPorts)
  const showTitleRowIndicators = (newCardStyle || compactCards) && (hasDetails || hasPorts)
  // Why: grouped views can hide the repo badge; don't reserve a blank metadata lane unless there's real content.
  const hasDetailedMetaRowContent = Boolean(
    (showRepoBadgeInMetaRow && repo) ||
    showHostContextBadge ||
    folderMetaRowContent ||
    showBranch ||
    showIdentityInNewCard ||
    showDetachedHeadInMetaRow ||
    showConflictOperationBadge ||
    cacheStartedAt != null ||
    showMetaRowDetails
  )
  const hasMetaRow = compactCards
    ? hasMetadataBadge || cacheStartedAt != null
    : hasDetailedMetaRowContent
  const showHeaderActions = showTitleRowPrimary || showDeleteQuickAction
  // Why: normalize the title once so title/branch de-dupe and identity-only hover eligibility stay in sync.
  const trimmedVisibleCardTitle = visibleCardTitle.trim()
  const showBranchIdentityHover = newCardStyle
    ? Boolean(identityDisplay) &&
      !cardProps.includes('branch') &&
      identityDisplay !== trimmedVisibleCardTitle
    : compactCards && showBranch
  const hoverBranchName = newCardStyle
    ? identityDisplay
    : showBranchIdentityHover
      ? branch
      : undefined
  const hoverWorkspaceTitle =
    trimmedVisibleCardTitle.length > 0 && trimmedVisibleCardTitle !== hoverBranchName
      ? trimmedVisibleCardTitle
      : undefined
  const hasHoverIdentity = Boolean(hoverWorkspaceTitle || hoverBranchName)
  const hasHoverDetails =
    newCardStyle &&
    (hasWorktreeCardDetails({
      issue: hoverIssue,
      linearIssue: hoverLinearIssue,
      jiraIssue: hoverJiraIssue,
      review: hoverReview,
      comment: hoverComment,
      automationProvenance: metaAutomationProvenance,
      cliProvenance: metaCliProvenance
    }) ||
      workspacePorts.length > 0 ||
      hasHoverIdentity)
  // Why: the parent row owns metadata hover; don't stack the title's truncation tooltip on the details popover.
  const titleWrapper = newCardStyle
    ? hasHoverDetails
      ? (title: React.ReactElement): React.ReactElement => title
      : undefined
    : compactCards && (showBranchIdentityHover || hasDetails || hasPorts)
      ? (title: React.ReactElement): React.ReactElement => (
          <WorktreeCardDetailsHover
            issue={metaIssue}
            linearIssue={metaLinearIssue}
            jiraIssue={metaJiraIssue}
            review={metaReview}
            comment={metaComment}
            automationProvenance={metaAutomationProvenance}
            cliProvenance={metaCliProvenance}
            automationHostId={worktree.hostId}
            branchName={showBranchIdentityHover ? branch : undefined}
            workspaceTitle={worktree.displayName}
            identityOrder="branch-first"
            detailsAfter={hasPorts ? <WorktreeCardPortsDetails ports={workspacePorts} /> : null}
            openDelay={100}
            // Why: compact mode also renders the plug/badge hover root; sharing one open-state made hovering the
            // plug force-open the wider title card and race it closed (#9304), so let this title hover own its state.
            onEditIssue={affiliateListMode ? undefined : handleEditIssue}
            onEditComment={affiliateListMode ? undefined : handleEditComment}
            onOpenGitHubIssueInOrca={
              metaIssue && 'url' in metaIssue && metaIssue.url
                ? handleOpenGitHubIssueInOrca
                : undefined
            }
            onOpenLinearIssueInOrca={linearIssue?.url ? handleOpenLinearIssueInOrca : undefined}
            onOpenReviewInOrca={
              metaReview?.url && metaReview.provider === 'github'
                ? handleOpenReviewInOrca
                : undefined
            }
            onOpenAutomation={affiliateListMode ? undefined : handleOpenAutomation}
            onOpenAutomationRun={affiliateListMode ? undefined : handleOpenAutomationRun}
            // Why: compact mode hides the metadata badge row, so title hover carries the explicit-link affordance.
            onUnlinkReview={
              !affiliateListMode && hasExplicitLinkedReview ? handleUnlinkReview : undefined
            }
          >
            {title}
          </WorktreeCardDetailsHover>
        )
      : undefined
  // Why: sidebar rows need a small surface inset while content stays aligned with the pre-inset layout.
  const applyNewCardStyleStatusLaneOffset = newCardStyle && showCombinedStatusSlot
  const cardPaddingLeft = flushSurface
    ? getFlushWorktreeCardPaddingLeft(contentIndent, applyNewCardStyleStatusLaneOffset)
    : contentIndent > 0
      ? `calc(0.125rem + ${contentIndent}px)`
      : null
  const parentContentMarginLeft =
    flushSurface && applyNewCardStyleStatusLaneOffset
      ? getNewCardStyleParentContentMarginLeft(contentIndent)
      : 0
  const cardStyle = cardPaddingLeft ? { paddingLeft: cardPaddingLeft } : undefined
  const detailsAndPortsContent =
    hasDetails || hasPorts ? (
      <div className="flex shrink-0 items-center gap-1">
        {hasPorts && <WorktreeCardPortsTrigger ports={workspacePorts} />}
        {hasDetails && (
          <WorktreeCardMetaBadges
            issue={metaIssue}
            linearIssue={metaLinearIssue}
            jiraIssue={metaJiraIssue}
            review={newCardStyle ? null : metaReview}
            comment={metaComment}
            automationProvenance={metaAutomationProvenance}
            cliProvenance={metaCliProvenance}
            className="ml-0 pr-0"
          />
        )}
      </div>
    ) : null
  const detailsAndPorts =
    detailsAndPortsContent && !newCardStyle ? (
      <WorktreeCardDetailsHover
        issue={metaIssue}
        linearIssue={metaLinearIssue}
        jiraIssue={metaJiraIssue}
        review={metaReview}
        comment={metaComment}
        automationProvenance={metaAutomationProvenance}
        cliProvenance={metaCliProvenance}
        automationHostId={worktree.hostId}
        detailsAfter={hasPorts ? <WorktreeCardPortsDetails ports={workspacePorts} /> : null}
        hoverControl={detailsHoverControl}
        onEditIssue={affiliateListMode ? undefined : handleEditIssue}
        onEditComment={affiliateListMode ? undefined : handleEditComment}
        onOpenGitHubIssueInOrca={
          metaIssue && 'url' in metaIssue && metaIssue.url ? handleOpenGitHubIssueInOrca : undefined
        }
        onOpenLinearIssueInOrca={linearIssue?.url ? handleOpenLinearIssueInOrca : undefined}
        onOpenReviewInOrca={
          metaReview?.url && metaReview.provider === 'github' ? handleOpenReviewInOrca : undefined
        }
        onOpenAutomation={affiliateListMode ? undefined : handleOpenAutomation}
        onOpenAutomationRun={affiliateListMode ? undefined : handleOpenAutomationRun}
        // Why: branch lookup can surface a review without persisted metadata; only unlink when explicitly linked.
        onUnlinkReview={
          !affiliateListMode && hasExplicitLinkedReview ? handleUnlinkReview : undefined
        }
      >
        {detailsAndPortsContent}
      </WorktreeCardDetailsHover>
    ) : (
      detailsAndPortsContent
    )
  const titleRowIndicators = showTitleRowIndicators ? (
    <div className="ml-auto flex shrink-0 items-center gap-1 pr-1.5">{detailsAndPorts}</div>
  ) : null
  const hasSecondaryCardContent =
    hasMetaRow || !!remoteBranchConflict || showInlineAgentList || showLineageChildChip
  const titleOnlyCard = !hasSecondaryCardContent

  const parentCardContent = (
    <WorktreeCardContent
      worktree={worktree}
      repo={repo}
      settings={settings}
      isActive={isActive}
      isFolder={isFolder}
      compactCards={compactCards}
      newCardStyle={newCardStyle}
      affiliateListMode={affiliateListMode}
      isSshDisconnected={isSshDisconnected}
      isRuntimeDisconnected={isRuntimeDisconnected}
      parsedRepoHost={parsedRepoHost}
      runtimeHostLabel={runtimeHostLabel}
      visibleCardTitle={visibleCardTitle}
      showUnreadEmphasis={showUnreadEmphasis}
      isDeleting={isDeleting}
      titleRenaming={titleRenaming}
      setTitleRenaming={setTitleRenaming}
      titleWrapper={titleWrapper}
      handleRenameTitle={handleRenameTitle}
      handleOpenRenameErrorDialog={handleOpenRenameErrorDialog}
      renamingWorktreeId={renamingWorktreeId}
      renameRowKey={renameRowKey}
      setRenamingWorktreeId={setRenamingWorktreeId}
      showStatus={showStatus}
      showCombinedStatusSlot={showCombinedStatusSlot}
      showUnreadQuickAction={showUnreadQuickAction}
      unreadTooltip={unreadTooltip}
      stopQuickActionPointerPropagation={stopQuickActionPointerPropagation}
      handleToggleUnreadQuick={handleToggleUnreadQuick}
      statusLaneReview={statusLaneReview}
      branchIdentityDisplay={branchIdentityDisplay}
      showPinnedRepoIcon={showPinnedRepoIcon}
      showInlineRepoBadge={showInlineRepoBadge}
      showTitleRowIndicators={showTitleRowIndicators}
      titleRowIndicators={titleRowIndicators}
      showHeaderActions={showHeaderActions}
      showTitleRowPrimary={showTitleRowPrimary}
      showDeleteQuickAction={showDeleteQuickAction}
      handleWorkspaceQuickAction={handleWorkspaceQuickAction}
      hasMetaRow={hasMetaRow}
      showRepoBadgeInMetaRow={showRepoBadgeInMetaRow}
      showHostContextBadge={showHostContextBadge}
      hostContextLabel={hostContextLabel}
      showIdentityInNewCard={showIdentityInNewCard}
      identityDisplay={identityDisplay}
      hasHoverDetails={hasHoverDetails}
      showBranch={showBranch}
      branch={branch}
      showDetachedHeadInMetaRow={showDetachedHeadInMetaRow}
      detachedHeadDisplay={detachedHeadDisplay}
      showConflictOperationBadge={showConflictOperationBadge}
      conflictOperation={conflictOperation as keyof typeof CONFLICT_OPERATION_LABELS}
      cacheStartedAt={cacheStartedAt}
      cacheTtlMs={cacheTtlMs}
      showMetaRowDetails={showMetaRowDetails}
      detailsAndPorts={detailsAndPorts}
      remoteBranchConflict={remoteBranchConflict}
      showInlineAgentList={showInlineAgentList}
      agentActivityDisplayMode={agentActivityDisplayMode}
      compactInlineAgentRows={compactInlineAgentRows}
      showLineageChildChip={showLineageChildChip}
      lineageChildAriaLabel={lineageChildAriaLabel}
      lineageCollapsed={lineageCollapsed}
      onLineageToggle={onLineageToggle}
      childWorkspaceShortLabel={childWorkspaceShortLabel}
      lineageChildren={lineageChildren}
      titleOnlyCard={titleOnlyCard}
      parentContentMarginLeft={parentContentMarginLeft}
    />
  )

  const parentHoverTriggerBody = (
    <div className="group/worktree-card w-full min-w-0" data-worktree-card-hover-trigger="">
      {parentCardContent}
    </div>
  )

  const parentCardBodyWithHoverDetails =
    hasHoverDetails && !titleRenaming ? (
      <WorktreeCardDetailsHover
        issue={hoverIssue}
        linearIssue={hoverLinearIssue}
        jiraIssue={hoverJiraIssue}
        review={hoverReview}
        comment={hoverComment}
        automationProvenance={metaAutomationProvenance}
        cliProvenance={metaCliProvenance}
        automationHostId={worktree.hostId}
        branchName={hoverBranchName}
        workspaceTitle={hoverWorkspaceTitle}
        workspaceTitleRenameDisabled={isDeleting || affiliateListMode}
        detailsAfter={
          workspacePorts.length > 0 ? <WorktreeCardPortsDetails ports={workspacePorts} /> : null
        }
        openDelay={100}
        hoverControl={detailsHoverControl}
        onRenameWorkspaceTitle={affiliateListMode ? undefined : handleRenameTitle}
        onEditIssue={affiliateListMode ? undefined : handleEditIssue}
        onEditComment={affiliateListMode ? undefined : handleEditComment}
        onOpenGitHubIssueInOrca={
          hoverIssue && 'url' in hoverIssue && hoverIssue.url
            ? handleOpenGitHubIssueInOrca
            : undefined
        }
        onOpenLinearIssueInOrca={linearIssue?.url ? handleOpenLinearIssueInOrca : undefined}
        onOpenReviewInOrca={
          hoverReview?.url && hoverReview.provider === 'github' ? handleOpenReviewInOrca : undefined
        }
        onOpenAutomation={affiliateListMode ? undefined : handleOpenAutomation}
        onOpenAutomationRun={affiliateListMode ? undefined : handleOpenAutomationRun}
        // Why: branch lookup can surface a review without persisted metadata; only unlink when explicitly linked.
        onUnlinkReview={
          !affiliateListMode && hasExplicitLinkedReview ? handleUnlinkReview : undefined
        }
      >
        {parentHoverTriggerBody}
      </WorktreeCardDetailsHover>
    ) : (
      parentHoverTriggerBody
    )

  const cardBody = (
    <div
      className={cn(
        'relative flex cursor-pointer flex-col pr-1.5 transition-[background-color,border-color,opacity,box-shadow] duration-200 outline-none select-none',
        titleOnlyCard ? 'py-2' : 'pt-1.25 pb-1.5',
        flushSurface ? 'ml-1 w-[calc(100%-0.25rem)]' : 'ml-1',
        'rounded-lg',
        // Why: the live data attribute updates before React state during navigation,
        // so it must own the complete active style without stale utility classes.
        isLineageDropTarget
          ? 'border border-accent-foreground/20 bg-accent/80'
          : isActiveSurface
            ? 'border border-transparent'
            : isMultiSelected
              ? 'border border-worktree-sidebar-ring/35 bg-worktree-sidebar-accent/70 ring-1 ring-worktree-sidebar-ring/30'
              : 'border border-transparent worktree-sidebar-card-hover',
        isActiveSurface && isMultiSelected && 'ring-1 ring-worktree-sidebar-ring/35',
        revealHighlight && [
          'scroll-to-current-workspace-reveal-highlight',
          revealHighlightTone === 'ai' && 'scroll-to-current-workspace-reveal-highlight--ai'
        ],
        titleRenaming && '!border-transparent !bg-transparent !shadow-none !ring-0',
        isDeleting && 'opacity-50 grayscale cursor-not-allowed',
        (isSshDisconnected || isRuntimeDisconnected) && !isDeleting && 'opacity-60'
      )}
      data-worktree-card-surface="true"
      data-worktree-card-active={isActiveSurface ? activeSurfaceVariant : undefined}
      onClick={handleClick}
      onDoubleClick={affiliateListMode ? undefined : handleDoubleClick}
      draggable={!affiliateListMode && nativeDragEnabled && !isDeleting && !titleRenaming}
      onDragStart={!affiliateListMode && nativeDragEnabled ? handleDragStart : undefined}
      onDragEnd={!affiliateListMode && nativeDragEnabled ? handleDragEnd : undefined}
      aria-busy={isDeleting}
      style={cardStyle}
    >
      {isDeleting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/50 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-[11px] font-medium text-foreground shadow-sm border border-border/50">
            {!isQueuedForDeletion ? (
              <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
            {deleteLabel}
          </div>
        </div>
      )}
      {parentCardBodyWithHoverDetails}

      {newCardStyle && lineageChildren ? (
        <div
          className="mt-1.5 space-y-1"
          data-worktree-lineage-children=""
          style={lineageChildrenStyle}
        >
          {lineageChildren}
        </div>
      ) : null}
    </div>
  )

  return (
    <>
      {affiliateListMode ? (
        cardBody
      ) : (
        <WorktreeContextMenu
          worktree={worktree}
          selectedWorktrees={selectedWorktrees}
          onContextMenuSelect={handleContextMenuSelect}
          onAssignWorkspaceStatus={onAssignWorkspaceStatus}
        >
          {cardBody}
        </WorktreeContextMenu>
      )}

      {repo?.connectionId && (
        <SshDisconnectedDialog
          open={showDisconnectedDialog && isSshDisconnected}
          onOpenChange={setShowDisconnectedDialog}
          targetId={repo.connectionId}
          targetLabel={sshTargetLabel || repo.displayName}
          status={sshStatus ?? 'disconnected'}
        />
      )}

      {typeof worktree.firstAgentMessageRenameError === 'string' &&
        worktree.firstAgentMessageRenameError.length > 0 && (
          <AutoRenameFailedDialog
            open={showRenameErrorDialog}
            onOpenChange={setShowRenameErrorDialog}
            worktreeId={worktree.id}
            worktreeName={worktree.displayName}
            error={worktree.firstAgentMessageRenameError}
          />
        )}
    </>
  )
})

export default WorktreeCardSurface
