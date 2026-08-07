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

  it('routes foreground latency budgeting through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-foreground-latency-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionForegroundLatencyController } from './pty-connection-foreground-latency-controller'"
    )
    expect(orchestrator).not.toContain('let foregroundImmediateBudgetChars = 0')
    expect(orchestrator).not.toContain('function consumeForegroundImmediateBudget(')
    expect(orchestrator).not.toContain('function isLatencySensitiveForegroundOutput(')
    expect(owner).toContain('export function createPtyConnectionForegroundLatencyController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes reattach replay queue state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-reattach-replay-controller.ts'
    )
    const serializer = read(
      'src/renderer/src/components/terminal-pane/pty-connection-serializer-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionReattachReplayController } from './pty-connection-reattach-replay-controller'"
    )
    expect(orchestrator).not.toContain('type PendingReplayData = {')
    expect(orchestrator).not.toContain('let pendingReplayData: PendingReplayData | null = null')
    expect(orchestrator).not.toContain('let replayPayloadGeneration = 0')
    expect(orchestrator).not.toContain('let replayDrainQueued = false')
    expect(serializer).not.toContain('const state = { replayWriteQueue: Promise.resolve() }')
    expect(owner).toContain('export function createPtyConnectionReattachReplayController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes synchronized foreground frame state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-synchronized-foreground-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionSynchronizedForegroundController } from './pty-connection-synchronized-foreground-controller'"
    )
    expect(orchestrator).not.toContain('let synchronizedForegroundOutputActive = false')
    expect(orchestrator).not.toContain('let synchronizedForegroundFrameInteractive = false')
    expect(owner).toContain('export function createPtyConnectionSynchronizedForegroundController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes renderer sequence high-water state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-renderer-sequence-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionRendererSequenceController } from './pty-connection-renderer-sequence-controller'"
    )
    expect(orchestrator).not.toContain('let rendererOrderedPtyId: string | null = null')
    expect(orchestrator).not.toContain('let rendererOrderedSeq: number | null = null')
    expect(orchestrator).not.toContain('let rendererChannelSeqPtyId: string | null = null')
    expect(orchestrator).not.toContain('let rendererChannelSeq: number | null = null')
    expect(owner).toContain('export function createPtyConnectionRendererSequenceController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes reattach live-data deferral state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-reattach-live-data-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionReattachLiveDataController')
    expect(orchestrator).toContain("from './pty-connection-reattach-live-data-controller'")
    expect(orchestrator).not.toContain('let deferredReattachLiveData:')
    expect(orchestrator).not.toContain('let deferredReattachLiveDataChars = 0')
    expect(orchestrator).not.toContain('let reattachLiveDataDeferralDepth = 0')
    expect(orchestrator).not.toContain(
      'let deferredReattachLiveDataOwners = new Map<number, { failed: boolean }>()'
    )
    expect(owner).toContain('export function createPtyConnectionReattachLiveDataController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes initial cache-timer seed state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read('src/renderer/src/components/terminal-pane/cache-timer-seeding.ts')

    expect(orchestrator).toContain('createInitialCacheTimerSeedController')
    expect(orchestrator).not.toContain('let hasConsideredInitialCacheTimerSeed = false')
    expect(orchestrator).not.toContain('let allowInitialIdleCacheSeed = false')
    expect(owner).toContain('export function createInitialCacheTimerSeedController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes title-only interrupt settlement through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-title-only-interrupt-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionTitleOnlyInterruptController')
    expect(orchestrator).not.toContain(
      'let titleOnlyInterruptTimer: ReturnType<typeof setTimeout> | null = null'
    )
    expect(owner).toContain('export function createPtyConnectionTitleOnlyInterruptController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes Droid reconfirm debounce state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-droid-reconfirmation-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionDroidReconfirmationController')
    expect(orchestrator).not.toContain(
      'let shiftEnterReconfirmTimer: ReturnType<typeof setTimeout> | null = null'
    )
    expect(orchestrator).not.toContain('SHIFT_ENTER_RECONFIRM_IDLE_MS')
    expect(owner).toContain('export function createPtyConnectionDroidReconfirmationController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes alternate-screen repaint cooldown through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-alternate-screen-repaint-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionAlternateScreenRepaintController')
    expect(orchestrator).not.toContain(
      'let alternateScreenBackgroundRepaintTimer: ReturnType<typeof setTimeout> | null = null'
    )
    expect(owner).toContain('export function createPtyConnectionAlternateScreenRepaintController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes visible foreground sample admission through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-visible-foreground-sample-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionVisibleForegroundSampleController')
    expect(orchestrator).not.toContain('let visibleForegroundSamplePending = false')
    expect(orchestrator).not.toContain('let visibleForegroundSampleSettled = false')
    expect(owner).toContain('export function createPtyConnectionVisibleForegroundSampleController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes deferred command-finished status drop through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-command-finished-status-drop-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionCommandFinishedStatusDropController')
    expect(orchestrator).not.toContain(
      'let deferredCommandFinishedStatusDrop: (() => void) | null = null'
    )
    expect(owner).toContain(
      'export function createPtyConnectionCommandFinishedStatusDropController('
    )
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes transport connect settle state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-transport-settle-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionTransportSettleController')
    expect(orchestrator).not.toContain('let transportConnectInFlightSince: number | null = null')
    expect(orchestrator).not.toContain('TRANSPORT_CONNECT_SETTLE_GRACE_MS')
    expect(owner).toContain('export function createPtyConnectionTransportSettleController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes active pane PTY binding state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-pane-pty-binding-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionPanePtyBindingController')
    expect(orchestrator).not.toContain('let activePanePtyBinding: string | null = null')
    expect(orchestrator).not.toContain('let activePanePtyBindingBoundAt: number | null = null')
    expect(owner).toContain('export function createPtyConnectionPanePtyBindingController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes native Windows done-status watching through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-windows-done-status-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionWindowsDoneStatusController')
    expect(orchestrator).not.toContain(
      'let lastAgentStatusState = state.agentStatusByPaneKey[cacheKey]?.state'
    )
    expect(orchestrator).not.toContain(
      'let unsubscribeWindowsDoneTerminalModeReset: (() => void) | null = null'
    )
    expect(owner).toContain('export function createPtyConnectionWindowsDoneStatusController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes deferred title-completion side effects through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-title-completion-deferral-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionTitleCompletionDeferralController')
    expect(orchestrator).not.toContain('let pendingSuppressedTitleSideEffects: {')
    expect(owner).toContain('export function createPtyConnectionTitleCompletionDeferralController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes transport stream generation through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-stream-generation-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionStreamGenerationController')
    expect(orchestrator).not.toContain('let transportStreamGeneration = 0')
    expect(owner).toContain('export function createPtyConnectionStreamGenerationController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes terminal activity evidence through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-terminal-activity-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionTerminalActivityController')
    expect(orchestrator).not.toContain('let lastTerminalInputAt = Number.NEGATIVE_INFINITY')
    expect(orchestrator).not.toContain('let hasReceivedPtyOutput = false')
    expect(owner).toContain('export function createPtyConnectionTerminalActivityController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes terminal-park mount evidence through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-park-mount-evidence-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionParkMountEvidenceController')
    expect(orchestrator).not.toContain(
      'let mountFollowsTerminalPark = isTerminalTabParked(deps.tabId)'
    )
    expect(owner).toContain('export function createPtyConnectionParkMountEvidenceController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes renderer-only resize suppression through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-resize-suppression-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionResizeSuppressionController')
    expect(orchestrator).not.toContain('let suppressStructuralReplayPtyResize = false')
    expect(orchestrator).not.toContain('let suppressViewportClaimTerminalResize = false')
    expect(owner).toContain('export function createPtyConnectionResizeSuppressionController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes terminal buffer-switch observation through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-buffer-switch-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionBufferSwitchController')
    expect(orchestrator).not.toContain('let alternateScreenBufferSwitches = 0')
    expect(owner).toContain('export function createPtyConnectionBufferSwitchController(')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes hibernated-agent wake state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-hibernated-wake-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionHibernatedWakeController')
    expect(orchestrator).not.toContain('let hibernatedWakeTarget:')
    expect(orchestrator).not.toContain('let pendingHibernatedWakeTarget:')
    expect(orchestrator).not.toContain('let hibernatedWakeInFlightClaimKey:')
    expect(orchestrator).not.toContain('let wakeHibernatedAgentPane:')
    expect(owner).toContain('export function createPtyConnectionHibernatedWakeController')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes agent-idle terminal mode state through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-agent-idle-terminal-mode-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionAgentIdleTerminalModeController')
    expect(orchestrator).not.toContain('let idleAgentTerminalModeReset =')
    expect(orchestrator).not.toContain('let suppressNativeWindowsIdleCodexFocusReports =')
    expect(orchestrator).not.toContain('let queueAgentIdleTerminalModeReset =')
    expect(owner).toContain('export function createPtyConnectionAgentIdleTerminalModeController')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes remote-runtime output-pause identity through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-remote-output-pause-controller.ts'
    )

    expect(orchestrator).toContain('createPtyConnectionRemoteOutputPauseController')
    expect(orchestrator).not.toContain('let remoteOutputPausedPtyId:')
    expect(owner).toContain('export function createPtyConnectionRemoteOutputPauseController')
    expect(owner.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })
}
