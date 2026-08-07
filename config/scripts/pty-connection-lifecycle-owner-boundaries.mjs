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
}
