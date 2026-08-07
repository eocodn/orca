type PtyConnectionFreshSpawnPreflightArgs = {
  legacyWorkerAutomaticResumeBlocked: boolean
  worktreeDeleting: boolean
  hasSshConnection: boolean
  startupCommand: string | null
  clearPaneMode2031State: () => void
  clearHiddenOutputRestoreState: () => void
  resetFreshSpawnFollowOutput: () => void
  resetKittyKeyboardModes: () => void
  prepareFreshShellViewportForSpawn: () => void
  setPendingStartupCommand: (command: { command: string }) => void
}

export function runPtyConnectionFreshSpawnPreflight({
  legacyWorkerAutomaticResumeBlocked,
  worktreeDeleting,
  hasSshConnection,
  startupCommand,
  clearPaneMode2031State,
  clearHiddenOutputRestoreState,
  resetFreshSpawnFollowOutput,
  resetKittyKeyboardModes,
  prepareFreshShellViewportForSpawn,
  setPendingStartupCommand
}: PtyConnectionFreshSpawnPreflightArgs): boolean {
  if (legacyWorkerAutomaticResumeBlocked || worktreeDeleting) {
    return false
  }
  clearPaneMode2031State()
  clearHiddenOutputRestoreState()
  resetFreshSpawnFollowOutput()
  resetKittyKeyboardModes()
  prepareFreshShellViewportForSpawn()
  if (hasSshConnection && startupCommand) {
    setPendingStartupCommand({ command: startupCommand })
  }
  return true
}
