import type { RuntimeTerminalWaitBlockedReason } from '../../shared/runtime-types'
import {
  findActionableTerminalWaitBlockedSignal,
  mayContainTerminalWaitBlockedSignal
} from './terminal-wait-detection'

export const MAX_TAIL_LINES = 2000
export const MAX_TAIL_CHARS = 256 * 1024
export const MAX_TAIL_PARTIAL_CHARS = 4000

const MAX_PREVIEW_LINES = 6
const MAX_PREVIEW_CHARS = 300

export function buildPreview(lines: string[], partialLine: string): string {
  const previewLines: string[] = []
  const collectVisibleLine = (line: string): void => {
    const trimmed = line.trim()
    if (trimmed.length > 0) {
      previewLines.push(trimmed)
    }
  }

  if (partialLine.length > 0) {
    collectVisibleLine(partialLine)
  }
  for (
    let index = lines.length - 1;
    index >= 0 && previewLines.length < MAX_PREVIEW_LINES;
    index--
  ) {
    collectVisibleLine(lines[index])
  }
  previewLines.reverse()

  const preview = previewLines.join('\n')
  return preview.length > MAX_PREVIEW_CHARS
    ? preview.slice(preview.length - MAX_PREVIEW_CHARS)
    : preview
}

export function buildTailLines(lines: string[], partialLine: string): string[] {
  return partialLine.length > 0 ? [...lines, partialLine] : lines
}

export function buildTerminalWaitText(
  lines: string[],
  partialLine: string,
  preview: string
): string {
  const waitText = buildTailLines(lines, partialLine)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  // Keep the retained tail available so a ready header cannot be truncated from the short preview.
  return waitText.length > 0 ? waitText : preview
}

export type TerminalTailWaitState = {
  waitText: string
  signal: { reason: RuntimeTerminalWaitBlockedReason; index: number } | null
  // A preview-derived state is recalculated on each append and is not reusable as a prior tail state.
  fromTail: boolean
}

// Candidate-bearing tails are the only ones that rebuild the retained 256 KiB text.
export function computeTerminalTailWaitState(
  lines: string[],
  partialLine: string,
  preview: string
): TerminalTailWaitState {
  const tailShape = inspectTerminalWaitTail(lines, partialLine)
  if (!tailShape.fromTail) {
    return {
      waitText: preview,
      signal: findActionableTerminalWaitBlockedSignal(preview.toLowerCase()),
      fromTail: false
    }
  }
  if (!tailShape.mayContainBlockedSignal) {
    // Avoid retaining a rebuilt 256 KiB string when no prompt candidate exists.
    return { waitText: '', signal: null, fromTail: true }
  }
  const tailText = buildTailLines(lines, partialLine)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  const fromTail = tailText.length > 0
  const waitText = fromTail ? tailText : preview
  return {
    waitText,
    signal: findActionableTerminalWaitBlockedSignal(waitText.toLowerCase()),
    fromTail
  }
}

function inspectTerminalWaitTail(
  lines: string[],
  partialLine: string
): { fromTail: boolean; mayContainBlockedSignal: boolean } {
  let fromTail = false
  let mayContainBlockedSignal = false
  for (const line of lines) {
    if (!fromTail && line.trim().length > 0) {
      fromTail = true
    }
    if (!mayContainBlockedSignal && mayContainTerminalWaitBlockedSignal(line)) {
      mayContainBlockedSignal = true
    }
  }
  if (!fromTail && partialLine.trim().length > 0) {
    fromTail = true
  }
  if (!mayContainBlockedSignal && mayContainTerminalWaitBlockedSignal(partialLine)) {
    mayContainBlockedSignal = true
  }
  return { fromTail, mayContainBlockedSignal }
}

// Compare memoized states while allowing prompts split across PTY chunks.
export function tailGainedNewerBlockedReason(
  previous: TerminalTailWaitState,
  next: TerminalTailWaitState,
  appendedText: string
): boolean {
  if (next.signal === null) {
    return false
  }
  if (previous.signal === null) {
    return true
  }
  const appendCandidateSignal = findActionableTerminalWaitBlockedSignal(
    `${previous.waitText}${appendedText}`.toLowerCase()
  )
  return appendCandidateSignal !== null && appendCandidateSignal.index > previous.signal.index
}
