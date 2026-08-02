import type {
  FolderWorkspace,
  GlobalSettings,
  SetupSplitDirection,
  Tab,
  TuiAgent,
  WorktreeDefaultTabsLaunch,
  WorktreeSetupLaunch
} from '../../../shared/types'
import type { EventProps } from '../../../shared/telemetry-events'
import type { StartupCommandDelivery } from '../../../shared/codex-startup-delivery'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../shared/agent-session-resume'
import { useAppStore } from '@/store'
import type { PendingSidebarWorktreeReveal } from '@/store/slices/ui'
import {
  activateWebRuntimeSessionWorktree,
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive,
  isWebTerminalSurfaceTabId
} from '@/runtime/web-runtime-session'
import { getLastKnownHostTerminalTabCount } from '@/runtime/web-session-tabs-sync'
import {
  beginWebRuntimeWakeTerminalRespawn,
  endWebRuntimeWakeTerminalRespawn
} from '@/runtime/web-runtime-wake-terminal-respawn'
import {
  setWorktreeNavActivator,
  setWorktreeNavViewActivator
} from '@/store/slices/worktree-nav-history'
import { resumeSleepingAgentSessionsForWorktree } from '@/lib/resume-sleeping-agent-session'
import {
  getRuntimeEnvironmentIdForWorktree,
  type WorktreeRuntimeOwnerState
} from '@/lib/worktree-runtime-owner'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../shared/workspace-scope'
import {
  folderWorkspaceActivationBlocked,
  getFolderWorkspacePathStatusDescription,
  getFolderWorkspacePathStatusTitle
} from './folder-workspace-path-status'
import { toast } from 'sonner'
import { isDetachedHeadWorkspace } from '@/components/sidebar/visible-worktrees'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { findFolderWorkspaceOwner } from './folder-workspace-runtime-owner'

export type {
  ActivateAndRevealResult,
  AgentStartedTelemetry,
  IssueCommandLaunch,
  WorktreeActivationStore,
  WorktreeStartupPayload
} from './worktree-activation-types'
export { resolveStartupLaunchDraftText } from './worktree-activation-types'


function ensureFolderWorkspaceInitialTerminal(
  folderWorkspace: FolderWorkspace,
  startup?: WorktreeStartupPayload
): string | null {
  const state = useAppStore.getState()
  const workspaceKey = folderWorkspaceKey(folderWorkspace.id)
  const primaryTabId = ensureWorktreeHasInitialTerminal(
    state,
    workspaceKey,
    startup,
    undefined,
    undefined,
    undefined
  )
  return primaryTabId
}

export function activateAndRevealFolderWorkspace(
  folderWorkspaceId: string,
  opts?: {
    sidebarRevealBehavior?: PendingSidebarWorktreeReveal['behavior']
    startup?: WorktreeStartupPayload
    runtimeEnvironmentId?: string | null
    executionHostId?: ExecutionHostId
  }
): ActivateAndRevealResult | false {
  const state = useAppStore.getState()
  const folderWorkspaceOwner = findFolderWorkspaceOwner(
    state,
    folderWorkspaceId,
    opts?.executionHostId
  )
  const folderWorkspace = state.folderWorkspaces.find(
    (workspace) => workspace === folderWorkspaceOwner
  )
  if (!folderWorkspace) {
    return false
  }
  const runtimeEnvironmentId =
    opts && 'runtimeEnvironmentId' in opts
      ? (opts.runtimeEnvironmentId ?? null)
      : getRuntimeEnvironmentIdForWorktree(state, folderWorkspaceKey(folderWorkspaceId))
  const pathStatus = state.getFreshFolderWorkspacePathStatus(
    {
      scope: 'folder-workspace',
      folderWorkspaceId
    },
    { runtimeEnvironmentId }
  )
  if (folderWorkspaceActivationBlocked(pathStatus)) {
    toast.error(getFolderWorkspacePathStatusTitle(pathStatus) ?? 'Cannot open folder workspace', {
      description: getFolderWorkspacePathStatusDescription(pathStatus) ?? folderWorkspace.folderPath
    })
    return false
  }

  if (state.activeView !== 'terminal') {
    state.setActiveView('terminal')
  }

  state.setActiveFolderWorkspace(folderWorkspaceId, opts?.executionHostId)

  const workspaceKey = folderWorkspaceKey(folderWorkspaceId)
  state.markWorktreeVisited(workspaceKey)
  if (!state.isNavigatingHistory) {
    state.recordWorktreeVisit(workspaceKey)
  }
  resumeSleepingAgentSessionsForWorktree(workspaceKey)
  const primaryTabId = ensureFolderWorkspaceInitialTerminal(folderWorkspace, opts?.startup)

  if (opts?.sidebarRevealBehavior) {
    state.revealWorktreeInSidebar(workspaceKey, { behavior: opts.sidebarRevealBehavior })
  } else {
    state.revealWorktreeInSidebar(workspaceKey)
  }

  return { primaryTabId }
}

