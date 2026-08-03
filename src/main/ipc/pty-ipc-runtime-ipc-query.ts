import { ipcMain } from 'electron'
import type { PtyListedSession } from '../../shared/pty-listed-session'
import { parseAppSshPtyId } from '../providers/ssh-pty-id'
import { inspectPtyProviderProcessForRenderer } from '../providers/pty-process-inspection'
import { collectPtyProcessListingsBySource } from '../providers/pty-process-list-admission'
import { routesFreshSpawnsToLocalProvider } from './pty-ipc-runtime-spawn-routing'
import {
  capturePtyLifecycleTarget,
  getProviderGeneration,
  isCurrentPtyListing,
  isCurrentProvider,
  tryGetProviderForPty
} from './pty-ipc-runtime-provider-routing'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

export function installPtyIpcQueryHandlers(): void {
  const state = getPtyRegistrationSharedState() as Record<string, any>

  ipcMain.handle('pty:listSessions', async (): Promise<PtyListedSession[]> => {
    const providers = [
      {
        provider: ptyRuntimeState.localProvider,
        connectionId: null as string | null,
        generation: getProviderGeneration(ptyRuntimeState.localProvider)
      },
      ...Array.from(
        ptyRuntimeState.sshProviders,
        ([connectionId, provider]: [string, any]) => ({
          provider,
          connectionId,
          generation: getProviderGeneration(provider)
        })
      )
    ]
    const lifecycleTargets = new Map(
      [
        ...ptyRuntimeState.ptyOwnership.keys(),
        ...ptyRuntimeState.ptyIncarnationById.keys(),
        ...ptyRuntimeState.pendingPtyIncarnationById.keys(),
        ...ptyRuntimeState.ptyStateTokenById.keys(),
        ...ptyRuntimeState.clearedPtyLifecycleIds
      ].map((id) => [id, capturePtyLifecycleTarget(id)] as const)
    )
    const emptyLifecycleTarget = capturePtyLifecycleTarget('')
    const listings = await collectPtyProcessListingsBySource(
      providers,
      ({ provider }) => provider.listProcesses()
    )
    if (
      listings.some(
        ({ source: { provider, connectionId, generation } }) =>
          !isCurrentProvider(provider, connectionId, generation)
      )
    ) {
      throw new Error('pty_process_list_incomplete')
    }

    // Stage all provider-derived mutations so failures cannot publish partial ownership.
    const staged = new Map<
      string,
      { connectionId: string | null; session: PtyListedSession }
    >()
    for (const { source, processes } of listings) {
      for (const process of processes) {
        const lifecycleTarget = lifecycleTargets.get(process.id) ?? emptyLifecycleTarget
        if (!isCurrentPtyListing(process.id, process.incarnationId, lifecycleTarget)) {
          throw new Error('pty_process_list_incomplete')
        }
        staged.set(process.id, {
          connectionId: source.connectionId,
          session: {
            id: process.id,
            cwd: process.cwd,
            title: process.title,
            agentOwnership:
              (process.agentSessionOwners?.length ?? 0) > 0
                ? 'present'
                : source.provider.providesAgentSessionOwnerListings?.(process.id) === true
                  ? 'absent'
                  : 'unknown'
          }
        })
      }
    }

    const deduped = new Map<string, PtyListedSession>()
    for (const [id, { connectionId, session }] of staged) {
      state.ptyOwnership.set(id, connectionId)
      deduped.set(id, session)
    }
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
