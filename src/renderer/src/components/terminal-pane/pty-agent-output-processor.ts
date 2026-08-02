// PTY output parsing and deferred agent side effects.
import {
  detectAgentStatusFromTitle,
  clearWorkingIndicators,
  createAgentStatusTracker,
  normalizeTerminalTitle,
  extractAllOscTitles
} from '../../../../shared/agent-detection'
import { createBellDetector } from '../../../../shared/terminal-bell-detector'
import {
  createAgentStatusOscProcessor,
  type ProcessedAgentStatusChunk
} from '../../../../shared/agent-status-osc'
import type { PtyDataMeta } from './pty-dispatcher'
import type { IpcPtyTransportOptions, PtyTransport } from './pty-transport-types'

const STALE_TITLE_TIMEOUT = 3000
const MAX_PTY_SIDE_EFFECTS_PER_DRAIN = 64
// The bounded queue keeps hidden-tab status floods from retaining unbounded payload data.
export const MAX_PENDING_PTY_SIDE_EFFECTS = 512
export const MAX_EVICTED_AGENT_STATUS_PAYLOAD_CARRY = 16

type PtyOutputCallbacks = Parameters<PtyTransport['connect']>[0]['callbacks']

type PtyOutputProcessorOptions = Pick<
  IpcPtyTransportOptions,
  | 'onTitleChange'
  | 'onBell'
  | 'onAgentBecameIdle'
  | 'onAgentBecameWorking'
  | 'onAgentExited'
  | 'onAgentStatus'
> & {
  initialAgentTitle?: string
}

type ProcessPtyOutputOptions = {
  replayingBufferedData?: boolean
  suppressAttentionEvents?: boolean
  clearBeforeReplay?: boolean
  pendingEscapeTailAnsi?: string
}

type PendingPtySideEffect = {
  payloads: ProcessedAgentStatusChunk['payloads']
  titles: string[]
  titleScanEffect: 'none' | 'stale-probe' | 'ignored-cursor-native'
  containsBell: boolean
  suppressAttentionEvents: boolean
}

function isIgnoredCursorNativeTitle(title: string): boolean {
  return title.trim().toLowerCase() === 'cursor agent'
}

function removeIgnoredCursorNativeTitles(titles: string[]): boolean {
  let writeIndex = 0
  let removed = false
  for (let readIndex = 0; readIndex < titles.length; readIndex += 1) {
    const title = titles[readIndex]
    if (isIgnoredCursorNativeTitle(title)) {
      removed = true
      continue
    }
    if (writeIndex !== readIndex) {
      titles[writeIndex] = title
    }
    writeIndex += 1
  }
  if (removed) {
    titles.length = writeIndex
  }
  return removed
}

