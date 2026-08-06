import { useCallback } from 'react'
import { useAppStore } from '../../store'
import { destroyWorkspaceWebviews } from '../../store/slices/browser-webview-cleanup'
import { requestEditorFileClose } from '../editor/editor-autosave'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import {
  activateWebRuntimeSessionTab,
  closeWebRuntimeSessionTab,
  isWebRuntimeSessionActive
} from '../../runtime/web-runtime-session'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { browserWorkspaceHasRemoteOwner } from '@/runtime/remote-browser-tab-ownership'

export function useTabGroupWorkspaceCloseActions(
  context: Record<string, any>
): Record<string, any> {
  const {
    groupTabs,
    group,
    worktreeId,
    groupId,
    closeFile,
    setActiveWorktree,
    closeBrowserTab,
    closeUnifiedTab,
    closeTab,
    closeEmptyGroup
  } = context

  const closeEditorIfUnreferenced = useCallback(
    (entityId: string, closingTabId: string) => {
      const otherReference = (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).some(
        (item) =>
          item.id !== closingTabId &&
          item.entityId === entityId &&
          (item.contentType === 'editor' ||
            item.contentType === 'diff' ||
            item.contentType === 'conflict-review' ||
            item.contentType === 'check-details')
      )
      if (!otherReference) {
        const file = useAppStore.getState().openFiles.find((candidate) => candidate.id === entityId)
        if (file?.isDirty) {
          // Why: route through Terminal.tsx so the unsaved-confirmation save/discard queue stays centralized across all close paths.
          requestEditorFileClose(entityId)
          return false
        }
        closeFile(entityId)
      }
      return true
    },
    [closeFile, worktreeId]
  )

  const leaveWorktreeIfEmpty = useCallback(() => {
    const state = useAppStore.getState()
    if (state.activeWorktreeId !== worktreeId) {
      return
    }
    // Why: split-group closes bypass legacy Terminal.tsx; deselect the emptied worktree here or the window goes blank instead of landing.
    const { renderableTabCount } = state.reconcileWorktreeTabModel(worktreeId)
    if (renderableTabCount === 0) {
      setActiveWorktree(null)
    }
  }, [setActiveWorktree, worktreeId])

  const closeItem = useCallback(
    (itemId: string, opts?: { skipEmptyCheck?: boolean }) => {
      const item = groupTabs.find((candidate) => candidate.id === itemId)
      if (!item) {
        return
      }
      if (item.isPinned) {
        return
      }
      const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(
        useAppStore.getState(),
        worktreeId
      )
      if (item.contentType === 'terminal') {
        closeTerminalTab(item.entityId)
        if (!opts?.skipEmptyCheck) {
          leaveWorktreeIfEmpty()
        }
        return
      }
      if (item.contentType === 'browser') {
        const browserState = useAppStore.getState()
        const hasLocalPages = (browserState.browserPagesByWorkspace[item.entityId] ?? []).length > 0
        // Why: host-close a remote-owned browser or a pageless host-mirror (else un-closable); local fallbacks have pages so stay local.
        const shouldCloseOnHost =
          isWebRuntimeSessionActive(runtimeEnvironmentId) &&
          (browserWorkspaceHasRemoteOwner(browserState, item.entityId, runtimeEnvironmentId) ||
            !hasLocalPages)
        if (shouldCloseOnHost) {
          void closeWebRuntimeSessionTab({
            worktreeId,
            tabId: item.id,
            environmentId: runtimeEnvironmentId,
            reason: 'user'
          })
        }
        destroyWorkspaceWebviews(browserState.browserPagesByWorkspace, item.entityId)
        closeBrowserTab(item.entityId)
        closeUnifiedTab(item.id)
      } else {
        const canCloseTab = closeEditorIfUnreferenced(item.entityId, item.id)
        if (!canCloseTab) {
          return
        }
        closeUnifiedTab(item.id)
      }
      if (!opts?.skipEmptyCheck) {
        leaveWorktreeIfEmpty()
      }
    },
    [
      closeBrowserTab,
      closeEditorIfUnreferenced,
      closeUnifiedTab,
      groupTabs,
      leaveWorktreeIfEmpty,
      worktreeId
    ]
  )

  const closeMany = useCallback(
    (itemIds: string[]) => {
      for (const itemId of itemIds) {
        const item = groupTabs.find((candidate) => candidate.id === itemId)
        if (!item || item.isPinned) {
          continue
        }
        const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(
          useAppStore.getState(),
          worktreeId
        )
        if (item.contentType === 'terminal' && isWebRuntimeSessionActive(runtimeEnvironmentId)) {
          // Why: revoke local resume + hook authority before the host removes its canonical tab.
          closeTerminalTab(item.entityId)
          continue
        }
        if (item.contentType === 'browser') {
          // Why: see closeItem — host-close a remote-owned browser or pageless host-mirror; always remove the visible tab.
          const browserState = useAppStore.getState()
          const hasLocalPages =
            (browserState.browserPagesByWorkspace[item.entityId] ?? []).length > 0
          const shouldCloseOnHost =
            isWebRuntimeSessionActive(runtimeEnvironmentId) &&
            (browserWorkspaceHasRemoteOwner(browserState, item.entityId, runtimeEnvironmentId) ||
              !hasLocalPages)
          if (shouldCloseOnHost) {
            void closeWebRuntimeSessionTab({
              worktreeId,
              tabId: item.id,
              environmentId: runtimeEnvironmentId,
              reason: 'user'
            })
          }
          destroyWorkspaceWebviews(browserState.browserPagesByWorkspace, item.entityId)
          closeBrowserTab(item.entityId)
          closeUnifiedTab(item.id)
        } else if (item.contentType === 'terminal') {
          closeTab(item.entityId)
        } else {
          const canCloseTab = closeEditorIfUnreferenced(item.entityId, item.id)
          if (canCloseTab) {
            closeUnifiedTab(item.id)
          }
        }
      }
    },
    [closeBrowserTab, closeEditorIfUnreferenced, closeTab, closeUnifiedTab, groupTabs, worktreeId]
  )
  const closeGroup = useCallback(() => {
    const items = [...(useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? [])].filter(
      (item) => item.groupId === groupId
    )
    for (const item of items) {
      closeItem(item.id, { skipEmptyCheck: true })
    }
    // Why: closing tabs doesn't remove the group shell; empty split groups are layout state, collapse the placeholder pane here.
    closeEmptyGroup(worktreeId, groupId)
    leaveWorktreeIfEmpty()
  }, [closeEmptyGroup, closeItem, groupId, leaveWorktreeIfEmpty, worktreeId])

  const closeAllEditorTabsInGroup = useCallback(() => {
    for (const item of groupTabs) {
      if (
        item.contentType === 'editor' ||
        item.contentType === 'diff' ||
        item.contentType === 'conflict-review' ||
        item.contentType === 'check-details'
      ) {
        closeItem(item.id)
      }
    }
  }, [closeItem, groupTabs])

  const closeOthers = useCallback(
    (itemId: string) => {
      const item = groupTabs.find((candidate) => candidate.id === itemId)
      if (!item) {
        return
      }
      // Why: store closeOtherTabs strands dirty files if the save dialog is cancelled; route via closeMany to stay dirty-aware.
      const siblingIds = groupTabs
        .filter((candidate) => candidate.id !== itemId && !candidate.isPinned)
        .map((candidate) => candidate.id)
      closeMany(siblingIds)
    },
    [closeMany, groupTabs]
  )

  const closeToRight = useCallback(
    (itemId: string) => {
      // Why: store closeTabsToRight pre-closes dirty tabs; walk tabOrder (canonical L-to-R) via closeMany to stay dirty-aware.
      const order = group?.tabOrder ?? []
      const index = order.indexOf(itemId)
      if (index === -1) {
        return
      }
      const tabById = new Map(groupTabs.map((candidate) => [candidate.id, candidate]))
      const rightIds = order.slice(index + 1).filter((id) => {
        const candidate = tabById.get(id)
        return candidate ? !candidate.isPinned : false
      })
      closeMany(rightIds)
    },
    [closeMany, group, groupTabs]
  )

  const closeToLeft = useCallback(
    (itemId: string) => {
      // Why: see closeToRight — walk tabOrder locally and route through the
      // dirty-aware closeMany path instead of the store helper.
      const order = group?.tabOrder ?? []
      const index = order.indexOf(itemId)
      if (index === -1) {
        return
      }
      const tabById = new Map(groupTabs.map((candidate) => [candidate.id, candidate]))
      const leftIds = order.slice(0, index).filter((id) => {
        const candidate = tabById.get(id)
        return candidate ? !candidate.isPinned : false
      })
      closeMany(leftIds)
    },
    [closeMany, group, groupTabs]
  )

  return {
    closeEditorIfUnreferenced,
    leaveWorktreeIfEmpty,
    closeItem,
    closeMany,
    closeGroup,
    closeAllEditorTabsInGroup,
    closeOthers,
    closeToRight,
    closeToLeft
  }
}
