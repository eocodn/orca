import { type Tab, type TerminalTab, type WorkspaceSessionState, LOCAL_EXECUTION_HOST_ID, type ExecutionHostId, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, getRepoIdFromWorktreeId, retireTerminalSurfacesFromSnapshot, type RetiredTerminalSurface, retireTerminalSurfaceFromPersistence, MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES, MAX_TERMINAL_SURFACE_RETIREMENT_FENCES } from './orca-runtime-symbols'
import { OrcaRuntimeApplyMobileSessionRetirementFencesPart10 } from './orca-runtime-apply-mobile-session-retirement-fences-part-10'

export class OrcaRuntimeRetireMobileSessionSurfacesForPtyPart11 extends OrcaRuntimeApplyMobileSessionRetirementFencesPart10 {
  protected retireMobileSessionSurfacesForPty(
    ptyId: string,
    incarnationId: string,
    exactSurfaces: readonly Pick<RetiredTerminalSurface, 'worktreeId' | 'parentTabId' | 'leafId'>[],
    options: { ensureDurableFlush?: boolean } = {}
  ): boolean {
    const retiredSurfaceByKey = new Map<string, RetiredTerminalSurface>()
    for (const surface of exactSurfaces) {
      retiredSurfaceByKey.set(`${surface.worktreeId}\0${surface.parentTabId}\0${surface.leafId}`, {
        ...surface,
        ptyId,
        incarnationId
      })
    }
    for (const [worktreeId, snapshot] of this.mobileSessionTabsByWorktree) {
      const retired = retireTerminalSurfacesFromSnapshot({
        snapshot,
        ptyId,
        exactSurfaces: exactSurfaces.filter((surface) => surface.worktreeId === worktreeId)
      })
      if (!retired) {
        continue
      }
      for (const surface of retired.retired) {
        retiredSurfaceByKey.set(
          `${surface.worktreeId}\0${surface.parentTabId}\0${surface.leafId}`,
          { ...surface, incarnationId }
        )
      }
    }
    const retiredSurfaces = [...retiredSurfaceByKey.values()]
    if (retiredSurfaces.length === 0) {
      return true
    }
    let publishableRetiredSurfaces = retiredSurfaces
    const nextSessionByHostId = new Map<ExecutionHostId, WorkspaceSessionState>()
    const sessionBeforeRetirementByHostId = new Map<ExecutionHostId, WorkspaceSessionState>()
    const acceptedSurfaces: RetiredTerminalSurface[] = []
    let durableIncarnationMismatch = false
    for (const surface of retiredSurfaces) {
      let hostId: ExecutionHostId
      try {
        // Why: one PTY can retain surfaces from worktrees backed by different execution hosts.
        hostId = this.getWorkspaceSessionHostIdForWorktree(surface.worktreeId)
      } catch (error) {
        if (error instanceof Error && error.message === 'folder_workspace_not_found') {
          // Why: deleting the folder workspace removes its durable session authority; only the in-memory PTY surface remains to retire.
          if (
            !this.deletedFolderTerminalRetirementFences.has(
              `${surface.worktreeId}\0${surface.parentTabId}\0${surface.leafId}`
            ) &&
            this.deletedFolderTerminalRetirementFences.size >=
              MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES
          ) {
            const oldestFence = this.deletedFolderTerminalRetirementFences.values().next().value
            if (oldestFence !== undefined) {
              this.deletedFolderTerminalRetirementFences.delete(oldestFence)
              console.warn('[runtime] evicted oldest deleted-folder terminal retirement fence')
            }
          }
          this.deletedFolderTerminalRetirementFences.add(
            `${surface.worktreeId}\0${surface.parentTabId}\0${surface.leafId}`
          )
          console.warn('[runtime] skipping durable retirement for deleted folder workspace')
          acceptedSurfaces.push(surface)
          continue
        }
        console.error('[runtime] failed to resolve terminal retirement host:', error)
        return false
      }
      const currentSession =
        sessionBeforeRetirementByHostId.get(hostId) ?? this.store?.getWorkspaceSession?.(hostId)
      if (!currentSession) {
        continue
      }
      sessionBeforeRetirementByHostId.set(hostId, currentSession)
      const nextSession = nextSessionByHostId.get(hostId) ?? currentSession
      const retiredSession = retireTerminalSurfaceFromPersistence(nextSession, surface)
      if (retiredSession !== nextSession) {
        acceptedSurfaces.push(surface)
        nextSessionByHostId.set(hostId, retiredSession)
      } else if (
        currentSession.terminalPtyIncarnationsByPaneKey?.[
          `${surface.parentTabId}:${surface.leafId}`
        ] !== undefined &&
        currentSession.terminalPtyIncarnationsByPaneKey[
          `${surface.parentTabId}:${surface.leafId}`
        ] !== surface.incarnationId
      ) {
        // Why: a different durable incarnation proves this exit cannot retire the persisted surface; keep the old retry authority.
        durableIncarnationMismatch = true
      }
    }
    if (sessionBeforeRetirementByHostId.size > 0) {
      // Why: publishing absence before its host membership fence is durable lets a crash or
      // stale renderer write resurrect the retired surface.
      if (!this.store?.setWorkspaceSession || !this.store.flushOrThrow) {
        return false
      }
      if (acceptedSurfaces.length === 0) {
        if (durableIncarnationMismatch) {
          return false
        }
        if (options.ensureDurableFlush) {
          try {
            this.store.flushOrThrow()
          } catch (error) {
            console.error('[runtime] failed to flush terminal retirement retry:', error)
            return false
          }
        }
        return true
      }
      try {
        for (const [hostId, nextSession] of nextSessionByHostId) {
          if (hostId === LOCAL_EXECUTION_HOST_ID) {
            this.store.setWorkspaceSession(nextSession)
          } else {
            this.store.setWorkspaceSession(nextSession, hostId)
          }
        }
        this.store.flushOrThrow()
      } catch (error) {
        console.error('[runtime] failed to persist terminal retirement:', error)
        for (const [hostId, sessionBeforeRetirement] of sessionBeforeRetirementByHostId) {
          try {
            if (hostId === LOCAL_EXECUTION_HOST_ID) {
              this.store.setWorkspaceSession(sessionBeforeRetirement)
            } else {
              this.store.setWorkspaceSession(sessionBeforeRetirement, hostId)
            }
          } catch (rollbackError) {
            console.error('[runtime] failed to roll back terminal retirement:', rollbackError)
          }
        }
        return false
      }
      // Why: one repo epoch can cover multiple exits, but only surfaces individually accepted by persistence may disappear.
      publishableRetiredSurfaces = acceptedSurfaces
    } else {
      for (const surface of retiredSurfaces) {
        const repoId = getRepoIdFromWorktreeId(surface.worktreeId)

        this.terminalTopologyRevisionByRepoId.set(
          repoId,
          (this.terminalTopologyRevisionByRepoId.get(repoId) ?? 0) + 1
        )
      }
    }
    for (const surface of publishableRetiredSurfaces) {
      const fence = `${surface.worktreeId}\0${surface.parentTabId}\0${surface.leafId}`
      if (!this.terminalSurfaceRetirementFences.has(fence)) {
        if (this.terminalSurfaceRetirementFences.size >= MAX_TERMINAL_SURFACE_RETIREMENT_FENCES) {
          const oldestFence = this.terminalSurfaceRetirementFences.values().next().value
          if (oldestFence !== undefined) {
            this.terminalSurfaceRetirementFences.delete(oldestFence)
          }
        }
        this.terminalSurfaceRetirementFences.add(fence)
      }
    }
    for (const [worktreeId, snapshot] of this.mobileSessionTabsByWorktree) {
      const retired = retireTerminalSurfacesFromSnapshot({
        snapshot,
        ptyId,
        exactSurfaces: publishableRetiredSurfaces.filter(
          (surface) => surface.worktreeId === worktreeId
        ),
        // Why: discovery is broad by PTY id, but publication may remove only surfaces whose durable retirement was accepted.
        exactOnly: true
      })
      if (retired) {
        this.mobileSessionTabsByWorktree.set(worktreeId, retired.snapshot)
        this.notifyMobileSessionTabsChanged(worktreeId)
      }
    }
    return true
  }
  protected buildHeadlessMobileSessionTerminalTabs(
    worktreeId: string,
    persistedTabs: readonly TerminalTab[]
  ): RuntimeMobileSessionTerminalTab[] {
    const session = this.getWorkspaceSessionForWorktree(worktreeId)
    if (!session) {
      return []
    }
    return [...persistedTabs]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
      .flatMap((tab, index) => {
        const layout = session.terminalLayoutsByTabId?.[tab.id]
        const leafIds = this.collectPersistedTerminalLeafIds(layout)
        if (leafIds.length === 0) {
          leafIds.push(this.deriveHeadlessLegacyTerminalLeafId(tab.id))
        }
        return leafIds.flatMap((leafId) => {
          const ptyId =
            layout?.ptyIdsByLeafId?.[leafId] ?? (leafIds.length === 1 ? tab.ptyId : null)
          const title =
            tab.customTitle?.trim() ||
            tab.generatedTitle?.trim() ||
            tab.title?.trim() ||
            tab.defaultTitle?.trim() ||
            `Terminal ${index + 1}`
          return [
            {
              type: 'terminal' as const,
              id: `${tab.id}::${leafId}`,
              parentTabId: tab.id,
              leafId,
              title,
              ...(ptyId ? { ptyId } : {}),
              ...(tab.startupCwd ? { startupCwd: tab.startupCwd } : {}),
              ...(tab.launchAgent ? { launchAgent: tab.launchAgent } : {}),
              ...(layout ? { parentLayout: this.cloneTerminalLayoutSnapshot(layout) } : {}),
              ...(tab.color != null ? { color: tab.color } : {}),
              ...(tab.isPinned ? { isPinned: true } : {}),
              ...(tab.viewMode ? { viewMode: tab.viewMode } : {}),
              isActive: this.isPersistedTerminalLeafActive(worktreeId, tab.id, leafId, layout)
            }
          ]
        })
      })
  }

