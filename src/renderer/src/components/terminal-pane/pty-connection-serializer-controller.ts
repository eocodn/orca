import type { IDisposable } from '@xterm/xterm'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { getClientRuntime } from '../../runtime/client-runtime'
import { clearTerminalScrollbackAndFollowOutput } from '@/lib/pane-manager/terminal-scrollback-clear'
import {
  discardTerminalOutput,
  waitForTerminalOutputParsed
} from '@/lib/pane-manager/pane-terminal-output-scheduler'
import { isTerminalWritePipelineCertifiedDead } from '@/lib/pane-manager/terminal-write-pipeline-health'
import {
  hasPtySerializer,
  registerPtySerializer,
  registerPtyTitleSource
} from './pty-buffer-serializer'
import { serializeWithAbsoluteCursor } from '../../../../shared/terminal-serialize-absolute-cursor'
import type { PtyTransport } from './pty-transport'
import { isRemoteRuntimePtyId } from './pty-connection-routing-policy'

type SerializerControllerArgs = {
  pane: ManagedPane
  cacheKey: string
  transport: PtyTransport
  onDataDisposable: IDisposable
  isDisposed: () => boolean
  clearHiddenOutputRestoreState: () => void
  getRendererOrderedFrame: (ptyId: string) => { ptyId: string | null; seq: number | null }
  whenReplayIdle: () => Promise<void>
}

export function createPtyConnectionSerializerController({
  pane,
  cacheKey,
  transport,
  onDataDisposable,
  isDisposed,
  clearHiddenOutputRestoreState,
  getRendererOrderedFrame,
  whenReplayIdle
}: SerializerControllerArgs) {
  const registerPaneSerializerFor = (ptyId: string): void => {
    if (isDisposed()) {
      return
    }
    const unregisterSerializer = registerPtySerializer(
      ptyId,
      async (opts) => {
        try {
          if (isTerminalWritePipelineCertifiedDead(pane.terminal)) {
            return null
          }
          await waitForTerminalOutputParsed(pane.terminal)
          if (isTerminalWritePipelineCertifiedDead(pane.terminal)) {
            return null
          }
          const alt = pane.terminal.buffer.active.type === 'alternate'
          const data =
            opts?.altScreenForcesZeroRows && alt
              ? serializeWithAbsoluteCursor(pane.serializeAddon, pane.terminal, { scrollback: 0 })
              : serializeWithAbsoluteCursor(pane.serializeAddon, pane.terminal, {
                  scrollback: opts?.scrollbackRows
                })
          const orderedFrame = getRendererOrderedFrame(ptyId)
          return {
            data,
            cols: pane.terminal.cols,
            rows: pane.terminal.rows,
            ...(orderedFrame.ptyId === ptyId && orderedFrame.seq !== null
              ? { seq: orderedFrame.seq }
              : {})
          }
        } catch {
          return null
        }
      },
      () => {
        clearHiddenOutputRestoreState()
        discardTerminalOutput(pane.terminal)
        clearTerminalScrollbackAndFollowOutput(pane.terminal)
      }
    )
    const unregisterTitleSource = registerPtyTitleSource(ptyId, (handler) =>
      pane.terminal.onTitleChange(handler)
    )
    const originalDispose = onDataDisposable.dispose.bind(onDataDisposable)
    onDataDisposable.dispose = () => {
      unregisterTitleSource()
      unregisterSerializer()
      originalDispose()
    }
  }

  const settlePaneSerializerAfterReplay = async (
    ptyId: string,
    generation: number
  ): Promise<void> => {
    try {
      await whenReplayIdle()
      if (isDisposed() || transport.getPtyId() !== ptyId) {
        await getClientRuntime()
          .terminal.clearPendingPaneSerializer(cacheKey, generation)
          .catch(() => {})
        return
      }
      await waitForTerminalOutputParsed(pane.terminal)
      if (!isDisposed() && transport.getPtyId() === ptyId) {
        await getClientRuntime().terminal.settlePaneSerializer(cacheKey, generation)
        return
      }
    } catch {
      // Clear below so a failed parser/replay cannot leave the pane generation pending.
    }
    await getClientRuntime()
      .terminal.clearPendingPaneSerializer(cacheKey, generation)
      .catch(() => {})
  }

  const reportRemoteRendererSerializerReady = (): void => {
    const ptyId = transport.getPtyId()
    if (!ptyId || !isRemoteRuntimePtyId(ptyId)) {
      return
    }
    if (!hasPtySerializer(ptyId)) {
      registerPaneSerializerFor(ptyId)
    }
    void whenReplayIdle()
      .then(() => waitForTerminalOutputParsed(pane.terminal))
      .then(() => {
        if (!isDisposed() && transport.getPtyId() === ptyId) {
          void getClientRuntime().terminal.reportRendererSerializerReady?.(ptyId)
        }
      })
      .catch(() => {})
  }

  return {
    registerPaneSerializerFor,
    settlePaneSerializerAfterReplay,
    reportRemoteRendererSerializerReady
  }
}
