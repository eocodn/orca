import { containsTerminalVerticalLineControl } from './terminal-tail-ansi'
import { MAX_TAIL_CHARS, MAX_TAIL_LINES, MAX_TAIL_PARTIAL_CHARS } from './terminal-tail-wait-state'
import {
  applyTerminalLineControls,
  processTerminalTailCompleteSegments,
  splitRetainedTerminalTailSegments,
  trimTerminalLineRight
} from './terminal-tail-line-operations'
import { appendNormalizedToMultilineTailBufferUnwindowed } from './terminal-tail-redraw-engine'
import type { RetainedTailRedrawCursor } from './terminal-tail-types'

export function appendNormalizedToTailBuffer(
  previousLines: string[],
  previousPartialLine: string,
  normalizedChunk: string,
  previousRedrawCursor: RetainedTailRedrawCursor | null = null
): {
  lines: string[]
  partialLine: string
  redrawCursor: RetainedTailRedrawCursor | null
  truncated: boolean
  newCompleteLines: number
  newlyCompletedLines: string[]
} {
  if (normalizedChunk.length === 0) {
    return {
      lines: previousLines,
      partialLine: previousPartialLine,
      redrawCursor: previousRedrawCursor,
      truncated: false,
      newCompleteLines: 0,
      newlyCompletedLines: []
    }
  }

  // Why: fullscreen TUIs emit long newline-free redraw streams; keep the line transcript for pagination but bound partial-line work.
  const previousPartialWasCapped = previousPartialLine.length > MAX_TAIL_PARTIAL_CHARS
  const boundedPreviousPartialLine = previousPartialLine.slice(-MAX_TAIL_PARTIAL_CHARS)
  const combinedChunk = `${boundedPreviousPartialLine}${normalizedChunk}`
  if (previousRedrawCursor || containsTerminalVerticalLineControl(combinedChunk)) {
    return appendNormalizedToMultilineTailBuffer(
      previousLines,
      boundedPreviousPartialLine,
      normalizedChunk,
      previousPartialWasCapped,
      previousRedrawCursor
    )
  }

  // Why: status UIs redraw one line via CR/backspace/erase; retain the latest redraw segment instead of appending every spinner frame.
  const segments = splitRetainedTerminalTailSegments(combinedChunk)
  const pieces = processTerminalTailCompleteSegments(segments.completeSegments)
  const newlyCompletedLines = pieces.map((line) => trimTerminalLineRight(line))
  const partialResult = applyTerminalLineControls(segments.partialSegment)
  const nextPartialLine = trimTerminalLineRight(partialResult.text)
  const retainedPartialLine = nextPartialLine.slice(-MAX_TAIL_PARTIAL_CHARS)
  const newCompleteLines = segments.completeLineCount
  const omittedNewCompleteLines = newCompleteLines - pieces.length
  let nextLines =
    newCompleteLines > 0
      ? [...(omittedNewCompleteLines > 0 ? [] : previousLines), ...newlyCompletedLines]
      : previousLines
  let truncated =
    previousPartialWasCapped ||
    omittedNewCompleteLines > 0 ||
    nextPartialLine.length > MAX_TAIL_PARTIAL_CHARS

  if (nextLines.length > MAX_TAIL_LINES) {
    nextLines = nextLines.slice(nextLines.length - MAX_TAIL_LINES)
    truncated = true
  }

  if (newCompleteLines > 0 || retainedPartialLine.length > previousPartialLine.length) {
    if (nextLines === previousLines) {
      nextLines = [...previousLines]
    }
    let totalChars =
      nextLines.reduce((sum, line) => sum + line.length, 0) + retainedPartialLine.length
    let trimStartIndex = 0
    while (trimStartIndex < nextLines.length && totalChars > MAX_TAIL_CHARS) {
      totalChars -= nextLines[trimStartIndex].length
      trimStartIndex += 1
    }
    if (trimStartIndex > 0) {
      nextLines = nextLines.slice(trimStartIndex)
      truncated = true
    }
  }

  const redrawCursor =
    !partialResult.hadControl || partialResult.cursorColumn === nextPartialLine.length
      ? null
      : {
          rowFromEnd: 0,
          column: partialResult.cursorColumn
        }

  return {
    lines: nextLines,
    partialLine: retainedPartialLine,
    redrawCursor,
    truncated,
    newCompleteLines,
    newlyCompletedLines
  }
}

const REDRAW_WINDOW_SAFETY_ROWS = 8

export function maxUpwardCursorReach(
  normalizedChunk: string,
  previousRedrawCursor: RetainedTailRedrawCursor | null
): number {
  let reach = previousRedrawCursor ? previousRedrawCursor.rowFromEnd : 0
  const cursorUpPattern = new RegExp(`${String.fromCharCode(0x1b)}\\[(\\d*)(?:;[\\d;]*)?A`, 'g')
  let match: RegExpExecArray | null
  while ((match = cursorUpPattern.exec(normalizedChunk)) !== null) {
    reach += match[1] ? Number.parseInt(match[1], 10) : 1
  }
  return reach
}

export function appendNormalizedToMultilineTailBuffer(
  previousLines: string[],
  boundedPreviousPartialLine: string,
  normalizedChunk: string,
  previousPartialWasCapped: boolean,
  previousRedrawCursor: RetainedTailRedrawCursor | null
): {
  lines: string[]
  partialLine: string
  redrawCursor: RetainedTailRedrawCursor | null
  truncated: boolean
  newCompleteLines: number
  newlyCompletedLines: string[]
} {
  const windowRows =
    maxUpwardCursorReach(normalizedChunk, previousRedrawCursor) + REDRAW_WINDOW_SAFETY_ROWS
  if (windowRows >= previousLines.length) {
    return appendNormalizedToMultilineTailBufferUnwindowed(
      previousLines,
      boundedPreviousPartialLine,
      normalizedChunk,
      previousPartialWasCapped,
      previousRedrawCursor
    )
  }
  const prefixLength = previousLines.length - windowRows
  const suffix = previousLines.slice(prefixLength)
  const windowed = appendNormalizedToMultilineTailBufferUnwindowed(
    suffix,
    boundedPreviousPartialLine,
    normalizedChunk,
    previousPartialWasCapped,
    previousRedrawCursor
  )
  let lines = previousLines.slice(0, prefixLength)
  // Why: the shared prefix must match the unwindowed finalize's trailing-space trim without paying a regex per untouched row.
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const lastChar = line.charCodeAt(line.length - 1)
    if (lastChar === 32 || lastChar === 9) {
      lines[index] = line.replace(/[ \t]+$/g, '')
    }
  }
  for (const line of windowed.lines) {
    lines.push(line)
  }
  let truncated = windowed.truncated
  if (lines.length > MAX_TAIL_LINES) {
    lines = lines.slice(lines.length - MAX_TAIL_LINES)
    truncated = true
  }
  let totalChars = windowed.partialLine.length
  for (const line of lines) {
    totalChars += line.length
  }
  let dropCount = 0
  while (dropCount < lines.length && totalChars > MAX_TAIL_CHARS) {
    totalChars -= lines[dropCount]!.length
    dropCount += 1
  }
  if (dropCount > 0) {
    lines = lines.slice(dropCount)
    truncated = true
  }
  return {
    lines,
    partialLine: windowed.partialLine,
    redrawCursor: windowed.redrawCursor,
    truncated,
    newCompleteLines: windowed.newCompleteLines,
    newlyCompletedLines: windowed.newlyCompletedLines
  }
}