export function activateAndRevealWorktree(
  worktreeId: string,
  opts?: {
    startup?: WorktreeStartupPayload
    initialCwd?: string
    setup?: WorktreeSetupLaunch
    defaultTabs?: WorktreeDefaultTabsLaunch
    issueCommand?: IssueCommandLaunch
    sidebarRevealBehavior?: PendingSidebarWorktreeReveal['behavior']
    notifyHostRuntime?: boolean
    revealInSidebar?: boolean
    executionHostId?: ExecutionHostId
  }
): ActivateAndRevealResult | false {
  const state = useAppStore.getState()
  const wt = state.getKnownWorktreeById(worktreeId, opts?.executionHostId)
  if (!wt) {
    return false
  }
  const hasActivationWork = Boolean(
    opts?.startup || opts?.setup || opts?.defaultTabs || opts?.issueCommand
  )
  // Why: a plain reselect should still reveal the sidebar row but must not restamp focus recency or wake persistence.
  const isPlainAlreadyActiveTerminal =
    !hasActivationWork &&
    state.activeRepoId === wt.repoId &&
    state.activeWorktreeId === worktreeId &&
    state.activeWorkspaceExecutionHostId === (opts?.executionHostId ?? null) &&
    state.activeView === 'terminal'

  // 1. Set activeRepoId if crossing repos
  if (wt.repoId !== state.activeRepoId) {
    state.setActiveRepo(wt.repoId)
  }

  // 2. Switch any non-terminal view back to terminal
  if (state.activeView !== 'terminal') {
    state.setActiveView('terminal')
  }

  // 3. Core activation: setActiveWorktree also restores per-worktree state, clears unread, bumps dead PTY generations, refreshes GitHub
  state.setActiveWorktree(worktreeId, opts?.executionHostId)
  const postActivationState = useAppStore.getState()
  const ownerRuntimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(postActivationState, wt.id)
  if (opts?.notifyHostRuntime !== false && isWebRuntimeSessionActive(ownerRuntimeEnvironmentId)) {
    // Why: paired web clients own only local selection, so the desktop host publishes session surfaces without treating it as a nav command.
    void activateWebRuntimeSessionWorktree({
      worktreeId,
      environmentId: ownerRuntimeEnvironmentId
    })
  }

  // Why: focus recency for Cmd+J ordering, distinct from recordWorktreeVisit/lastActivityAt; stamp before any later async step could throw. See docs/cmd-j-empty-query-ordering.md.
  if (!isPlainAlreadyActiveTerminal) {
    state.markWorktreeVisited(worktreeId)
  }

  // Why: skip re-recording for goBack/goForward history navigation — it moves the index instead of visiting anew (isNavigatingHistory).
  if (!isPlainAlreadyActiveTerminal && !state.isNavigatingHistory) {
    state.recordWorktreeVisit(worktreeId)
  }

  // Why: sleeping destroys the local PTY but preserves the provider session id, so waking should restore those CLI sessions automatically.
  resumeSleepingAgentSessionsForWorktree(worktreeId)

  // 4. Ensure a focusable surface exists for externally-created worktrees
  const primaryTabId = ensureWorktreeHasInitialTerminal(
    useAppStore.getState(),
    worktreeId,
    opts?.startup,
    opts?.setup,
    opts?.issueCommand,
    opts?.defaultTabs
  )
  if (primaryTabId && opts?.initialCwd) {
    useAppStore.getState().queueTabInitialCwd(primaryTabId, opts.initialCwd)
  }

  // 5. Clear sidebar filters hiding the target — reveal needs the card rendered, else it silently no-ops.
  if (state.filterRepoIds.length > 0 && !state.filterRepoIds.includes(wt.repoId)) {
    state.setFilterRepoIds([])
  }
  if (
    state.hideAutomationGeneratedWorkspaces &&
    wt.automationProvenance?.kind === 'created-by-automation'
  ) {
    state.setHideAutomationGeneratedWorkspaces(false)
  }
  if (state.hideCliCreatedWorkspaces && wt.cliProvenance?.kind === 'created-by-cli') {
    state.setHideCliCreatedWorkspaces(false)
  }
  if (state.hideDetachedHeadWorkspaces && isDetachedHeadWorkspace(wt)) {
    state.setHideDetachedHeadWorkspaces(false)
  }

  // 6. Reveal in sidebar
  if (opts?.revealInSidebar !== false) {
    if (opts?.sidebarRevealBehavior) {
      state.revealWorktreeInSidebar(worktreeId, { behavior: opts.sidebarRevealBehavior })
    } else {
      state.revealWorktreeInSidebar(worktreeId)
    }
  }

  if (opts?.notifyHostRuntime !== false) {
    ensureWebRuntimeWorktreeTerminalAfterWake(worktreeId)
  }

  return { primaryTabId }
}

