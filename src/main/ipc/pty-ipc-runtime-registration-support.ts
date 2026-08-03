import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { ipcMain } from 'electron'
import type { TuiAgent } from '../../shared/types'
import type { Store } from '../persistence'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
import type { CodexSessionResumePreparation } from '../codex/codex-session-resume-home'
import type { TerminalStartupCwdMissingDirFallback } from '../../shared/terminal-startup-cwd'
import { isWslUncPath } from '../../shared/wsl-paths'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { resolveTerminalStartupCwdForWorkspace } from '../../shared/terminal-startup-cwd'
import { assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus } from '../project-groups/folder-workspace-path-status'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { dropAgentResumeArgvFromCommand } from '../../shared/agent-resume-argv-drop'
import { dropUnverifiedCodexResumeArgv } from '../codex/codex-unverified-resume-launch'
import { normalizeAgentProviderSession } from '../../shared/agent-session-resume'
import { SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV } from '../../shared/setup-agent-sequencing'
import { LocalPtyProvider } from '../providers/local-pty-provider'
import { clearDidFinishLoadHandler, clearRendererGateResetHandlers } from './pty-ipc-runtime-renderer-lifecycle-state'
import { getHiddenRendererPtyDeliveryDebug, resetRendererScopedHiddenPtyDeliveryState } from './pty-hidden-delivery-gate'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import type { PtyRendererDeliveryContext, SerializeResult } from './pty-ipc-runtime-renderer-delivery-context'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import type { PrepareCodexSessionResume } from './pty-ipc-runtime-host-env-foundation'

type RegistrationSupportOptions = {
  prepareCodexSessionResume?: PrepareCodexSessionResume
  isRecoveryReloadInFlight?: (webContentsId: number) => boolean
}

type CodexResumeLaunch = {
  codexResumeHome: { codexHomePath: string } | null
  command: string | undefined
  notifyResumeUnavailable: boolean
  droppedResumeArgv: boolean
  providerSession: AgentProviderSessionMetadata | null
}

