import { getClientRuntime } from '@/runtime/client-runtime'
import { useAppStore } from '../store'
import { applyWorktreeHeadIdentities } from './worktree-head-identity-apply'

type WorktreeSurfaceContext = {
  unsubs: Array<() => void>
  isRuntimeEnvironmentActive: () => boolean
  remountTerminalTabsAwaitingHostHydration: () => void
  worktreeChangeRefreshQueue: {
    enqueue: (data: {
      repoId: string
      renamed?: { oldWorktreeId: string; newWorktreeId: string }
      forceLocalOwner?: boolean
    }) => void
  }
}

export function registerWorktreeEvents(context: WorktreeSurfaceContext): void {
  const {
    unsubs,
    isRuntimeEnvironmentActive,
    remountTerminalTabsAwaitingHostHydration,
    worktreeChangeRefreshQueue
  } = context
unsubs.push(
  getClientRuntime().workspace.repos.onChanged(() => {
    const state = useAppStore.getState()
    if (isRuntimeEnvironmentActive()) {
      // Why: the all-host sidebar shows local repos even under a runtime; refresh the local slice, keep runtime slices.
      void (async () => {
        await state.fetchReposForAllHosts()
        await state.fetchProjectGroupsForAllHosts()
        await state.fetchFolderWorkspacesForAllHosts()
        remountTerminalTabsAwaitingHostHydration()
      })()
      return
    }
    void state.fetchProjectGroups()
    void state.fetchFolderWorkspaces()
    void state.fetchRepos().then(remountTerminalTabsAwaitingHostHydration)
  })
)

unsubs.push(
  getClientRuntime().workspace.worktrees.onChanged(
    async (data: {
      repoId: string
      renamed?: { oldWorktreeId: string; newWorktreeId: string }
    }) => {
      // Why: preserve this event's local origin across queue delays and runtime
      // focus changes; otherwise an unbound repo can refresh from the wrong host.
      // A folder rename changes the worktree id; handleWorktreesChanged re-keys
      // state and shields it from the deletion diff.
      worktreeChangeRefreshQueue.enqueue({
        ...data,
        forceLocalOwner: true
      })
    }
  )
)

if (getClientRuntime().workspace.worktrees.onHeadIdentitiesChanged) {
  unsubs.push(
    getClientRuntime().workspace.worktrees.onHeadIdentitiesChanged((data) => {
      if (isRuntimeEnvironmentActive()) {
        // Why: local worktree events carry local repo ids; the local-pinned list
        // refresh (onChanged) covers local rows while a runtime is active.
        return
      }
      const state = useAppStore.getState()
      applyWorktreeHeadIdentities(data, {
        getWorktreesForRepo: (repoId) => state.worktreesByRepo[repoId],
        updateWorktreeGitIdentity: state.updateWorktreeGitIdentity
      })
    })
  )
}

unsubs.push(
  getClientRuntime().workspace.worktrees.onBaseStatus((event) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    useAppStore.getState().updateWorktreeBaseStatus(event)
  })
)

unsubs.push(
  getClientRuntime().workspace.worktrees.onRemoteBranchConflict((event) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    useAppStore.getState().updateWorktreeRemoteBranchConflict(event)
  })
)

// Why: route main's two-phase creation progress to each pending entry by correlation id (?. guards stale preload).
unsubs.push(
  getClientRuntime().workspace.worktrees.onCreateProgress?.((data) => {
    if (!data.creationId) {
      return
    }
    useAppStore.getState().updatePendingWorktreeCreation(data.creationId, { phase: data.phase })
  }) ?? (() => {})
)

if (window.api.gh?.onPRRefreshEvent) {
  unsubs.push(
    window.api.gh.onPRRefreshEvent((event) => {
      useAppStore.getState().applyGitHubPRRefreshEvent(event)
    })
  )
}

}