export function ensureWebRuntimeWorktreeTerminalAfterWake(worktreeId: string): void {
  const state = useAppStore.getState()
  const worktree = state.getKnownWorktreeById(worktreeId)
  if (!worktree) {
    return
  }
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktree.id)
  if (!runtimeEnvironmentId || !isWebRuntimeSessionActive(runtimeEnvironmentId)) {
    return
  }

  const tabs = state.tabsByWorktree[worktreeId] ?? []
  const hasLivePty = tabs.some((tab) => tabHasLivePty(state.ptyIdsByTabId, tab.id))
  if (hasLivePty) {
    return
  }

  const hasMirroredHostTabs = tabs.some((tab) => isWebTerminalSurfaceTabId(tab.id))
  if (hasMirroredHostTabs) {
    // Why: the host session still owns these tabs — wait for the mirror to repopulate PTY handles instead of duplicating a terminal.
    return
  }

  if (getLastKnownHostTerminalTabCount(runtimeEnvironmentId, worktreeId) > 0) {
    return
  }

  const { renderableTabCount } = state.reconcileWorktreeTabModel(worktreeId)
  if (tabs.length > 0 && renderableTabCount === 0) {
    return
  }

  if (!beginWebRuntimeWakeTerminalRespawn(worktreeId)) {
    return
  }

  // Why: sleep keeps tab rows but terminal.stop clears host PTYs, so a woke workspace can have tab chrome but no surface.
  void createWebRuntimeSessionTerminal({
    worktreeId,
    environmentId: runtimeEnvironmentId,
    activate: true,
    selectWorktree: false
  }).finally(() => {
    endWebRuntimeWakeTerminalRespawn(worktreeId)
  })
}

export { ensureWorktreeHasInitialTerminal } from './worktree-activation-terminal'


export { activateAndRevealWorkspace } from './worktree-activation-nav-history'