export function installPtyRegistrationSupport(): void {
  const state = getPtyRegistrationSharedState() as PtyRendererDeliveryContext & {
    store?: Store
    options?: RegistrationSupportOptions
  }
  const { mainWindow, store, options } = state
  const pendingSerializeRequests = new Map<string, { resolve: (result: SerializeResult) => void; timeout: NodeJS.Timeout }>()

  const settleSerializeRequest = (requestId: string, result: SerializeResult): void => {
    const pending = pendingSerializeRequests.get(requestId)
    if (!pending) return
    clearTimeout(pending.timeout)
    pendingSerializeRequests.delete(requestId)
    pending.resolve(result)
  }

  ipcMain.on('pty:serializeBuffer:response', (_event, args: {
    requestId?: string
    snapshot?: { data?: unknown; cols?: unknown; rows?: unknown; seq?: unknown; lastTitle?: unknown } | null
  }) => {
    if (typeof args?.requestId !== 'string') return
    const snapshot = args.snapshot
    if (!snapshot || typeof snapshot.data !== 'string' || typeof snapshot.cols !== 'number' || typeof snapshot.rows !== 'number') {
      settleSerializeRequest(args.requestId, null)
      return
    }
    const result: Exclude<SerializeResult, null> = { data: snapshot.data, cols: snapshot.cols, rows: snapshot.rows }
    if (typeof snapshot.seq === 'number' && Number.isFinite(snapshot.seq)) result.seq = snapshot.seq
    if (typeof snapshot.lastTitle === 'string' && snapshot.lastTitle.length > 0) result.lastTitle = snapshot.lastTitle
    settleSerializeRequest(args.requestId, result)
  })

  const requestSerializedBuffer = (ptyId: string, opts?: { scrollbackRows?: number; altScreenForcesZeroRows?: boolean }): Promise<SerializeResult> => {
    if (mainWindow.isDestroyed()) return Promise.resolve(null)
    const requestId = randomUUID()
    return new Promise<SerializeResult>((resolve) => {
      const timeout = setTimeout(() => settleSerializeRequest(requestId, null), 750)
      pendingSerializeRequests.set(requestId, { resolve, timeout })
      mainWindow.webContents.send('pty:serializeBuffer:request', opts ? { requestId, ptyId, opts } : { requestId, ptyId })
    })
  }

  clearRendererGateResetHandlers()
  const resetRendererPtyDeliveryGateState = (): void => {
    const gateDebug = getHiddenRendererPtyDeliveryDebug()
    resetRendererScopedHiddenPtyDeliveryState()
    if (gateDebug.hiddenDeliveryGatedPtyCount > 0 || gateDebug.deliveryInterestPtyCount > 0) {
      state.invalidatePendingPtyDrainPolicy()
    }
    state.resyncBackgroundedDeliveriesAfterGateReset()
  }
  ptyRuntimeState.rendererGateResetLoadHandler = resetRendererPtyDeliveryGateState
  ptyRuntimeState.rendererGateResetGoneHandler = resetRendererPtyDeliveryGateState
  ptyRuntimeState.rendererGateResetWebContents = mainWindow.webContents
  mainWindow.webContents.on('did-finish-load', resetRendererPtyDeliveryGateState)
  mainWindow.webContents.on('render-process-gone', resetRendererPtyDeliveryGateState)

  clearDidFinishLoadHandler()
  const localProvider = ptyRuntimeState.localProvider
  if (localProvider instanceof LocalPtyProvider) {
    const lp = localProvider
    ptyRuntimeState.didFinishLoadHandler = () => {
      const generation = lp.advanceGeneration()
      if (options?.isRecoveryReloadInFlight?.(mainWindow.webContents.id)) return
      lp.killOrphanedPtys(generation - 1)
    }
    ptyRuntimeState.didFinishLoadWebContents = mainWindow.webContents
    mainWindow.webContents.on('did-finish-load', ptyRuntimeState.didFinishLoadHandler)
  }

  const assertFolderWorkspacePtyPathUsable = async (worktreeId: string | undefined): Promise<void> => {
    const workspaceScope = typeof worktreeId === 'string' ? parseWorkspaceKey(worktreeId) : null
    if (!store || workspaceScope?.type !== 'folder') return
    const status = await getFolderWorkspacePathStatus(store, { scope: 'folder-workspace', folderWorkspaceId: workspaceScope.folderWorkspaceId }, { getSshFilesystemProvider })
    assertFolderWorkspacePathUsable(status)
  }

  const resolvePtySpawnStartupCwd = (worktreeId: string | undefined, cwd: string | undefined, missingDirFallback?: TerminalStartupCwdMissingDirFallback): string | undefined =>
    resolveTerminalStartupCwdForWorkspace({
      workspaceId: worktreeId,
      requestedCwd: cwd,
      missingDirFallback,
      resolveFolderWorkspacePath: (folderWorkspaceId) => store?.getFolderWorkspace(folderWorkspaceId)?.folderPath
    })

  const localStartupCwdDirectoryExists = (path: string): boolean => {
    if (isWslUncPath(path)) return true
    try { return statSync(path).isDirectory() } catch { return false }
  }

  const prepareCodexResumeHome = (args: {
    connectionId?: string | null
    launchAgent?: TuiAgent
    providerSession?: AgentProviderSessionMetadata
    target: CodexAccountSelectionTarget
    launchEnv?: NodeJS.ProcessEnv
    workspacePath?: string
  }): { providerSession: AgentProviderSessionMetadata; preparation: Promise<CodexSessionResumePreparation | null> } | null => {
    if (args.connectionId || args.launchAgent !== 'codex' || !options?.prepareCodexSessionResume) return null
    const providerSession = normalizeAgentProviderSession(args.providerSession)
    if (!providerSession) return null
    return { providerSession, preparation: options.prepareCodexSessionResume({ providerSession, target: args.target, launchEnv: args.launchEnv, workspacePath: args.workspacePath }) }
  }

  const noCodexResumeLaunch = (command: string | undefined): CodexResumeLaunch => ({ codexResumeHome: null, command, notifyResumeUnavailable: false, droppedResumeArgv: false, providerSession: null })
  const resolveCodexResumeLaunch = (command: string | undefined, preparation: NonNullable<ReturnType<typeof prepareCodexResumeHome>>): Promise<CodexResumeLaunch> =>
    preparation.preparation.then((prepared) => {
      const providerSession = preparation.providerSession
      if (prepared?.outcome !== 'fresh') return { codexResumeHome: prepared ?? null, command, notifyResumeUnavailable: false, droppedResumeArgv: false, providerSession }
      const dropped = dropUnverifiedCodexResumeArgv({ command, providerSession, claimedCodexProvenance: prepared.claimedCodexProvenance })
      return { codexResumeHome: null, command: dropped.command, notifyResumeUnavailable: dropped.droppedResumeArgv && (prepared.claimedCodexProvenance || !providerSession.transcriptPath), droppedResumeArgv: dropped.droppedResumeArgv, providerSession }
    })
  const stripSequencedStartupResumeArgv = <T extends Record<string, string> | undefined>(env: T, launch: CodexResumeLaunch): T => {
    const sequenced = env?.[SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]
    if (!env || !sequenced || !launch.droppedResumeArgv || !launch.providerSession) return env
    const drop = dropAgentResumeArgvFromCommand({ command: sequenced, agent: 'codex', providerSession: launch.providerSession })
    return drop.status === 'dropped' ? { ...env, [SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]: drop.command } : env
  }

  Object.assign(state, {
    pendingSerializeRequests,
    settleSerializeRequest,
    requestSerializedBuffer,
    resetRendererPtyDeliveryGateState,
    assertFolderWorkspacePtyPathUsable,
    resolvePtySpawnStartupCwd,
    localStartupCwdDirectoryExists,
    prepareCodexResumeHome,
    noCodexResumeLaunch,
    resolveCodexResumeLaunch,
    stripSequencedStartupResumeArgv
  })
}
