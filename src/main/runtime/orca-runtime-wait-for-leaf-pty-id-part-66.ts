import { type TerminalOscLinkRange, type RuntimeTerminalSplit, type RuntimeTerminalFocus, type RuntimeTerminalClose, type TerminalPaneSplitSource, parsePaneKey, countTerminalLayoutLeaves, getLatestPtyTitle, copySleepingAgentLaunchConfig } from './orca-runtime-symbols'
import { OrcaRuntimeCreateHeadlessMobileSessionTerminalPart65 } from './orca-runtime-create-headless-mobile-session-terminal-part-65'

export class OrcaRuntimeWaitForLeafPtyIdPart66 extends OrcaRuntimeCreateHeadlessMobileSessionTerminalPart65 {
  waitForLeafPtyId(handle: string, timeoutMs = 10_000, signal?: AbortSignal): Promise<string> {
    const leaf = this.resolveLeafForHandle(handle)
    if (leaf?.ptyId) {
      return Promise.resolve(leaf.ptyId)
    }

    // Why: ptyId null→real invalidates the old handle; capture tabId+leafId now for direct leaf lookup afterward.
    const record = this.handles.get(handle)
    const savedTabId = record?.tabId ?? null
    const savedLeafId = record?.leafId ?? null

    return new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let check: () => void = () => {}
      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        const idx = this.graphSyncCallbacks.indexOf(check)
        if (idx !== -1) {
          this.graphSyncCallbacks.splice(idx, 1)
        }
        signal?.removeEventListener('abort', onAbort)
      }
      const finish = (ptyId: string): void => {
        cleanup()
        resolve(ptyId)
      }
      const fail = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const onAbort = (): void => {
        fail(new Error('request_aborted'))
      }
      if (signal?.aborted) {
        reject(new Error('request_aborted'))
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => {
        fail(new Error('Timed out waiting for PTY to spawn'))
      }, timeoutMs)