  // Why: headless serve backs browser panes with offscreen WebContents that live
  // only in the BrowserManager, never in a renderer graph. Without surfacing them
  // as session tabs, a session.tabs snapshot (e.g. on terminal open) prunes the
  // paired browser tab and closing it fails with tab_not_found. Synthesize browser
  // session tabs from the live bridge so they are first-class alongside terminals.
  protected buildHeadlessMobileSessionBrowserTabs(
    worktreeId: string
  ): RuntimeMobileSessionBrowserTab[] {
    if (!this.offscreenBrowserBackend || !this.browserTabRegistry?.tabList) {
      return []
    }
    return this.browserTabRegistry.tabList(worktreeId).tabs.map((tab) => {
      const persistedProps = this.getPersistedUnifiedSessionTabProps(worktreeId, tab.browserPageId)
      return {
        type: 'browser' as const,
        // Why: an offscreen page has no separate workspace identity, so the page id
        // is its own workspace id (matches the server's browserWorkspaceId fallback).
        id: tab.browserPageId,
        title: tab.title || tab.url || 'Browser',
        browserWorkspaceId: tab.browserPageId,
        browserPageId: tab.browserPageId,
        url: tab.url || 'about:blank',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        loadError: tab.loadError ?? undefined,
        certificateFailure: tab.certificateFailure ?? undefined,
        ...(persistedProps ? { color: persistedProps.color } : {}),
        ...(persistedProps ? { isPinned: persistedProps.isPinned === true } : {}),
        isActive: tab.active === true
      }
    })
  }

