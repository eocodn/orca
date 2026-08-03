import { randomUUID, type RuntimeTerminalOrphanAdoptionRequest, type RuntimeTerminalOrphanAdoptionResult, type RuntimeMobileSessionTerminalTab, getRepoIdFromWorktreeId, makePaneKey, hasExactTerminalOrphanGroupLayout, mergeTerminalOrphanGroupLayout, terminalOrphanExecutionOwnersEqual, advanceTerminalTopologyRevision, getLocalProjectWorktreeGitOptions, canonicalizeTerminalSessionWorktreeId, getLatestPtyTitle, resolveTerminalSessionWorktreeId, runtimeWorktreeIdsEqual, type PtyControllerInventory, type TerminalWorkspaceLaunchScope } from './orca-runtime-symbols'
import { OrcaRuntimeListTerminalsPart38 } from './orca-runtime-list-terminals-part-38'

export class OrcaRuntimeAdoptTerminalOrphansFromInventoryPart39 extends OrcaRuntimeListTerminalsPart38 {
  protected async adoptTerminalOrphansFromInventory(
    request: RuntimeTerminalOrphanAdoptionRequest,
    workspace: TerminalWorkspaceLaunchScope,
    inventory: PtyControllerInventory
  ): Promise<RuntimeTerminalOrphanAdoptionResult> {
    const { livePtyIds, terminalIdentityByPtyId } = inventory
    const store = this.store
    const session = this.getWorkspaceSessionForWorktree(workspace.id)
    if (!store?.setWorkspaceSession || !store.flushOrThrow || !session) {
      throw new Error('workspace_session_unavailable')
    }
    const sessionWorktreeId = resolveTerminalSessionWorktreeId(session, workspace.id)
    if (!sessionWorktreeId) {
      throw new Error('terminal_orphan_competing_owner')
    }
    const repoId = getRepoIdFromWorktreeId(workspace.id)
    const worktreeConnectionId = workspace.connectionId
    let worktreeWslDistro: string | null = null
    if (!worktreeConnectionId && workspace.repo) {
      try {
        worktreeWslDistro =
          getLocalProjectWorktreeGitOptions(this.requireStore(), workspace.repo).wslDistro ?? null
      } catch {
        throw new Error('terminal_orphan_owner_mismatch')
      }
    }
    const currentRevision = this.getTerminalTopologyRevision(workspace.id)
    const seenPtyIds = new Set<string>()
    const seenPaneKeys = new Set<string>()
    const validated = request.claims.map((claim) => {
      const paneKey = makePaneKey(claim.tabId, claim.leafId)
      if (seenPtyIds.has(claim.ptyId) || seenPaneKeys.has(paneKey)) {
        throw new Error('terminal_orphan_claim_duplicate')
      }
      seenPtyIds.add(claim.ptyId)
      seenPaneKeys.add(paneKey)
      const live = this.getLivePtyForHandle(claim.terminal)
      const pty = live?.pty
      const controllerIdentity = terminalIdentityByPtyId.get(claim.ptyId)
      if (
        !pty ||
        pty.ptyId !== claim.ptyId ||
        controllerIdentity?.handle !== claim.terminal ||
        controllerIdentity?.incarnationId !== claim.incarnationId ||
        !livePtyIds.has(claim.ptyId) ||
        !pty.connected ||
        !pty.incarnationId ||
        pty.incarnationId !== claim.incarnationId
      ) {
        throw new Error('terminal_orphan_stale')
      }
      if (
        !runtimeWorktreeIdsEqual(pty.worktreeId, workspace.id) ||
        !terminalOrphanExecutionOwnersEqual(
          { connectionId: worktreeConnectionId, wslDistro: worktreeWslDistro },
          {
            connectionId: pty.connectionId ?? null,
            ...(controllerIdentity?.wslDistro !== undefined
              ? { wslDistro: controllerIdentity.wslDistro }
              : process.platform === 'win32' && !worktreeConnectionId
                ? {}
                : { wslDistro: null })
          }
        )
      ) {
        throw new Error('terminal_orphan_owner_mismatch')
      }
      const visualOwners = this.getLeavesForPty(claim.ptyId)
      if (
        visualOwners.some(
          (owner) =>
            !runtimeWorktreeIdsEqual(owner.worktreeId, workspace.id) ||
            owner.tabId !== claim.tabId ||
            owner.leafId !== claim.leafId
        )
      ) {
        throw new Error('terminal_orphan_already_visual')
      }
      if ((pty.tabId && pty.tabId !== claim.tabId) || (pty.paneKey && pty.paneKey !== paneKey)) {
        throw new Error('terminal_orphan_competing_owner')
      }
      return { claim, pty, paneKey }
    })

    const persistedBindingsByPtyId = new Map<string, { worktreeId: string; paneKey: string }[]>()
    const addPersistedBinding = (
      ptyId: string,
      binding: { worktreeId: string; paneKey: string }
    ): void => {
      const bindings = persistedBindingsByPtyId.get(ptyId) ?? []
      bindings.push(binding)
      persistedBindingsByPtyId.set(ptyId, bindings)
    }
    for (const [worktreeId, tabs] of Object.entries(session.tabsByWorktree)) {
      for (const tab of tabs) {
        const layout = session.terminalLayoutsByTabId[tab.id]
        for (const [leafId, boundPtyId] of Object.entries(layout?.ptyIdsByLeafId ?? {})) {
          if (boundPtyId) {
            addPersistedBinding(boundPtyId, {
              worktreeId,
              paneKey: makePaneKey(tab.id, leafId)
            })
          }
        }
        if (tab.ptyId && !layout) {
          addPersistedBinding(tab.ptyId, { worktreeId, paneKey: tab.id })
        }
      }
    }
    const persistedBinding = (ptyId: string): { worktreeId: string; paneKey: string } | null => {
      const bindings = persistedBindingsByPtyId.get(ptyId) ?? []
      if (bindings.length > 1) {
        throw new Error('terminal_orphan_competing_owner')
      }
      return bindings[0] ?? null
    }
    const isExactPersisted = validated.every(({ claim, paneKey }) => {
      const binding = persistedBinding(claim.ptyId)
      return (
        binding !== null &&
        runtimeWorktreeIdsEqual(binding.worktreeId, workspace.id) &&
        binding.paneKey === paneKey &&
        session.terminalPtyIncarnationsByPaneKey?.[paneKey] === claim.incarnationId
      )
    })
    if (isExactPersisted && sessionWorktreeId === workspace.id) {
      for (const { claim, pty, paneKey } of validated) {
        pty.tabId = claim.tabId
        pty.paneKey = paneKey
      }
      return {
        adopted: false,
        topologyRevision: currentRevision,
        snapshot: this.getTerminalOrphanAdoptionSnapshot(workspace.id)
      }
    }
    if (currentRevision !== request.expectedTopologyRevision) {
      throw new Error('terminal_topology_conflict')
    }

    const topologyTabsById = new Map(request.topology?.tabs.map((tab) => [tab.tabId, tab]) ?? [])
    const topologyGroups = request.topology?.groups ?? []
    if (request.topology) {
      const claimedLeafIdsByTabId = new Map<string, Set<string>>()
      for (const { claim } of validated) {
        const leafIds = claimedLeafIdsByTabId.get(claim.tabId) ?? new Set<string>()
        leafIds.add(claim.leafId)
        claimedLeafIdsByTabId.set(claim.tabId, leafIds)
      }
      if (
        topologyTabsById.size !== request.topology.tabs.length ||
        topologyTabsById.size !== claimedLeafIdsByTabId.size
      ) {
        throw new Error('terminal_orphan_topology_invalid')
      }
      for (const [tabId, claimedLeafIds] of claimedLeafIdsByTabId) {
        const topologyTab = topologyTabsById.get(tabId)
        if (!topologyTab) {
          throw new Error('terminal_orphan_topology_invalid')
        }
        const topologyLeafIds = new Set<string>()
        const nodes = [topologyTab.root]
        let leafCount = 0
        while (nodes.length > 0) {
          const node = nodes.pop()!
          if (node.type === 'leaf') {
            leafCount += 1
            topologyLeafIds.add(node.leafId)
          } else {
            nodes.push(node.first, node.second)
          }
        }
        if (
          leafCount !== topologyLeafIds.size ||
          topologyLeafIds.size !== claimedLeafIds.size ||
          [...topologyLeafIds].some((leafId) => !claimedLeafIds.has(leafId)) ||
          !topologyLeafIds.has(topologyTab.activeLeafId) ||
          (topologyTab.expandedLeafId !== null && !topologyLeafIds.has(topologyTab.expandedLeafId))
        ) {
          throw new Error('terminal_orphan_topology_invalid')
        }
      }
      const seenGroupIds = new Set<string>()
      const groupedTabIds = new Set<string>()
      for (const group of topologyGroups) {
        if (seenGroupIds.has(group.id) || !group.tabOrder.includes(group.activeTabId)) {
          throw new Error('terminal_orphan_topology_invalid')
        }
        seenGroupIds.add(group.id)
        for (const tabId of group.tabOrder) {
          if (!topologyTabsById.has(tabId) || groupedTabIds.has(tabId)) {
            throw new Error('terminal_orphan_topology_invalid')
          }
          groupedTabIds.add(tabId)
        }
        if (group.recentTabIds?.some((tabId) => !group.tabOrder.includes(tabId))) {
          throw new Error('terminal_orphan_topology_invalid')
        }
      }
      if (groupedTabIds.size !== topologyTabsById.size) {
        throw new Error('terminal_orphan_topology_invalid')
      }
      if (request.topology.groupLayout) {
        if (!hasExactTerminalOrphanGroupLayout(request.topology.groupLayout, seenGroupIds)) {
          throw new Error('terminal_orphan_topology_invalid')
        }
      }
    }

    for (const { claim, paneKey } of validated) {
      const existingBinding = persistedBinding(claim.ptyId)
      if (
        existingBinding &&
        (!runtimeWorktreeIdsEqual(existingBinding.worktreeId, workspace.id) ||
          existingBinding.paneKey !== paneKey)
      ) {
        throw new Error('terminal_orphan_competing_owner')
      }
      const proposedPtyId =
        session.terminalLayoutsByTabId[claim.tabId]?.ptyIdsByLeafId?.[claim.leafId]
      if (proposedPtyId && proposedPtyId !== claim.ptyId) {
        throw new Error('terminal_orphan_surface_occupied')
      }
      const graphOwner = this.leaves.get(this.getLeafKey(claim.tabId, claim.leafId))
      if (
        graphOwner &&
        (graphOwner.ptyId !== claim.ptyId ||
          !runtimeWorktreeIdsEqual(graphOwner.worktreeId, workspace.id))
      ) {
        throw new Error('terminal_orphan_surface_occupied')
      }
      if (
        Object.entries(session.tabsByWorktree).some(
          ([ownerWorktreeId, tabs]) =>
            !runtimeWorktreeIdsEqual(ownerWorktreeId, workspace.id) &&
            tabs.some((tab) => tab.id === claim.tabId)
        )
      ) {
        throw new Error('terminal_orphan_surface_occupied')
      }
      if (session.terminalSurfaceTombstonesByPaneKey?.[paneKey]) {
        throw new Error('terminal_orphan_surface_retired')
      }
      for (const snapshot of this.mobileSessionTabsByWorktree.values()) {
        const surfaceOwner = snapshot.tabs.find(
          (tab): tab is RuntimeMobileSessionTerminalTab =>
            tab.type === 'terminal' &&
            tab.parentTabId === claim.tabId &&
            tab.leafId === claim.leafId
        )
        if (
          surfaceOwner &&
          (snapshot.worktree !== workspace.id || surfaceOwner.ptyId !== claim.ptyId)
        ) {
          throw new Error('terminal_orphan_surface_occupied')
        }
        const owner = snapshot.tabs.find(
          (tab): tab is RuntimeMobileSessionTerminalTab =>
            tab.type === 'terminal' && tab.ptyId === claim.ptyId
        )
        if (
          owner &&
          (snapshot.worktree !== workspace.id ||
            owner.parentTabId !== claim.tabId ||
            owner.leafId !== claim.leafId)
        ) {
          throw new Error('terminal_orphan_competing_owner')
        }
      }
    }

    const next = structuredClone(session)
    canonicalizeTerminalSessionWorktreeId(next, sessionWorktreeId, workspace.id)
    const existingTabs = next.tabsByWorktree[workspace.id] ?? []
    const tabsById = new Map(existingTabs.map((tab) => [tab.id, tab]))
    for (const { claim, pty, paneKey } of validated) {
      let tab = tabsById.get(claim.tabId)
      if (!tab) {
        const title =
          getLatestPtyTitle(pty) ?? pty.controllerTitle ?? `Terminal ${tabsById.size + 1}`
        tab = {
          id: claim.tabId,
          ptyId: claim.ptyId,
          worktreeId: workspace.id,
          title,
          defaultTitle: title,
          customTitle: null,
          color: null,
          sortOrder: tabsById.size,
          createdAt: Date.now(),
          pendingActivationSpawn: true
        }
        tabsById.set(claim.tabId, tab)
      }
      const existingLayout = next.terminalLayoutsByTabId[claim.tabId]
      const topologyTab = topologyTabsById.get(claim.tabId)
      next.terminalLayoutsByTabId[claim.tabId] = topologyTab
        ? {
            ...existingLayout,
            root: topologyTab.root,
            activeLeafId: topologyTab.activeLeafId,
            expandedLeafId: topologyTab.expandedLeafId,
            ptyIdsByLeafId: {
              ...existingLayout?.ptyIdsByLeafId,
              [claim.leafId]: claim.ptyId
            }
          }
        : existingLayout
          ? {
              ...existingLayout,
              root: this.collectPersistedTerminalLeafIds(existingLayout).includes(claim.leafId)
                ? existingLayout.root
                : existingLayout.root === null
                  ? { type: 'leaf', leafId: claim.leafId }
                  : {
                      type: 'split',
                      direction: 'vertical',
                      first: existingLayout.root,
                      second: { type: 'leaf', leafId: claim.leafId }
                    },
              ptyIdsByLeafId: {
                ...existingLayout.ptyIdsByLeafId,
                [claim.leafId]: claim.ptyId
              }
            }
          : {
              root: { type: 'leaf', leafId: claim.leafId },
              activeLeafId: claim.leafId,
              expandedLeafId: null,
              ptyIdsByLeafId: { [claim.leafId]: claim.ptyId }
            }
      next.terminalPtyIncarnationsByPaneKey = {
        ...next.terminalPtyIncarnationsByPaneKey,
        [paneKey]: claim.incarnationId
      }
    }
    const adoptedTabIds = [...new Set(validated.map(({ claim }) => claim.tabId))]
    next.tabsByWorktree[workspace.id] = [...tabsById.values()]
    const activeTabId =
      request.activeTabId && tabsById.has(request.activeTabId)
        ? request.activeTabId
        : (adoptedTabIds[0] ?? null)
    const existingGroups = next.tabGroups?.[workspace.id] ?? []
    const targetGroupId =
      (request.activeGroupId && existingGroups.some((group) => group.id === request.activeGroupId)
        ? request.activeGroupId
        : existingGroups[0]?.id) ??
      request.activeGroupId ??
      randomUUID()
    const proposedGroups = topologyGroups.map((group) => ({
      ...group,
      worktreeId: workspace.id
    }))
    const groups =
      existingGroups.length === 0 && proposedGroups.length > 0
        ? proposedGroups
        : existingGroups.length > 0
          ? existingGroups
              .map((group) => {
                const proposed = proposedGroups.find((candidate) => candidate.id === group.id)
                const tabOrder = proposed
                  ? [
                      ...group.tabOrder.filter((tabId) => !adoptedTabIds.includes(tabId)),
                      ...proposed.tabOrder
                    ]
                  : group.id === targetGroupId && proposedGroups.length === 0
                    ? [...new Set([...group.tabOrder, ...adoptedTabIds])]
                    : group.tabOrder.filter((tabId) => !adoptedTabIds.includes(tabId))
                return {
                  ...group,
                  tabOrder,
                  activeTabId: proposed
                    ? proposed.activeTabId
                    : group.id === targetGroupId && activeTabId
                      ? activeTabId
                      : group.activeTabId && tabOrder.includes(group.activeTabId)
                        ? group.activeTabId
                        : (tabOrder[0] ?? null),
                  ...(proposed?.recentTabIds ? { recentTabIds: proposed.recentTabIds } : {})
                }
              })
              .concat(
                proposedGroups.filter(
                  (proposed) => !existingGroups.some((group) => group.id === proposed.id)
                )
              )
          : [{ id: targetGroupId, worktreeId: workspace.id, activeTabId, tabOrder: adoptedTabIds }]
    const retainedGroups = groups.filter((group) => group.tabOrder.length > 0)
    next.tabGroups = {
      ...next.tabGroups,
      [workspace.id]: retainedGroups
    }
    const mergedGroupLayout = mergeTerminalOrphanGroupLayout({
      existingLayout: next.tabGroupLayouts?.[workspace.id],
      existingGroupIds: existingGroups.map((group) => group.id),
      proposedLayout: request.topology?.groupLayout,
      proposedGroupIds: proposedGroups.map((group) => group.id),
      mergedGroupIds: retainedGroups.map((group) => group.id)
    })
    if (mergedGroupLayout) {
      next.tabGroupLayouts = {
        ...next.tabGroupLayouts,
        [workspace.id]: mergedGroupLayout
      }
    }
    const activeGroup =
      (request.activeGroupId
        ? retainedGroups.find(
            (group) =>
              group.id === request.activeGroupId &&
              (!activeTabId || group.tabOrder.includes(activeTabId))
          )
        : undefined) ??
      retainedGroups.find((group) => activeTabId && group.tabOrder.includes(activeTabId)) ??
      retainedGroups[0]!
    const convergedActiveTabId =
      activeTabId && activeGroup.tabOrder.includes(activeTabId)
        ? activeTabId
        : activeGroup.activeTabId
    next.activeTabIdByWorktree = {
      ...next.activeTabIdByWorktree,
      ...(convergedActiveTabId ? { [workspace.id]: convergedActiveTabId } : {})
    }
    next.activeGroupIdByWorktree = {
      ...next.activeGroupIdByWorktree,
      [workspace.id]: activeGroup.id
    }
    const persisted = advanceTerminalTopologyRevision(next, workspace.id)
    try {
      this.setWorkspaceSessionForWorktree(workspace.id, persisted)
      store.flushOrThrow()
    } catch (error) {
      this.setWorkspaceSessionForWorktree(workspace.id, session)
      throw error
    }
    for (const { claim, pty, paneKey } of validated) {
      pty.tabId = claim.tabId
      pty.paneKey = paneKey
    }
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(workspace.id, {
      force: true,
      allowAttachedWindow: true,
      onlyRuntimeOwnedTerminals: true
    })
    this.notifyMobileSessionTabsChanged(workspace.id)
    return {
      adopted: true,
      topologyRevision: persisted.terminalTopologyRevisionByRepoId?.[repoId] ?? currentRevision + 1,
      snapshot: this.getTerminalOrphanAdoptionSnapshot(workspace.id)
    }
  }
}