export function createPtyOutputProcessor({
  onTitleChange,
  onBell,
  onAgentBecameIdle,
  onAgentBecameWorking,
  onAgentExited,
  onAgentStatus,
  initialAgentTitle
}: PtyOutputProcessorOptions): {
  processData: (
    data: string,
    callbacks: PtyOutputCallbacks,
    options?: ProcessPtyOutputOptions,
    meta?: PtyDataMeta
  ) => void
  clearAccumulatedState: () => void
  pausePendingSideEffects: () => void
  clearStaleTitleTimer: () => void
  flushPendingSideEffects: () => void
  resetBellDetector: () => void
  resetAgentStatusCarry: () => void
} {
  const bellDetector = createBellDetector()
  // Why let: a model-restore marker drops bytes; recreating the parser stops a partial OSC-9999 carry from swallowing the next chunk's head.
  let processAgentStatusChunk = createAgentStatusOscProcessor()
  // Why: seed emitted-title memory and the agent tracker so a mid-session processor behaves as if it had observed the pane's last live title.
  let lastEmittedTitle: string | null =
    initialAgentTitle !== undefined ? normalizeTerminalTitle(initialAgentTitle) : null
  let staleTitleTimer: ReturnType<typeof setTimeout> | null = null
  let sideEffectDrainTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSideEffects: PendingPtySideEffect[] = []
  let pendingSideEffectIndex = 0
  let pendingWorkingTitleSideEffects = 0
  const agentTracker =
    onAgentBecameIdle || onAgentBecameWorking || onAgentExited
      ? createAgentStatusTracker(
          (title) => {
            onAgentBecameIdle?.(title)
          },
          onAgentBecameWorking,
          onAgentExited,
          initialAgentTitle
        )
      : null

  function isWorkingTitle(title: string | null): boolean {
    return title !== null && detectAgentStatusFromTitle(title) === 'working'
  }

  function countWorkingTitles(titles: string[]): number {
    let count = 0
    for (const title of titles) {
      if (isWorkingTitle(normalizeTerminalTitle(title))) {
        count += 1
      }
    }
    return count
  }

  function applyObservedTerminalTitle(title: string, suppressAgentTracker = false): void {
    lastEmittedTitle = normalizeTerminalTitle(title)
    onTitleChange?.(lastEmittedTitle, title)
    if (!suppressAgentTracker) {
      agentTracker?.handleTitle(title)
    }
  }

  function clearStaleTitleTimer(): void {
    if (staleTitleTimer) {
      clearTimeout(staleTitleTimer)
      staleTitleTimer = null
    }
  }

  function scheduleSideEffectDrain(): void {
    if (sideEffectDrainTimer !== null) {
      return
    }
    // Why: defer title/status/BEL store work so xterm.write()'s own parse timer and live rendering get the next turn.
    sideEffectDrainTimer = setTimeout(drainPtySideEffects, 0)
  }

  // Why: oldest-first eviction at the cap. Evicted titles are safe to drop (titles are last-wins);
  // bells and agent-status payloads collapse onto the next-oldest survivor so a pending bell latch
  // and the newest statuses still apply on drain instead of vanishing.
  function evictOldestPendingSideEffectsIfFull(): void {
    while (pendingSideEffects.length - pendingSideEffectIndex >= MAX_PENDING_PTY_SIDE_EFFECTS) {
      const evicted = pendingSideEffects[pendingSideEffectIndex]
      if (!evicted) {
        return
      }
      pendingSideEffectIndex += 1
      // Why: mirror applyPtySideEffect's accounting so stale-probe arming doesn't stick past eviction.
      pendingWorkingTitleSideEffects -= countWorkingTitles(evicted.titles)
      if (pendingWorkingTitleSideEffects < 0) {
        pendingWorkingTitleSideEffects = 0
      }
      const survivor = pendingSideEffects[pendingSideEffectIndex]
      if (survivor) {
        if (evicted.containsBell) {
          survivor.containsBell = true
        }
        if (evicted.payloads.length > 0) {
          const merged = evicted.payloads.concat(survivor.payloads)
          survivor.payloads =
            merged.length > MAX_EVICTED_AGENT_STATUS_PAYLOAD_CARRY
              ? merged.slice(-MAX_EVICTED_AGENT_STATUS_PAYLOAD_CARRY)
              : merged
        }
      }
      compactPendingSideEffectsIfNeeded()
    }
  }

  function enqueuePtySideEffect(next: PendingPtySideEffect): void {
    const workingTitleCount = countWorkingTitles(next.titles)
    const prior = pendingSideEffects.at(-1)
    if (
      prior &&
      prior.titles.length === 0 &&
      prior.payloads.length === 0 &&
      !prior.containsBell &&
      prior.suppressAttentionEvents === next.suppressAttentionEvents &&
      next.titles.length === 0 &&
      next.payloads.length === 0 &&
      !next.containsBell
    ) {
      // Why: for adjacent no-op scans, only the latest event decides whether stale-title detection stays cleared or re-arms.
      prior.titleScanEffect = next.titleScanEffect
      pendingWorkingTitleSideEffects += workingTitleCount
      return
    }
    evictOldestPendingSideEffectsIfFull()
    pendingSideEffects.push(next)
    pendingWorkingTitleSideEffects += workingTitleCount
  }

  function schedulePtySideEffects(
    data: string,
    payloads: ReturnType<typeof processAgentStatusChunk>['payloads'],
    suppressAttentionEvents: boolean
  ): void {
    const scannedForTitles = Boolean(onTitleChange && data.includes('\x1b]'))
    const titles = scannedForTitles ? extractAllOscTitles(data) : []
    // Why: Cursor emits this ignored title every redraw; keep one queue fact instead of an allocation and drain slot per frame.
    const ignoredCursorNativeTitle = removeIgnoredCursorNativeTitles(titles)
    const deliveredPayloads =
      onAgentStatus && !suppressAttentionEvents && payloads.length > 0 ? payloads : []
    const containsBell = Boolean(
      onBell && !suppressAttentionEvents && bellDetector.chunkContainsBell(data)
    )
    const needsStaleTitleProbe = Boolean(
      onTitleChange &&
      data.length > 0 &&
      titles.length === 0 &&
      !suppressAttentionEvents &&
      (isWorkingTitle(lastEmittedTitle) || pendingWorkingTitleSideEffects > 0)
    )
    const shouldEmitEmptyTitleScan = scannedForTitles || needsStaleTitleProbe
    const emptyTitleScanEffect: PendingPtySideEffect['titleScanEffect'] = ignoredCursorNativeTitle
      ? 'ignored-cursor-native'
      : shouldEmitEmptyTitleScan
        ? 'stale-probe'
        : 'none'
    if (!shouldEmitEmptyTitleScan && deliveredPayloads.length === 0 && !containsBell) {
      return
    }

    // Why: queue compact derived facts, not raw PTY chunks, which would duplicate the terminal scheduler backlog while timers are throttled.
    if (deliveredPayloads.length === 0 && titles.length === 0) {
      enqueuePtySideEffect({
        payloads: [],
        titles: [],
        titleScanEffect: emptyTitleScanEffect,
        containsBell,
        suppressAttentionEvents
      })
    } else {
      for (const payload of deliveredPayloads) {
        enqueuePtySideEffect({
          payloads: [payload],
          titles: [],
          titleScanEffect: 'none',
          containsBell: false,
          suppressAttentionEvents
        })
      }
      if (titles.length === 0 && shouldEmitEmptyTitleScan) {
        enqueuePtySideEffect({
          payloads: [],
          titles: [],
          titleScanEffect: emptyTitleScanEffect,
          containsBell: false,
          suppressAttentionEvents
        })
      }
      for (const title of titles) {
        enqueuePtySideEffect({
          payloads: [],
          titles: [title],
          titleScanEffect: 'none',
          containsBell: false,
          suppressAttentionEvents
        })
      }
      if (containsBell) {
        enqueuePtySideEffect({
          payloads: [],
          titles: [],
          titleScanEffect: 'none',
          containsBell: true,
          suppressAttentionEvents
        })
      }
    }
    scheduleSideEffectDrain()
  }

  function clearSideEffectDrainTimer(): void {
    if (sideEffectDrainTimer) {
      clearTimeout(sideEffectDrainTimer)
      sideEffectDrainTimer = null
    }
  }

  function compactPendingSideEffectsIfNeeded(force = false): void {
    if (pendingSideEffectIndex === 0) {
      return
    }
    if (pendingSideEffectIndex >= pendingSideEffects.length) {
      pendingSideEffects = []
      pendingSideEffectIndex = 0
      return
    }
    if (force || pendingSideEffectIndex >= MAX_PTY_SIDE_EFFECTS_PER_DRAIN * 4) {
      pendingSideEffects = pendingSideEffects.slice(pendingSideEffectIndex)
      pendingSideEffectIndex = 0
    }
  }

  function applyPtySideEffect(next: PendingPtySideEffect): void {
    pendingWorkingTitleSideEffects -= countWorkingTitles(next.titles)
    if (pendingWorkingTitleSideEffects < 0) {
      pendingWorkingTitleSideEffects = 0
    }
    if (onAgentStatus) {
      for (const payload of next.payloads) {
        onAgentStatus(payload)
      }
    }
    processObservedTitles(next.titles, next.titleScanEffect, next.suppressAttentionEvents)
    if (onBell && next.containsBell) {
      onBell()
    }
  }

  function drainPtySideEffects(options: { flushAll?: boolean } = {}): void {
    sideEffectDrainTimer = null
    const maxEffects = options.flushAll ? Number.POSITIVE_INFINITY : MAX_PTY_SIDE_EFFECTS_PER_DRAIN
    let processed = 0
    while (pendingSideEffectIndex < pendingSideEffects.length && processed < maxEffects) {
      const next = pendingSideEffects[pendingSideEffectIndex]
      if (!next) {
        break
      }
      pendingSideEffectIndex += 1
      processed += 1
      applyPtySideEffect(next)
    }
    compactPendingSideEffectsIfNeeded(options.flushAll === true)
    if (pendingSideEffectIndex < pendingSideEffects.length) {
      // Why: thousands of queued OSC facts can pile up under timer throttling; bound each drain so paint and terminal input run between batches.
      scheduleSideEffectDrain()
    }
  }

  function flushPendingSideEffects(): void {
    clearSideEffectDrainTimer()
    drainPtySideEffects({ flushAll: true })
  }

  function processObservedTitles(
    titles: string[],
    titleScanEffect: PendingPtySideEffect['titleScanEffect'],
    suppressAgentTracker: boolean
  ): void {
    if (!onTitleChange) {
      return
    }
    // Why: process every OSC title in order, not just the last; batching coalesces titles into one payload and order preserves working→idle transitions.
    if (titles.length > 0) {
      clearStaleTitleTimer()
      for (const title of titles) {
        applyObservedTerminalTitle(title, suppressAgentTracker)
      }
    } else if (titleScanEffect === 'ignored-cursor-native') {
      clearStaleTitleTimer()
    } else if (
      titleScanEffect === 'stale-probe' &&
      !suppressAgentTracker &&
      lastEmittedTitle &&
      detectAgentStatusFromTitle(lastEmittedTitle) === 'working'
    ) {
      clearStaleTitleTimer()
      staleTitleTimer = setTimeout(() => {
        staleTitleTimer = null
        if (lastEmittedTitle && detectAgentStatusFromTitle(lastEmittedTitle) === 'working') {
          const cleared = clearWorkingIndicators(lastEmittedTitle)
          lastEmittedTitle = cleared
          onTitleChange(cleared, cleared)
          agentTracker?.handleTitle(cleared)
        }
      }, STALE_TITLE_TIMEOUT)
    }
  }

  function processData(
    data: string,
    callbacks: PtyOutputCallbacks,
    options: ProcessPtyOutputOptions = {},
    meta?: PtyDataMeta
  ): void {
    const rawLength = meta?.rawLength ?? data.length
    const suppressAttentionEvents = options.suppressAttentionEvents === true
    // Why: parse Orca's OSC 9999 before xterm; carry parser state across chunks so partial reads don't drop status or print escape garbage.
    const processed = processAgentStatusChunk(data)
    data = processed.cleanData
    // Why: during eager-buffer replay, suppress stale agent-status callbacks from a prior session (bytes still consumed so nothing leaks into xterm).
    if (options.replayingBufferedData && callbacks.onReplayData) {
      const replayMeta = {
        ...(options.clearBeforeReplay === false ? { clearBeforeReplay: false } : {}),
        ...(options.pendingEscapeTailAnsi
          ? { pendingEscapeTailAnsi: options.pendingEscapeTailAnsi }
          : {})
      }
      // Why: preserve the bare-data call shape when there's no replay metadata, so eager-buffer replay (which passes none) is unchanged.
      if (Object.keys(replayMeta).length > 0) {
        callbacks.onReplayData(data, replayMeta)
      } else {
        callbacks.onReplayData(data)
      }
    } else {
      if (meta) {
        callbacks.onData?.(data, { ...meta, rawLength })
      } else {
        callbacks.onData?.(data)
      }
    }
    schedulePtySideEffects(data, processed.payloads, suppressAttentionEvents)
  }

  function clearAccumulatedState(): void {
    clearSideEffectDrainTimer()
    pendingSideEffects.length = 0
    pendingSideEffectIndex = 0
    pendingWorkingTitleSideEffects = 0
    clearStaleTitleTimer()
    agentTracker?.reset()
    bellDetector.reset()
  }

  function pausePendingSideEffects(): void {
    clearSideEffectDrainTimer()
    clearStaleTitleTimer()
  }

  return {
    processData,
    clearAccumulatedState,
    pausePendingSideEffects,
    clearStaleTitleTimer,
    flushPendingSideEffects,
    resetBellDetector: () => bellDetector.reset(),
    resetAgentStatusCarry: () => {
      processAgentStatusChunk = createAgentStatusOscProcessor()
    }
  }
}
