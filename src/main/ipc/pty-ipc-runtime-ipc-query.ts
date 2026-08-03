import { ipcMain } from 'electron'
import type { PtyListedSession } from '../../shared/pty-listed-session'
import { parseAppSshPtyId } from '../providers/ssh-pty-id'
import { inspectPtyProviderProcessForRenderer } from '../providers/pty-process-inspection'
import { PtyProcessListAdmission, visitPtyProcessListingsInBatches } from '../providers/pty-process-list-admission'
import { routesFreshSpawnsToLocalProvider } from './pty-ipc-runtime-spawn-routing'
import { tryGetProviderForPty } from './pty-ipc-runtime-provider-routing'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

export function installPtyIpcQueryHandlers(): void {
  const state = getPtyRegistrationSharedState() as Record<string, any>

  ipcMain.handle('pty:listSessions', async (): Promise<PtyListedSession[]> => {
    const deduped = new Map<string, PtyListedSession>()
    const admission = new PtyProcessListAdmission()
    const providers = [
      { provider: ptyRuntimeState.localProvider, connectionId: null as string | null },
      ...Array.from(ptyRuntimeState.sshProviders, ([connectionId, provider]: [string, any]) => ({ provider, connectionId }))
    ]
    await visitPtyProcessListingsInBatches(
      providers,
      ({ provider, connectionId }) =>
        connectionId === null ? provider.listProcesses() : provider.listProcesses().catch(() => []),
      ({ provider, connectionId }, sessions) => {
        const isCurrentProvider =
          connectionId === null
            ? ptyRuntimeState.localProvider === provider
            : state.sshProviders.get(connectionId) === provider
        if (!isCurrentProvider) {
          return
        }
        for (const rawSession of sessions) {
          const session = admission.admit(rawSession)
          state.ptyOwnership.set(session.id, connectionId)
          deduped.set(session.id, {
            id: session.id,
            cwd: session.cwd,
            title: session.title,
            agentOwnership:
              (session.agentSessionOwners?.length ?? 0) > 0
                ? 'present'
                : provider.providesAgentSessionOwnerListings?.(session.id) === true
                  ? 'absent'
                  : 'unknown'
          })
        }
      }
    )
    return Array.from(deduped.values())
  })

  ipcMain.on(
    'pty:getAuthoritativeBufferSnapshotCapabilitiesSync',
    (event, args: { ids?: unknown }) => {
      const ids = Array.isArray(args?.ids) ? args.ids.slice(0, 512) : []
      const capabilities: { id: string; authoritative: boolean | null }[] = []
      const seen = new Set<string>()
      for (const value of ids) {
        if (typeof value !== 'string' || value.length === 0 || value.length > 512 || seen.has(value)) {
          continue
        }
        seen.add(value)
        const provider = tryGetProviderForPty(value)
        capabilities.push({
          id: value,
          authoritative: provider?.canProvideAuthoritativeBufferSnapshot
            ? provider.canProvideAuthoritativeBufferSnapshot(value)
            : provider && routesFreshSpawnsToLocalProvider(provider)
              ? false
              : null
        })
      }
      event.returnValue = capabilities
    }
  )

  ipcMain.handle('pty:hasPty', async (_event, args: { id: string }): Promise<boolean | null> => {
    const ownedConnectionId = state.ptyOwnership.get(args.id)
    const parsedSshId = ownedConnectionId === undefined ? parseAppSshPtyId(args.id) : null
    const provider = parsedSshId
      ? ptyRuntimeState.sshProviders.get(parsedSshId.connectionId)
      : tryGetProviderForPty(args.id)
    if (!provider?.hasPty) {
      return null
    }
    try {
      return provider.hasPty(args.id)
    } catch {
      return null
    }
  })

  ipcMain.handle('pty:hasChildProcesses', async (_event, args: { id: string }): Promise<boolean> => {
    if (!state.hasPtyProviderForInspection(args.id)) {
      return false
    }
    return state.getProviderForPty(args.id).hasChildProcesses(args.id)
  })

  ipcMain.handle('pty:getForegroundProcess', async (_event, args: { id: string }): Promise<string | null> => {
    if (!state.hasPtyProviderForInspection(args.id)) {
      return null
    }
    return state.getProviderForPty(args.id).getForegroundProcess(args.id)
  })

  ipcMain.handle('pty:inspectProcess', async (_event, args: { id: string }) => {
    if (!state.hasPtyProviderForInspection(args.id)) {
      return { foregroundProcess: null, hasChildProcesses: false, unavailable: true as const }
    }
    return inspectPtyProviderProcessForRenderer(state.getProviderForPty(args.id), args.id)
  })

  ipcMain.handle('pty:confirmForegroundProcess', async (_event, args: { id: string }): Promise<string | null> => {
    if (!state.hasPtyProviderForInspection(args.id)) {
      return null
    }
    const provider = state.getProviderForPty(args.id)
    return provider.confirmForegroundProcess?.(args.id) ?? null
  })

  ipcMain.handle('pty:getCwd', async (_event, args: { id: string }): Promise<string> => {
    try {
      return await state.getProviderForPty(args.id).getCwd(args.id)
    } catch {
      return ''
    }
  })

  ipcMain.handle('pty:getSize', async (_event, args: { id: string }): Promise<{ cols: number; rows: number } | null> => {
    const provider = tryGetProviderForPty(args.id)
    try {
      if (provider?.getAppliedSize) {
        return await provider.getAppliedSize(args.id)
      }
    } catch {
      // Fall through to the requested-size cache when provider liveness is unavailable.
    }
    return state.ptySizes.get(args.id) ?? null
  })

  ipcMain.handle('pty:declarePendingPaneSerializer', async (event, args: { paneKey?: unknown }): Promise<number> => {
    if (!state.isValidPaneKey(args.paneKey)) {
      throw new Error('Invalid paneKey')
    }
    return state.declarePendingPaneSerializer(args.paneKey, event?.sender)
  })

  ipcMain.handle('pty:settlePaneSerializer', async (_event, args: { paneKey?: unknown; gen?: unknown }): Promise<void> => {
    if (!state.isValidPaneKey(args.paneKey) || typeof args.gen !== 'number') {
      return
    }
    const ptyId = state.pendingPtyIdBySerializerGeneration.get(args.gen)
    const settledCurrentGeneration = state.settlePendingPaneSerializer(args.paneKey, args.gen)
    state.pendingPtyIdBySerializerGeneration.delete(args.gen)
    if (settledCurrentGeneration && ptyId) {
      state.rendererSerializerReadiness.markReady(ptyId)
    }
  })

  ipcMain.handle('pty:clearPendingPaneSerializer', async (_event, args: { paneKey?: unknown; gen?: unknown }): Promise<void> => {
    if (!state.isValidPaneKey(args.paneKey) || typeof args.gen !== 'number') {
      return
    }
    state.settlePendingPaneSerializer(args.paneKey, args.gen)
    state.pendingPtyIdBySerializerGeneration.delete(args.gen)
  })

  ipcMain.handle('pty:reportRendererSerializerReady', async (_event, args: { ptyId?: unknown }): Promise<void> => {
    if (typeof args?.ptyId !== 'string' || !args.ptyId.startsWith('remote:') || args.ptyId.length > 512) {
      return
    }
    state.rendererSerializerReadiness.markReady(args.ptyId)
  })
}
