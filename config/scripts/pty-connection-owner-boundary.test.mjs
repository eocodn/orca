import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(projectDir, path), 'utf8')

describe('PTY connection owner boundaries', () => {
  it('routes pending-spawn adoption through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-pending-spawn-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionPendingSpawnController } from './pty-connection-pending-spawn-controller'"
    )
    expect(orchestrator).not.toContain('const pendingSpawn = pendingSpawnByPaneKey.get(')
    expect(controller).toContain('export function createPtyConnectionPendingSpawnController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes restored PTY candidate selection through its concrete resolver', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const resolver = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-candidate.ts'
    )

    expect(orchestrator).toContain(
      "import { resolvePtyConnectionAttachCandidate } from './pty-connection-attach-candidate'"
    )
    expect(orchestrator).not.toContain('const candidateReattachSessionId =')
    expect(orchestrator).not.toContain('const candidateHasEagerBuffer =')
    expect(resolver).toContain('export function resolvePtyConnectionAttachCandidate(')
    expect(resolver.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY attach execution through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionAttachController } from './pty-connection-attach-controller'"
    )
    expect(orchestrator).not.toContain('transport.attach({')
    expect(orchestrator).not.toContain('const attachRetainedLegacyPty =')
    expect(controller).toContain('export function createPtyConnectionAttachController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY reattach attempt lifecycle through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-reattach-attempt-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionReattachAttemptController } from './pty-connection-reattach-attempt-controller'"
    )
    expect(orchestrator).not.toContain('let expiredReattachError = false')
    expect(orchestrator).not.toContain('const trackedReattachPromise =')
    expect(controller).toContain('export function createPtyConnectionReattachAttemptController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes deferred startup grid scheduling through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-startup-grid-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionStartupGridController } from './pty-connection-startup-grid-controller'"
    )
    expect(orchestrator).not.toContain('let startupGridSettleHandle:')
    expect(orchestrator).not.toContain('const runDeferredConnect =')
    expect(controller).toContain('export function createPtyConnectionStartupGridController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY session liveness reconciliation through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-liveness-reconcile-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionSessionLivenessReconcileController } from './pty-connection-session-liveness-reconcile-controller'"
    )
    expect(orchestrator).not.toContain('const reconcileIfSessionDead =')
    expect(orchestrator).not.toContain('const reconcileIfSessionMissing =')
    expect(controller).toContain(
      'export function createPtyConnectionSessionLivenessReconcileController('
    )
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY size reassertion through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-size-reassertion-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionSizeReassertionController } from './pty-connection-size-reassertion-controller'"
    )
    expect(orchestrator).not.toContain('const ptySizeReassertion =')
    expect(orchestrator).not.toContain('const scheduleForegroundGridDriftCheck =')
    expect(controller).toContain('export function createPtyConnectionSizeReassertionController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes post-spawn PTY size convergence through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-spawn-size-reconcile-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionSpawnSizeReconcileController } from './pty-connection-spawn-size-reconcile-controller'"
    )
    expect(orchestrator).not.toContain('let ptySizeReconcileHandle:')
    expect(orchestrator).not.toContain('const reconcilePtySizeAfterSpawn =')
    expect(controller).toContain('export function createPtyConnectionSpawnSizeReconcileController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes observed pane geometry through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-pane-geometry-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionPaneGeometryController } from './pty-connection-pane-geometry-controller'"
    )
    expect(orchestrator).not.toContain('const handleObservedPaneGeometry =')
    expect(orchestrator).not.toContain('const geometryReportObserver =')
    expect(controller).toContain('export function createPtyConnectionPaneGeometryController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY resize forwarding through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-resize-forwarding-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionResizeForwardingController } from './pty-connection-resize-forwarding-controller'"
    )
    expect(orchestrator).not.toContain('const forwardPtyResize =')
    expect(orchestrator).not.toContain('const onHeldPtyResizeFlush =')
    expect(controller).toContain('export function createPtyConnectionResizeForwardingController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes remote viewport claim state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-remote-viewport-claim-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionRemoteViewportClaimController } from './pty-connection-remote-viewport-claim-controller'"
    )
    expect(orchestrator).not.toContain('let visibleRemoteViewportClaimPtyId: string | null = null')
    expect(orchestrator).not.toContain('const claimViewportForUserActivity =')
    expect(controller).toContain(
      'export function createPtyConnectionRemoteViewportClaimController('
    )
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes PTY exit lifecycle through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-exit-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionExitController } from './pty-connection-exit-controller'"
    )
    expect(orchestrator).not.toContain('const onExit = (ptyId: string')
    expect(orchestrator).not.toContain('let handledExitPtyId: string | null = null')
    expect(controller).toContain('export function createPtyConnectionExitController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes agent notification timing through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-agent-notification-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionAgentNotificationController } from './pty-connection-agent-notification-controller'"
    )
    expect(orchestrator).not.toContain('const scheduleAgentTaskCompleteNotification =')
    expect(orchestrator).not.toContain('let pendingTerminalBellNotification =')
    expect(controller).toContain('export function createPtyConnectionAgentNotificationController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })
})
