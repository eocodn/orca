import { expect, it } from 'vitest'

export function registerPtyConnectionLifecycleOwnerBoundaryTests(read) {
  it('routes deferred connect preflight through its concrete owner', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-connect-preflight.ts'
    )

    expect(orchestrator).toContain(
      "import { preparePtyConnectionConnectPreflight } from './pty-connection-connect-preflight'"
    )
    expect(orchestrator).not.toContain(
      "import { createTerminalZeroDimensionsMessage } from '../../../../shared/terminal-zero-dimensions-diagnostic'"
    )
    expect(orchestrator).not.toContain(
      "import { isWorktreeRemovalFenceError } from '../../../../shared/worktree-removal-fence-error'"
    )
    expect(orchestrator).not.toContain('const reportError = (message: string): void => {')
    expect(owner).toContain('export function preparePtyConnectionConnectPreflight(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes fresh-spawn follow recovery through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-fresh-spawn-follow-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionFreshSpawnFollowController } from './pty-connection-fresh-spawn-follow-controller'"
    )
    expect(orchestrator).not.toContain(
      "'fresh-spawn-follow-reset',\n            tryResetNativeFollow"
    )
    expect(orchestrator).not.toContain('let freshSpawnFollowResetDisposables: IDisposable[] = []')
    expect(owner).toContain('export function createPtyConnectionFreshSpawnFollowController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes renderer-risk scan state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-render-risk-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionRenderRiskController } from './pty-connection-render-risk-controller'"
    )
    expect(orchestrator).not.toContain("let foregroundRefreshRiskScanTail = ''")
    expect(orchestrator).not.toContain('let hiddenSynchronizedOutputActive = false')
    expect(orchestrator).not.toContain('function hiddenSynchronizedOutputTouchesParsedFrame(')
    expect(owner).toContain('export function createPtyConnectionRenderRiskController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes foreground render-refresh policy through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-foreground-render-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionForegroundRenderController } from './pty-connection-foreground-render-controller'"
    )
    expect(orchestrator).not.toContain('let foregroundRewriteChunkEndedWithCarriageReturn = false')
    expect(orchestrator).not.toContain('function shouldForceForegroundRenderRefresh(')
    expect(orchestrator).not.toContain('function alternateScreenRewriteAtlasRecoveryOnParsed(')
    expect(owner).toContain('export function createPtyConnectionForegroundRenderController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })
}
