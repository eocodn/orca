import { buildFreshShellViewportBlankingSequence } from './terminal-restored-viewport'

type PtyConnectionFreshShellViewportArgs = {
  paneId: number
  rows: number
  forceBlankRestoredViewport: boolean
  restoredViewportBlankingPanes: Set<number> | undefined
  writeReplayData: (data: string) => void
}

export function preparePtyConnectionFreshShellViewport({
  paneId,
  rows,
  forceBlankRestoredViewport,
  restoredViewportBlankingPanes,
  writeReplayData
}: PtyConnectionFreshShellViewportArgs): boolean {
  const hadRestoredViewport = restoredViewportBlankingPanes?.delete(paneId) ?? false
  if (!forceBlankRestoredViewport && !hadRestoredViewport) {
    return false
  }
  writeReplayData(buildFreshShellViewportBlankingSequence(rows))
  return true
}
