import { buildStartupCommandSubmission } from '../shared/startup-command-submission'
import { drainShellReadyHeldBytes, scanForShellReady } from '../main/shell-ready-marker-scanner'
import {
  INTERACTIVE_OUTPUT_BUDGET_CHARS,
  INTERACTIVE_OUTPUT_MAX_CHARS,
  INTERACTIVE_OUTPUT_WINDOW_MS,
  INTERACTIVE_REDRAW_MAX_CHARS,
  STARTUP_COMMAND_WRITE_DELAY_MS,
  disposeManagedPty,
  type ManagedPty
} from './pty-session-stage-contracts'
import { PtyHandlerStage1Capacity } from './pty-session-stage-1-capacity'
import { listShellProfiles, resolveDefaultShell } from './pty-shell-utils'
import { PtyStartupIngress, type PtyIngressEmission } from '../shared/pty-startup-ingress'
import {
  AGENT_SESSION_CREATE_OPERATION_PROTOCOL_VERSION,
  AGENT_SESSION_EXECUTION_OWNER_PROTOCOL_VERSION
} from '../shared/agent-session-host-authority'
import { PTY_STARTUP_INGRESS_VERSION } from '../shared/pty-startup-ingress'
import { PhysicalExitTracker } from '../shared/physical-exit-tracker'

export abstract class PtyHandlerStage1 extends PtyHandlerStage1Capacity {
  protected clearStartupCommandTimer(managed: ManagedPty): void {
    if (managed.startupCommand?.timer) {
      clearTimeout(managed.startupCommand.timer)
      managed.startupCommand.timer = null
    }
  }

  protected appendReplayBuffer(managed: ManagedPty, data: string): void {
    if (data.length === 0) {
      return
    }
    managed.buffered.append(data)
  }

  protected releaseStartupCommand(managed: ManagedPty): void {
    this.clearStartupCommandTimer(managed)
    managed.startupCommand = undefined
  }

  protected scheduleStartupCommandDelivery(managed: ManagedPty, delayMs: number): void {
    const startup = managed.startupCommand
    if (!startup || startup.delivered || managed.disposed) {
      return
    }
    this.clearStartupCommandTimer(managed)
    startup.timer = setTimeout(() => {
      startup.timer = null
      this.deliverStartupCommand(managed)
    }, delayMs)
  }

  protected deliverStartupCommand(managed: ManagedPty): void {
    const startup = managed.startupCommand
    if (!startup || startup.delivered || managed.disposed) {
      return
    }
    startup.delivered = true
    this.clearStartupCommandTimer(managed)
    if (startup.scanState) {
      const heldBytes = drainShellReadyHeldBytes(startup.scanState)
      if (heldBytes) {
        managed.startupIngress?.accept(heldBytes)
      }
    }
    const submit = process.platform === 'win32' ? '\r' : '\n'
    // Why: only the shell-ready wrapper arms bracketed-paste; other shells use raw submit so ESC[200~ markers aren't echoed.
    const payload = buildStartupCommandSubmission(startup.command, {
      submit,
      bracketedPasteSafe: startup.waitForShellReady
    })
    managed.startupCommand = undefined
    managed.pty.write(payload)
  }

  /** Wire onData/onExit listeners for a managed PTY and store it. */
  protected wireAndStore(managed: ManagedPty): void {
    managed.physicalExit = new PhysicalExitTracker()
    this.ptys.set(managed.id, managed)
    const emitIngressData = (emission: PtyIngressEmission): void => {
      const rawLength = emission.rawEndSeq - emission.rawStartSeq
      this.appendReplayBuffer(managed, emission.data)
      this.enqueuePtyOutput(
        managed.id,
        emission.data,
        emission.transformed || rawLength !== emission.data.length
          ? { rawLength, seq: emission.rawEndSeq, transformed: true }
          : {}
      )
    }
    managed.startupIngress ??= new PtyStartupIngress({
      ...(managed.startupIngressIntent ? { intent: managed.startupIngressIntent } : {}),
      ownerBackend: managed.ownerBackend,
      write: (data) => managed.pty.write(data),
      onEmission: emitIngressData
    })
    managed.pty.onData((data: string) => {
      const startup = managed.startupCommand
      if (startup?.waitForShellReady && startup.scanState && !startup.delivered) {
        const scanned = scanForShellReady(startup.scanState, data)
        data = scanned.output
        if (scanned.matched) {
          this.scheduleStartupCommandDelivery(managed, STARTUP_COMMAND_WRITE_DELAY_MS)
        }
      }
      managed.startupIngress?.accept(data)
    })
    managed.pty.onExit(({ exitCode }: { exitCode: number }) => {
      managed.physicalExit?.markExited()
      if (managed.disposed) {
        return
      }
      // Why: neutralize pty.kill synchronously so node-pty's 'close' SIGHUP can't hit a recycled pid on POSIX.
      if (process.platform !== 'win32') {
        ;(managed.pty as unknown as { kill: (sig?: string) => void }).kill = () => {}
      }
      // Why: clear the SIGKILL fallback timer on clean exit so it doesn't fire later.
      if (managed.killTimer) {
        clearTimeout(managed.killTimer)
        managed.killTimer = undefined
      }
      this.clearStartupCommandTimer(managed)
      this.releaseRelayIngress(managed)
      this.pausedOutputPtys.delete(managed.id)
      this.consumerPausedOutputPtys.delete(managed.id)
      this.flushPtyOutput(managed.id)
      this.pendingExitByPty.set(managed.id, {
        id: managed.id,
        code: exitCode,
        incarnationId: managed.incarnationId
      })
      this.publishPendingExit(managed.id)
      this.notifyExitListener(managed)
      this.agentSessionOwners.release(managed.id)
      this.ptys.delete(managed.id)
      this.clearPtyInputState(managed.id)
      // Why: release the ptmx fd on natural exit, else the master fd leaks until GC (docs/fix-pty-fd-leak.md).
      disposeManagedPty(managed)
    })
  }