      check = (): void => {
        // Try the handle first (works if handle wasn't invalidated yet)
        let ptyId = this.resolveLeafForHandle(handle)?.ptyId
        // Why: ptyId null→real invalidates the old handle; fall back to direct leaf lookup by saved coordinates.
        if (!ptyId && savedTabId && savedLeafId) {
          const directLeaf = this.leaves.get(this.getLeafKey(savedTabId, savedLeafId))
          ptyId = directLeaf?.ptyId ?? null
        }
        if (ptyId) {
          finish(ptyId)
        }
      }
      this.graphSyncCallbacks.push(check)
      check()
    })
  }

  // Why: never-mounted tabs have no PTY or snapshot; synthetic handles need the ptyId to mount the exact owning tab.
  requestRendererTerminalTabMount(handle: string): boolean {
    const record = this.handles.get(handle)
    if (!record?.worktreeId) {
      return false
    }
    const tabId = record.tabId.startsWith('pty:') ? undefined : record.tabId
    const ptyId = record.ptyId ?? undefined
    if (!tabId && !ptyId) {
      return false
    }
    try {
      this.getAuthoritativeWindow().webContents.send('terminal:requestTabMount', {
        worktreeId: record.worktreeId,
        ...(tabId ? { tabId } : {}),
        ...(ptyId ? { ptyId } : {})
      })
      return true
    } catch {
      // No authoritative window (shutdown/headless): subscribe keeps its empty-snapshot fallback.
      return false
    }
  }
  getRendererTerminalSerializerGeneration(ptyId: string): number {
    return this.ptyController?.getRendererSerializerGeneration?.(ptyId) ?? 0
  }
  getRendererTerminalSerializerGenerationForHandle(handle: string): number {
    const ptyId = this.handles.get(handle)?.ptyId
    return ptyId ? this.getRendererTerminalSerializerGeneration(ptyId) : 0
  }
  replaceHeadlessTerminalFromRendererSnapshotForRecovery(
    ptyId: string,
    snapshot: {
      data: string
      cols: number
      rows: number
      cwd?: string | null
      oscLinks?: TerminalOscLinkRange[]
    },
    trailingOutput: { data: string; seq: number }[] = []
  ): void {
    if (!snapshot.data) {
      return
    }
    // Why: a redraw byte can create a suffix-only model before the renderer settles; replace it with the exact snapshot already sent mobile.
    this.providerSnapshotPreferredPtys.add(ptyId)
    this.disposeHeadlessTerminal(ptyId)
    this.seedHeadlessTerminal(
      ptyId,
      snapshot.data,
      { cols: snapshot.cols, rows: snapshot.rows },
      { cwd: snapshot.cwd, oscLinks: snapshot.oscLinks }
    )
    for (const chunk of trailingOutput) {
      this.trackHeadlessTerminalData(ptyId, chunk.data, chunk.seq)
    }
    // The seed's write chain owns subsequent live bytes; suppress on-data hydration from replacing this known-good seed.
    this.headlessHydrationState.set(ptyId, 'done')
  }
  waitForRendererTerminalSerializer(
    ptyId: string,
    afterGeneration: number,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    return (
      this.ptyController?.waitForRendererSerializer?.(ptyId, afterGeneration, timeoutMs, signal) ??
      Promise.resolve(false)
    )
  }

  // Why: a leaf exists before its PTY spawns; a handle issued while ptyId is null gets invalidated on the next sync, so wait for a connected PTY.
  protected countLeavesInTab(tabId: string): number {
    let count = 0
    for (const leaf of this.leaves.values()) {
      if (leaf.tabId === tabId) {
        count++
      }
    }
    return count
  }
  protected resolveHandleForTab(tabId: string): string | null {
    for (const leaf of this.leaves.values()) {
      if (leaf.tabId === tabId && leaf.ptyId !== null) {
        return this.issueHandle(leaf)
      }
    }
    return null
  }
  async focusTerminal(
    handle: string,
    options: { navigateHost?: boolean } = {}
  ): Promise<RuntimeTerminalFocus> {
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      if (!pty.pty.connected) {
        throw new Error('terminal_exited')
      }
      const parsedPaneKey = parsePaneKey(pty.pty.paneKey ?? '')
      const revealed =
        options.navigateHost === false
          ? undefined
          : await this.notifier?.revealTerminalSession?.(pty.pty.worktreeId, {
              ptyId: pty.pty.ptyId,
              title: getLatestPtyTitle(pty.pty),
              ...(pty.pty.launchConfig
                ? { launchConfig: copySleepingAgentLaunchConfig(pty.pty.launchConfig) }
                : {}),
              ...(pty.pty.launchToken ? { launchToken: pty.pty.launchToken } : {}),
              ...(pty.pty.launchAgent ? { launchAgent: pty.pty.launchAgent } : {}),
              ...(pty.pty.tabId !== null ? { tabId: pty.pty.tabId } : {}),
              ...(parsedPaneKey ? { leafId: parsedPaneKey.leafId } : {})
            })
      return {
        handle,
        tabId: revealed?.tabId ?? pty.pty.tabId ?? pty.record.tabId,
        worktreeId: pty.pty.worktreeId
      }
    }
    this.assertGraphReady()
    const { leaf } = this.getLiveLeafForHandle(handle)
    if (options.navigateHost !== false) {
      this.notifier?.focusTerminal(leaf.tabId, leaf.worktreeId, leaf.leafId)
    }
    return { handle, tabId: leaf.tabId, worktreeId: leaf.worktreeId }
  }
  async closeTerminal(handle: string): Promise<RuntimeTerminalClose> {
    const pty = this.getLivePtyForHandle(handle)
    this.claudeAgentTeams.removeTeamForLeaderHandle(handle)
    if (pty) {
      // Why: PTY exit can immediately replace a ready SSH publication with a pending one, so capture its durable HUB surface before killing it.
      const surface =
        (pty.pty.tabId
          ? this.findMobileTerminalSurface(pty.pty.worktreeId, pty.pty.tabId)
          : null) ?? this.findMobileTerminalSurfaceForPty(pty.pty.worktreeId, pty.pty.ptyId)
      const tabId = surface?.tab.parentTabId ?? pty.pty.tabId ?? pty.record.tabId
      // Why: relay recovery can leave stale renderer leaves; the persisted HUB layout defines whether closing this PTY closes the whole surface.
      const siblingCount = surface?.tab.parentLayout
        ? countTerminalLayoutLeaves(surface.tab.parentLayout.root)
        : this.countLeavesInTab(tabId)
      const ptyKilled = this.ptyController?.kill(pty.pty.ptyId) ?? false
      if (!ptyKilled || siblingCount <= 1) {
        if (surface) {
          // Why: paired viewers keep ended streams mounted until the HUB publishes removal, so explicit close uses the durable host-tab transaction instead of viewer-local exit handling.
          try {
            await this.closeMobileSessionTab(`id:${pty.pty.worktreeId}`, tabId)
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'workspace_session_unavailable') {
              throw error
            }
            this.notifier?.closeTerminal(tabId)
          }
        } else {
          this.notifier?.closeTerminal(tabId)
        }
      }
      return { handle, tabId, ptyKilled }
    }
    this.assertGraphReady()
    const { leaf } = this.getLiveLeafForHandle(handle)
    let ptyKilled = false
    if (leaf.ptyId) {
      ptyKilled = this.ptyController?.kill(leaf.ptyId) ?? false
    }
    // Why: in a multi-pane tab, killing the PTY is enough (renderer's exit handler closes the pane); an extra IPC close would race it and close the whole tab.
    const siblingCount = this.countLeavesInTab(leaf.tabId)
    if (!ptyKilled || siblingCount <= 1) {
      this.notifier?.closeTerminal(leaf.tabId, leaf.paneRuntimeId)
    }
    return { handle, tabId: leaf.tabId, ptyKilled }
  }
  async closeTerminalTab(handle: string): Promise<RuntimeTerminalClose> {
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      const tabId = pty.pty.tabId
      if (!tabId) {
        return this.closeTerminal(handle)
      }
      // Why: a handle-addressed CLI/automation close is an explicit intent, so
      // it must stay destructive under the non-user close adjudication gate.
      await this.closeMobileSessionTab(`id:${pty.pty.worktreeId}`, tabId, { reason: 'user' })
      this.claudeAgentTeams.removeTeamForLeaderHandle(handle)
      return { handle, tabId, closeMode: 'tab', ptyKilled: false }
    }
    this.assertGraphReady()
    const { leaf } = this.getLiveLeafForHandle(handle)
    await this.closeMobileSessionTab(`id:${leaf.worktreeId}`, leaf.tabId, { reason: 'user' })
    this.claudeAgentTeams.removeTeamForLeaderHandle(handle)
    return { handle, tabId: leaf.tabId, closeMode: 'tab', ptyKilled: false }
  }
  async splitTerminal(
    handle: string,
    opts: {
      direction?: 'horizontal' | 'vertical'
      command?: string
      env?: Record<string, string>
      envToDelete?: string[]
      activate?: boolean
      // Why: same split as createTerminal — adopt the pane without revealing its
      // workspace, for splits the user never asked to see.
      surfaceOwner?: false
      telemetrySource?: TerminalPaneSplitSource
    } = {}
  ): Promise<RuntimeTerminalSplit> {
    const livePty = this.getLivePtyForHandle(handle)
    if (livePty) {
      return await this.splitPtyBackedTerminal(livePty.pty, opts)
    }
    this.assertGraphReady()
    const { leaf } = this.getLiveLeafForHandle(handle)
    const direction = opts.direction ?? 'horizontal'

    // Snapshot current leaf keys so the post-split graph-sync delta reveals the new pane.
    const leafKeysBefore = new Set<string>()
    for (const [key, l] of this.leaves) {
      if (l.tabId === leaf.tabId) {
        leafKeysBefore.add(key)
      }
    }

    this.notifier?.splitTerminal(leaf.tabId, leaf.paneRuntimeId, {
      direction,
      command: opts.command,
      telemetrySource: opts.telemetrySource
    })

    const newHandle = await this.waitForNewLeafInTab(leaf.tabId, leafKeysBefore)
    return { handle: newHandle, tabId: leaf.tabId, paneRuntimeId: leaf.paneRuntimeId }
  }
}
