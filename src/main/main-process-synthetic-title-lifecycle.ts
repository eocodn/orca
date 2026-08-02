import * as startupDeps from './main-process-startup-dependencies'
import { startupState } from './main-process-startup-state'

// Why: cursor-agent re-emits its own OSC title on every redraw, overwriting a one-shot frame — so re-assert a working frame on an interval.
// 80ms matches Pi's cadence (smooth but under the IPC budget). opencode needs only one frame but reuses this for consistent animated UX.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80
})

export function sendSyntheticTitle(ptyId: string, data: string, options: { force?: boolean } = {}): void {
  if (!startupState.mainWindow || startupState.mainWindow.isDestroyed()) {
    return
  }
  // Why: throttle decorative spinner frames (up to 80ms/agent); final/permission frames are forced because they drive BEL.
  if (
    !startupDeps.shouldSendSyntheticTitleFrame({
      force: options.force === true,
      windowVisible: isSyntheticTitleWindowVisible()
    })
  ) {
    return
  }
  // Why: feed the per-PTY tracker directly, never onPtyData — emulator/tails/transcripts/stats must not see fabricated bytes.
  startupState.runtime?.ingestSyntheticTitleFrame(ptyId, data)
  // Why: only the kill-switch-off renderer byte-parses synthetic frames; under main authority the copy mints phantom ACKs (see synthetic-title-frame-routing.ts).
  if (startupDeps.shouldCopySyntheticTitleFrameToPtyData(startupState.store?.getSettings())) {
    startupState.mainWindow.webContents.send('pty:data', { id: ptyId, data })
  }
}

export function isSyntheticTitleWindowVisible(): boolean {
  return (
    startupState.mainWindow !== null &&
    !startupState.mainWindow.isDestroyed() &&
    startupState.mainWindow.isVisible() &&
    !startupState.mainWindow.isMinimized()
  )
}

export function canSendDecorativeSyntheticTitle(): boolean {
  return startupDeps.shouldSendSyntheticTitleFrame({
    force: false,
    windowVisible: isSyntheticTitleWindowVisible()
  })
}

export function stopSyntheticTitleSpinner(paneKey: string): void {
  if (startupState.syntheticTitleSpinnerByPaneKey.delete(paneKey)) {
    stopSyntheticTitleSpinnerTimerIfIdle()
  }
}

export function stopAllSyntheticTitleSpinners(): void {
  startupState.syntheticTitleSpinnerByPaneKey.clear()
  stopSyntheticTitleSpinnerTimer()
}

export function stopSyntheticTitleSpinnerTimer(): void {
  if (!startupState.syntheticTitleSpinnerTimer) {
    return
  }
  clearInterval(startupState.syntheticTitleSpinnerTimer)
  startupState.syntheticTitleSpinnerTimer = null
}

export function stopSyntheticTitleSpinnerTimerIfIdle(): void {
  if (startupState.syntheticTitleSpinnerByPaneKey.size === 0) {
    stopSyntheticTitleSpinnerTimer()
  }
}

export function tickSyntheticTitleSpinners(): void {
  if (!canSendDecorativeSyntheticTitle()) {
    stopSyntheticTitleSpinnerTimer()
    return
  }
  const ticks = startupDeps.advanceSyntheticTitleSpinnerEntries({
    entries: startupState.syntheticTitleSpinnerByPaneKey,
    frameCount: SPINNER_FRAMES.length,
    startupDeps.getPtyIdForPaneKey
  })
  for (const tick of ticks) {
    sendSyntheticTitle(
      tick.ptyId,
      `\x1b]0;${SPINNER_FRAMES[tick.frame]} ${tick.profile.workingLabel}\x07`
    )
  }
  stopSyntheticTitleSpinnerTimerIfIdle()
}

export function ensureSyntheticTitleSpinnerTimer(): void {
  if (
    startupState.syntheticTitleSpinnerTimer ||
    startupState.syntheticTitleSpinnerByPaneKey.size === 0 ||
    !canSendDecorativeSyntheticTitle()
  ) {
    return
  }
  // Why: one shared timer for all spinners — per-pane intervals multiplied idle wakeups when several agents were working.
  startupState.syntheticTitleSpinnerTimer = setInterval(tickSyntheticTitleSpinners, SPINNER_INTERVAL_MS)
}

export function resumeSyntheticTitleSpinnerTimer(): void {
  ensureSyntheticTitleSpinnerTimer()
}

export function driveSyntheticTitleFromHook(
  paneKey: string,
  state: startupDeps.AgentStatusState,
  profile: startupDeps.SyntheticAgentTitleProfile
): void {
  const ptyId = startupDeps.getPtyIdForPaneKey(paneKey)
  if (!ptyId) {
    return
  }
  if (state === 'working') {
    // Why: emit the first frame immediately so the spinner is visible now, not up to 80ms later at the next interval tick.
    const existing = startupState.syntheticTitleSpinnerByPaneKey.get(paneKey)
    const frame = existing ? existing.frame : 0
    sendSyntheticTitle(ptyId, `\x1b]0;${SPINNER_FRAMES[frame]} ${profile.workingLabel}\x07`)
    if (existing) {
      // Why: refresh the profile so a mid-pane agent-type change lands on the right idle/permission labels at terminal state.
      existing.profile = profile
      return
    }
    startupState.syntheticTitleSpinnerByPaneKey.set(paneKey, { frame, profile })
    ensureSyntheticTitleSpinnerTimer()
    return
  }
  // Why: stop the spinner first so the next tick can't race the state back to "working", then inject the terminal frame.
  // Permission frames add a trailing BEL to light up user-input states; done frames omit it (completion notifications own that attention).
  stopSyntheticTitleSpinner(paneKey)
  const needsUserInput = state === 'blocked' || state === 'waiting'
  const label = needsUserInput ? profile.permissionLabel : profile.idleLabel
  sendSyntheticTitle(ptyId, `\x1b]0;${label}\x07${needsUserInput ? '\x07' : ''}`, {
    force: true
  })
}

export function shouldSuppressCodexAutoApprovalSyntheticTitleFromHook(args: {
  agentType: string | null | undefined
  state: startupDeps.AgentStatusState
  launchConfig:
    | {
        agentArgs?: string | null
        agentEnv?: Record<string, string> | null
      }
    | null
    | undefined
}): boolean {
  if (args.agentType !== 'codex' || (args.state !== 'waiting' && args.state !== 'blocked')) {
    return false
  }
  if (!args.launchConfig) {
    return false
  }
  return (
    startupDeps.resolveTuiAgentPermissionMode({
      agent: 'codex',
      agentArgs: args.launchConfig.agentArgs,
      agentEnv: args.launchConfig.agentEnv
    }) === 'yolo'
  )
}

export function installSyntheticTitlePaneTeardown(): void {
  startupDeps.registerPaneKeyTeardownListener((paneKey) => {
    stopSyntheticTitleSpinner(paneKey)
  })
}