  // Why: change detection for headless browser tabs. Compares the fields that
  // actually vary (a JSON.stringify equality was order-sensitive and silently
  // dropped `undefined` keys, so it only worked while both sides shared one
  // construction path).
  protected headlessBrowserTabsUnchanged(
    live: RuntimeMobileSessionBrowserTab[],
    existing: RuntimeMobileSessionBrowserTab[]
  ): boolean {
    if (live.length !== existing.length) {
      return false
    }
    return live.every((tab, index) => {
      const prev = existing[index]
      return (
        tab.id === prev.id &&
        tab.title === prev.title &&
        tab.url === prev.url &&
        tab.isActive === prev.isActive &&
        (tab.isPinned ?? false) === (prev.isPinned ?? false) &&
        (tab.color ?? null) === (prev.color ?? null) &&
        this.browserLoadErrorsEqual(tab.loadError, prev.loadError) &&
        this.browserCertificateFailuresEqual(tab.certificateFailure, prev.certificateFailure)
      )
    })
  }
  protected browserLoadErrorsEqual(
    a: RuntimeMobileSessionBrowserTab['loadError'],
    b: RuntimeMobileSessionBrowserTab['loadError']
  ): boolean {
    const left = a ?? null
    const right = b ?? null
    if (left === right) {
      return true
    }
    if (!left || !right) {
      return false
    }
    return (
      left.code === right.code &&
      left.description === right.description &&
      left.validatedUrl === right.validatedUrl
    )
  }
  protected browserCertificateFailuresEqual(
    a: RuntimeMobileSessionBrowserTab['certificateFailure'],
    b: RuntimeMobileSessionBrowserTab['certificateFailure']
  ): boolean {
    const left = a ?? null
    const right = b ?? null
    if (left === right) {
      return true
    }
    if (!left || !right) {
      return false
    }
    return (
      left.challengeId === right.challengeId &&
      left.browserPageId === right.browserPageId &&
      left.errorCode === right.errorCode &&
      left.error === right.error &&
      left.origin === right.origin &&
      left.displayHost === right.displayHost &&
      left.canProceed === right.canProceed &&
      left.observedAt === right.observedAt
    )
  }
  protected getPersistedUnifiedSessionTabProps(
    worktreeId: string,
    tabId: string
  ): Pick<Tab, 'color' | 'isPinned'> | null {
    const tab =
      this.getWorkspaceSessionForWorktree(worktreeId)?.unifiedTabs?.[worktreeId]?.find(
        (candidate) => candidate.id === tabId || candidate.entityId === tabId
      ) ?? null
    return tab ? { color: tab.color, isPinned: tab.isPinned } : null
  }
}
