import { useCallback, useRef, useState } from 'react'
import { getClientRuntime } from '@/runtime/client-runtime'
import { useMountedRef } from '@/hooks/useMountedRef'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import type { AppState } from '../../store'
import { runWorktreeDelete } from '../sidebar/delete-worktree-flow'
import { navigateResourceSessionToTab } from './resource-session-navigation'
import { requiresKillConfirmation } from './resource-session-kill-confirmation'
import type { ResourceSessionBindingInputs } from './resource-session-bindings'
import { selectUnboundDaemonSessions } from './resource-session-bindings'
import type { DaemonSession, UnifiedSessionRow } from './resource-usage-merge-types'
import { ORPHAN_WORKTREE_ID } from '../../../../shared/constants'
import { UNATTRIBUTED_REPO_ID } from './mergeSnapshotAndSessions'

export type ResourceUsageStatusActions = {
  collapsedRepos: Set<string>
  toggleRepo: (repoId: string) => void
  collapsedWorktrees: Set<string>
  toggleWorktree: (worktreeId: string) => void
  appCollapsed: boolean
  setAppCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  setPopoverBodyNode: (node: HTMLDivElement | null) => void
  navigateToWorktree: (worktreeId: string) => void
  navigateToTab: (tabId: string, paneKey: string | null) => void
  deleteWorktree: (worktreeId: string) => void
  handleOpenWorkspaceCleanup: () => void
  openSpaceResults: () => void
  handleKillSession: (session: UnifiedSessionRow) => void
  handleKillOrphans: () => Promise<void>
  killConfirm: UnifiedSessionRow | null
  killing: boolean
  setKillConfirm: React.Dispatch<React.SetStateAction<UnifiedSessionRow | null>>
  runKillConfirmed: () => Promise<void>
}

type ResourceUsageStatusActionOptions = {
  tabsByWorktree: AppState['tabsByWorktree']
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  setActiveView: AppState['setActiveView']
  openModal: AppState['openModal']
  openSpacePage: AppState['openSpacePage']
  workspaceSessionReady: boolean
  sessions: readonly DaemonSession[]
  resourceSessionBindings: ResourceSessionBindingInputs
  removeSession: (sessionId: string) => void
  removeSessions: (sessionIds: ReadonlySet<string>) => void
  refreshSessions: () => Promise<void>
}