  protected releaseRelayIngress(managed: ManagedPty): void {
    const startupCommand = managed.startupCommand
    const scanState = startupCommand?.scanState
    if (scanState) {
      const held = drainShellReadyHeldBytes(scanState)
      startupCommand.scanState = null
      managed.startupIngress?.accept(held)
    }
    managed.startupIngress?.drainAndClose()
  }

  protected notifyExitListener(managed: ManagedPty): void {
    if (managed.exitListenerNotified) {
      return
    }
    managed.exitListenerNotified = true
    // Why: notify exactly once — both physical exit and whole-relay disposal reach here.
    if (this.exitListener) {
      try {
        this.exitListener({ id: managed.id, paneKey: managed.paneKey })
      } catch (err) {
        process.stderr.write(
          `[pty-handler] exit listener threw: ${err instanceof Error ? err.message : String(err)}\n`
        )
      }
    }
  }

  protected registerHandlers(): void {
    this.dispatcher.onRequest('pty.spawn', (p, context) => this.spawn(p, context))
    this.dispatcher.onRequest('pty.attach', (p, context) => this.attach(p, context))
    this.dispatcher.onRequest('pty.shutdown', (p) => this.shutdown(p))
    this.dispatcher.onRequest('pty.sendSignal', (p) => this.sendSignal(p))
    this.dispatcher.onRequest('pty.getCwd', (p) => this.getCwd(p))
    this.dispatcher.onRequest('pty.getInitialCwd', (p) => this.getInitialCwd(p))
    this.dispatcher.onRequest('pty.getSize', (p) => this.getSize(p))
    this.dispatcher.onRequest('pty.resizeIfCurrent', (p) => this.resizeIfCurrent(p))
    this.dispatcher.onRequest('pty.clearBuffer', (p) => this.clearBuffer(p))
    this.dispatcher.onRequest('pty.hasChildProcesses', (p) => this.hasChildProcesses(p))
    this.dispatcher.onRequest('pty.getForegroundProcess', (p) => this.getForegroundProcess(p))
    this.dispatcher.onRequest('pty.inspectProcess', (p) => this.inspectProcess(p))
    this.dispatcher.onRequest('pty.getCapabilities', async () => ({
      startupIngressVersion: PTY_STARTUP_INGRESS_VERSION,
      agentSessionClaimVersion: AGENT_SESSION_EXECUTION_OWNER_PROTOCOL_VERSION,
      agentSessionCreateOperationVersion: AGENT_SESSION_CREATE_OPERATION_PROTOCOL_VERSION
    }))
    this.dispatcher.onRequest('pty.listProcesses', () => this.listProcesses())
    this.dispatcher.onRequest('pty.getDefaultShell', async () => resolveDefaultShell())
    this.dispatcher.onRequest('pty.serialize', (p) => this.serialize(p))
    this.dispatcher.onRequest('pty.revive', (p) => this.revive(p))
    this.dispatcher.onRequest('pty.getProfiles', async () => listShellProfiles())
    this.dispatcher.onRequest('pty.closeStartupQueryAuthority', (p) =>
      this.closeStartupQueryAuthority(p)
    )

    this.dispatcher.onNotification('pty.data', (p) => this.writeData(p))
    this.dispatcher.onNotification('pty.resize', (p) => this.resize(p))
    this.dispatcher.onNotification('pty.ackData', (_p) => {
      /* flow control ack -- not yet enforced */
    })
  }

  protected isLikelyInteractiveRedraw(data: string): boolean {
    if (data.length <= INTERACTIVE_OUTPUT_MAX_CHARS) {
      return true
    }
    return data.length <= INTERACTIVE_REDRAW_MAX_CHARS && data.includes('\x1b[')
  }

  protected async closeStartupQueryAuthority(
    params: Record<string, unknown>
  ): Promise<{ appliedSeq: number }> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      throw new Error(`PTY "${id}" not found`)
    }
    return { appliedSeq: managed.startupIngress?.closeQueryAuthority() ?? 0 }
  }

  protected shouldSendInteractiveOutputNow(id: string, data: string): boolean {
    const lastInputAt = this.lastInputAtByPty.get(id)
    const now = performance.now()
    if (lastInputAt === undefined || now - lastInputAt > INTERACTIVE_OUTPUT_WINDOW_MS) {
      this.interactiveOutputCharsByPty.delete(id)
      return false
    }
    if (!this.isLikelyInteractiveRedraw(data)) {
      this.interactiveOutputCharsByPty.set(id, INTERACTIVE_OUTPUT_BUDGET_CHARS)
      return false
    }
    const usedChars = this.interactiveOutputCharsByPty.get(id) ?? 0
    if (usedChars + data.length > INTERACTIVE_OUTPUT_BUDGET_CHARS) {
      this.interactiveOutputCharsByPty.set(id, INTERACTIVE_OUTPUT_BUDGET_CHARS)
      return false
    }
    this.interactiveOutputCharsByPty.set(id, usedChars + data.length)
    return true
  }
}
