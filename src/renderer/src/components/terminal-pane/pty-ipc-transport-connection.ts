import { isRuntimeOwnedSshTargetId } from '../../../../shared/execution-host'
import { ensurePtyDispatcher, getEagerPtyBufferHandle } from './pty-dispatcher'
import {
  clearConsumedPreHandlerPtyExit,
  hasPreHandlerPtyExit,
  isPreHandlerPtyStateDiscarded
} from './pty-pre-handler-buffer'
import type { PtyIpcTransportContext } from './pty-ipc-transport-context'
import type { PtyIpcTransportHandlers } from './pty-ipc-transport-handlers'
import type { PtyConnectResult, PtyTransport } from './pty-transport-types'
import {
  hasTerminalDisplayContent,
  trimIncompleteTerminalControlTail
} from './terminal-output-visibility'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { getClientRuntime } from '../../runtime/client-runtime'

const SSH_SESSION_EXPIRED_ERROR = 'SSH_SESSION_EXPIRED'
const SSH_PTY_CONNECTION_MISMATCH_MARKER = 'belongs to SSH connection'
type PtyConnectOptions = Parameters<PtyTransport['connect']>[0]
type PtyAttachOptions = Parameters<PtyTransport['attach']>[0]

export function createPtyIpcTransportConnection(
  context: PtyIpcTransportContext,
  handlers: PtyIpcTransportHandlers
): Pick<PtyTransport, 'connect' | 'attach'> {
  const { state, options, outputProcessor } = context
  const { registerPtyDataHandler, registerPtyExitHandler } = handlers

  async function connect(
    connectOptions: PtyConnectOptions
  ): Promise<void | string | PtyConnectResult> {
    state.callbacks = connectOptions.callbacks
    ensurePtyDispatcher()
    if (state.destroyed) return

    if (connectOptions.sessionId && hasPreHandlerPtyExit(connectOptions.sessionId)) {
      if (connectOptions.admitPtyId && !connectOptions.admitPtyId(connectOptions.sessionId)) {
        return { id: connectOptions.sessionId } satisfies PtyConnectResult
      }
      state.ptyId = connectOptions.sessionId
      state.connected = true
      registerPtyDataHandler(connectOptions.sessionId)
      registerPtyExitHandler(connectOptions.sessionId)
      return { id: connectOptions.sessionId, exitedBeforeAttach: true } satisfies PtyConnectResult
    }

    const admittedSessionId =
      connectOptions.sessionId && !isPreHandlerPtyStateDiscarded(connectOptions.sessionId)
        ? connectOptions.sessionId
        : undefined
    if (admittedSessionId) clearConsumedPreHandlerPtyExit(admittedSessionId)

    try {
      const shouldSendLocalCwdFallback =
        options.cwdFallback === 'worktree' && !options.connectionId && !admittedSessionId
      const result = await getClientRuntime().terminal.spawn({
        cols: connectOptions.cols ?? 80,
        rows: connectOptions.rows ?? 24,
        cwd: options.cwd,
        ...(shouldSendLocalCwdFallback ? { cwdFallback: options.cwdFallback } : {}),
        env: connectOptions.env ?? options.env,
        ...((connectOptions.envToDelete ?? options.envToDelete)
          ? { envToDelete: connectOptions.envToDelete ?? options.envToDelete }
          : {}),
        command: connectOptions.command ?? options.command,
        ...((connectOptions.launchConfig ?? options.launchConfig)
          ? { launchConfig: connectOptions.launchConfig ?? options.launchConfig }
          : {}),
        ...((connectOptions.resumeProviderSession ?? options.resumeProviderSession)
          ? {
              resumeProviderSession:
                connectOptions.resumeProviderSession ?? options.resumeProviderSession
            }
          : {}),
        ...((connectOptions.launchToken ?? options.launchToken)
          ? { launchToken: connectOptions.launchToken ?? options.launchToken }
          : {}),
        ...((connectOptions.launchAgent ?? options.launchAgent)
          ? { launchAgent: connectOptions.launchAgent ?? options.launchAgent }
          : {}),
        ...((connectOptions.startupCommandDelivery ?? options.startupCommandDelivery)
          ? {
              startupCommandDelivery:
                connectOptions.startupCommandDelivery ?? options.startupCommandDelivery
            }
          : {}),
        ...(options.connectionId ? { connectionId: options.connectionId } : {}),
        ...(admittedSessionId ? { sessionId: admittedSessionId } : {}),
        ...(connectOptions.initiallyHidden ? { initiallyHidden: true } : {}),
        worktreeId: options.worktreeId,
        ...(options.tabId ? { tabId: options.tabId } : {}),
        ...(options.leafId ? { leafId: options.leafId } : {}),
        ...(options.shellOverride ? { shellOverride: options.shellOverride } : {}),
        ...(options.projectRuntime ? { projectRuntime: options.projectRuntime } : {}),
        ...(options.terminalColorQueryReplies
          ? { terminalColorQueryReplies: options.terminalColorQueryReplies }
          : {}),
        ...(options.telemetry ? { telemetry: options.telemetry } : {})
      })
      const spawnResult = result as PtyConnectResult & { isReattach?: boolean }
      const resultLaunchAgent = isTuiAgent(spawnResult.launchAgent)
        ? spawnResult.launchAgent
        : undefined
      const retireFreshSpawn = async (): Promise<void> => {
        if (!spawnResult.isReattach && !spawnResult.coldRestore) {
          await getClientRuntime().terminal.kill(spawnResult.id)
        }
      }
      if (state.destroyed) {
        await retireFreshSpawn()
        return
      }
      if (connectOptions.admitPtyId && !connectOptions.admitPtyId(spawnResult.id)) {
        await retireFreshSpawn()
        return spawnResult
      }

      state.ptyId = spawnResult.id
      state.connected = true
      if (!spawnResult.isReattach && !spawnResult.coldRestore) {
        options.onPtySpawn?.(spawnResult.id)
      }
      registerPtyDataHandler(spawnResult.id)
      const exitedBeforeAttach = registerPtyExitHandler(spawnResult.id)
      if (exitedBeforeAttach) {
        return { id: spawnResult.id, exitedBeforeAttach: true } satisfies PtyConnectResult
      }
      if (!state.connected || state.ptyId !== spawnResult.id) return undefined
      state.callbacks.onConnect?.()
      state.callbacks.onStatus?.('shell')
      if (spawnResult.isReattach || spawnResult.coldRestore || spawnResult.sessionExpired) {
        return {
          id: spawnResult.id,
          ...(spawnResult.isReattach ? { isReattach: true } : {}),
          ...(resultLaunchAgent ? { launchAgent: resultLaunchAgent } : {}),
          ...(spawnResult.launchConfig ? { launchConfig: spawnResult.launchConfig } : {}),
          snapshot: spawnResult.snapshot,
          snapshotCols: spawnResult.snapshotCols,
          snapshotRows: spawnResult.snapshotRows,
          isAlternateScreen: spawnResult.isAlternateScreen,
          sessionExpired: spawnResult.sessionExpired,
          coldRestore: spawnResult.coldRestore,
          replay: spawnResult.replay,
          pendingEscapeTailAnsi: spawnResult.pendingEscapeTailAnsi,
          ...(spawnResult.agentResumeUnavailable ? { agentResumeUnavailable: true as const } : {})
        } satisfies PtyConnectResult
      }
      if (
        resultLaunchAgent ||
        spawnResult.launchConfig ||
        spawnResult.startupCwdFallback ||
        spawnResult.agentResumeUnavailable
      ) {
        return {
          id: spawnResult.id,
          ...(resultLaunchAgent ? { launchAgent: resultLaunchAgent } : {}),
          ...(spawnResult.launchConfig ? { launchConfig: spawnResult.launchConfig } : {}),
          ...(spawnResult.startupCwdFallback
            ? { startupCwdFallback: spawnResult.startupCwdFallback }
            : {}),
          ...(spawnResult.agentResumeUnavailable ? { agentResumeUnavailable: true as const } : {})
        } satisfies PtyConnectResult
      }
      return spawnResult.id
    } catch (error) {
      const message = extractIpcErrorMessage(
        error,
        error instanceof Error ? error.message : String(error)
      )
      if (
        options.connectionId &&
        connectOptions.sessionId &&
        (message.includes(SSH_SESSION_EXPIRED_ERROR) ||
          message.includes(SSH_PTY_CONNECTION_MISMATCH_MARKER))
      ) {
        return { id: connectOptions.sessionId, sessionExpired: true } satisfies PtyConnectResult
      }
      if (message.includes('was explicitly killed')) return undefined
      if (options.connectionId && message.includes('No PTY provider for connection')) {
        if (!isRuntimeOwnedSshTargetId(options.connectionId)) {
          state.callbacks.onError?.(
            'SSH connection is not active. Use the reconnect dialog or Settings to connect.'
          )
        }
      } else {
        state.callbacks.onError?.(message)
      }
      return undefined
    }
  }

  function attach(attachOptions: PtyAttachOptions): void {
    state.callbacks = attachOptions.callbacks
    ensurePtyDispatcher()
    if (state.destroyed) return
    const id = attachOptions.existingPtyId
    state.ptyId = id
    state.connected = true
    registerPtyDataHandler(id)
    registerPtyExitHandler(id)
    if (!state.connected || state.ptyId !== id) return
    const bufferHandle = getEagerPtyBufferHandle(id)
    if (bufferHandle) {
      const buffered = bufferHandle.flush()
      if (buffered) {
        const replayData = trimIncompleteTerminalControlTail(buffered)
        const shouldClearBeforeReplay =
          !attachOptions.isAlternateScreen && hasTerminalDisplayContent(replayData)
        if (shouldClearBeforeReplay && !state.callbacks.onReplayData) {
          state.callbacks.onData?.('\x1b[2J\x1b[3J\x1b[H')
        }
        state.suppressAttentionEvents = true
        try {
          outputProcessor.processData(replayData, state.callbacks, {
            replayingBufferedData: true,
            suppressAttentionEvents: true,
            clearBeforeReplay: shouldClearBeforeReplay
          })
        } finally {
          outputProcessor.flushPendingSideEffects()
          state.suppressAttentionEvents = false
          outputProcessor.clearStaleTitleTimer()
          outputProcessor.resetBellDetector()
        }
      }
      bufferHandle.dispose()
    }
    if (attachOptions.cols && attachOptions.rows) {
      getClientRuntime().terminal.resize(id, attachOptions.cols, attachOptions.rows)
    }
    state.callbacks.onConnect?.()
    state.callbacks.onStatus?.('shell')
  }

  return { connect, attach }
}
