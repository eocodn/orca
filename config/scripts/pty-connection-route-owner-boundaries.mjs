import { expect, it } from 'vitest'

export function registerPtyConnectionRouteOwnerBoundaryTests(read) {
  it('routes restored PTY candidate selection through its concrete resolver', () => {
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-route-observation.ts'
    )
    const resolver = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-candidate.ts'
    )

    expect(owner).toContain(
      "import { resolvePtyConnectionAttachCandidate } from './pty-connection-attach-candidate'"
    )
    expect(owner).not.toContain('const candidateReattachSessionId =')
    expect(owner).not.toContain('const candidateHasEagerBuffer =')
    expect(resolver).toContain('export function resolvePtyConnectionAttachCandidate(')
    expect(resolver.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes attach-route observation and cleanup through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const observedRoute = read(
      'src/renderer/src/components/terminal-pane/pty-connection-observed-normal-route.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-attach-route-observation.ts'
    )

    expect(observedRoute).toContain('preparePtyConnectionAttachRouteObservation')
    expect(observedRoute).toContain("from './pty-connection-attach-route-observation'")
    expect(orchestrator).not.toContain('const existingPtyClaimedBySibling = Boolean(')
    expect(orchestrator).not.toContain(
      'if (sleptRemoteRuntimeSessionId) {\n      deps.syncPanePtyLayoutBinding(pane.id, null)'
    )
    expect(owner).toContain('export function preparePtyConnectionAttachRouteObservation(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes observed normal PTY candidates through one concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-observed-normal-route.ts'
    )

    expect(orchestrator).toContain(
      "import { runPtyConnectionObservedNormalRoute } from './pty-connection-observed-normal-route'"
    )
    expect(orchestrator).not.toContain(
      "import { preparePtyConnectionAttachRouteObservation } from './pty-connection-attach-route-observation'"
    )
    expect(orchestrator).not.toContain(
      "import { runPtyConnectionNormalRouteSession } from './pty-connection-normal-route-session'"
    )
    expect(orchestrator).not.toContain('const {\n      sleptRemoteRuntimeSessionId,')
    expect(owner).toContain('preparePtyConnectionAttachRouteObservation(observation)')
    expect(owner).toContain('runPtyConnectionNormalRouteSession({')
    expect(owner).toContain('export function runPtyConnectionObservedNormalRoute(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
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
}