/** Owns Resource Manager interactions and keeps PTY mutation behind the runtime service. */
export function useResourceUsageStatusActions(
  options: ResourceUsageStatusActionOptions
): ResourceUsageStatusActions {
  const {
    tabsByWorktree,
    setOpen,
    setActiveView,
    openModal,
    openSpacePage,
    workspaceSessionReady,
    sessions,
    resourceSessionBindings,
    removeSession,
    removeSessions,
    refreshSessions
  } = options
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(() => new Set())
  const [collapsedWorktrees, setCollapsedWorktrees] = useState<Set<string>>(() => new Set())
  const [appCollapsed, setAppCollapsed] = useState(true)
  const [killConfirm, setKillConfirm] = useState<UnifiedSessionRow | null>(null)
  const [killing, setKilling] = useState(false)
  const popoverBodyRef = useRef<HTMLDivElement | null>(null)
  const popoverBodyFocusFrameRef = useRef<number | null>(null)
  const mountedRef = useMountedRef()

  const cancelPopoverBodyFocusFrame = useCallback((): void => {
    if (popoverBodyFocusFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(popoverBodyFocusFrameRef.current)
    popoverBodyFocusFrameRef.current = null
  }, [])
  const setPopoverBodyNode = useCallback(
    (node: HTMLDivElement | null): void => {
      if (!node) {
        cancelPopoverBodyFocusFrame()
      }
      popoverBodyRef.current = node
    },
    [cancelPopoverBodyFocusFrame]
  )
  const toggleRepo = useCallback((repoId: string): void => {
    setCollapsedRepos((previous) => {
      const next = new Set(previous)
      if (next.has(repoId)) {
        next.delete(repoId)
      } else {
        next.add(repoId)
      }
      return next
    })
  }, [])
  const toggleWorktree = useCallback((worktreeId: string): void => {
    setCollapsedWorktrees((previous) => {
      const next = new Set(previous)
      if (next.has(worktreeId)) {
        next.delete(worktreeId)
      } else {
        next.add(worktreeId)
      }
      return next
    })
  }, [])
  const navigateToWorktree = useCallback((worktreeId: string): void => {
    if (worktreeId === ORPHAN_WORKTREE_ID || worktreeId.startsWith(`${UNATTRIBUTED_REPO_ID}::`)) {
      return
    }
    activateAndRevealWorktree(worktreeId)
  }, [])
  const navigateToTab = useCallback(
    (tabId: string, paneKey: string | null): void => {
      navigateResourceSessionToTab(tabId, paneKey, {
        tabsByWorktree,
        setOpen,
        setActiveView,
        activateAndRevealWorktree,
        activateTabAndFocusPane
      })
    },
    [setActiveView, setOpen, tabsByWorktree]
  )
  const deleteWorktree = useCallback(
    (worktreeId: string): void => {
      setOpen(false)
      runWorktreeDelete(worktreeId)
    },
    [setOpen]
  )
  const handleOpenWorkspaceCleanup = useCallback((): void => {
    setOpen(false)
    queueMicrotask(() => openModal('workspace-cleanup'))
  }, [openModal, setOpen])
  const handleKillSession = useCallback(
    (session: UnifiedSessionRow): void => {
      if (requiresKillConfirmation(session)) {
        setKillConfirm(session)
        return
      }
      removeSession(session.sessionId)
      void (async () => {
        try {
          await getClientRuntime().terminal.kill(session.sessionId)
        } catch {
          /* The daemon may have already removed the session. */
        }
        await refreshSessions()
      })()
    },
    [refreshSessions, removeSession]
  )
  const handleKillOrphans = useCallback(async (): Promise<void> => {
    if (!workspaceSessionReady) {
      return
    }
    const orphans = selectUnboundDaemonSessions(sessions, resourceSessionBindings)
    if (orphans.length === 0) {
      return
    }
    removeSessions(new Set(orphans.map((session) => session.id)))
    await Promise.allSettled(orphans.map((session) => getClientRuntime().terminal.kill(session.id)))
    void refreshSessions()
  }, [refreshSessions, removeSessions, resourceSessionBindings, sessions, workspaceSessionReady])
  const runKillConfirmed = useCallback(async (): Promise<void> => {
    if (!killConfirm) {
      return
    }
    const target = killConfirm
    setKilling(true)
    removeSession(target.sessionId)
    try {
      await getClientRuntime().terminal.kill(target.sessionId)
    } catch {
      /* The daemon may have already removed the session. */
    } finally {
      if (mountedRef.current) {
        setKilling(false)
        setKillConfirm(null)
        cancelPopoverBodyFocusFrame()
        if (popoverBodyRef.current) {
          popoverBodyFocusFrameRef.current = requestAnimationFrame(() => {
            popoverBodyFocusFrameRef.current = null
            popoverBodyRef.current?.focus()
          })
        }
        void refreshSessions()
      }
    }
  }, [cancelPopoverBodyFocusFrame, killConfirm, mountedRef, refreshSessions, removeSession])
  const openSpaceResults = useCallback((): void => {
    setOpen(false)
    openSpacePage()
  }, [openSpacePage, setOpen])

  return {
    collapsedRepos,
    toggleRepo,
    collapsedWorktrees,
    toggleWorktree,
    appCollapsed,
    setAppCollapsed,
    setPopoverBodyNode,
    navigateToWorktree,
    navigateToTab,
    deleteWorktree,
    handleOpenWorkspaceCleanup,
    openSpaceResults,
    handleKillSession,
    handleKillOrphans,
    killConfirm,
    killing,
    setKillConfirm,
    runKillConfirmed
  }
}
