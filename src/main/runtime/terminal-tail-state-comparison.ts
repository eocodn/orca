import type { RetainedTailRedrawCursor } from './terminal-tail-types'
import { MAX_TAIL_CHARS, MAX_TAIL_LINES } from './terminal-tail-wait-state'

export function appendCompletedTerminalTranscript(
  previousLines: string[],
  previousCharacters: number,
  newlyCompletedLines: string[],
  newCompleteLineCount: number
): { lines: string[]; characters: number; truncated: boolean } {
  if (newCompleteLineCount === 0) {
    return { lines: previousLines, characters: previousCharacters, truncated: false }
  }

  const omittedNewLineCount = Math.max(0, newCompleteLineCount - newlyCompletedLines.length)
  const lines = omittedNewLineCount > 0 ? [] : [...previousLines]
  let characters = omittedNewLineCount > 0 ? 0 : previousCharacters
  for (const line of newlyCompletedLines) {
    lines.push(line)
    characters += line.length
  }

  let dropCount = Math.max(0, lines.length - MAX_TAIL_LINES)
  for (let index = 0; index < dropCount; index += 1) {
    characters -= lines[index]!.length
  }
  while (dropCount < lines.length && characters > MAX_TAIL_CHARS) {
    characters -= lines[dropCount]!.length
    dropCount += 1
  }

  return {
    lines: dropCount > 0 ? lines.slice(dropCount) : lines,
    characters,
    truncated: omittedNewLineCount > 0 || dropCount > 0
  }
}

export function tailStateMatches(
  lines: string[],
  transcriptLines: string[],
  partialLine: string,
  pendingAnsi: string,
  redrawCursor: RetainedTailRedrawCursor | null,
  truncated: boolean,
  linesTotal: number,
  snapshot: {
    lines: string[]
    transcriptLines: string[]
    partialLine: string
    pendingAnsi: string
    redrawCursor: RetainedTailRedrawCursor | null
    truncated: boolean
    linesTotal: number
  }
): boolean {
  if (
    partialLine !== snapshot.partialLine ||
    pendingAnsi !== snapshot.pendingAnsi ||
    !tailRedrawCursorsMatch(redrawCursor, snapshot.redrawCursor) ||
    truncated !== snapshot.truncated ||
    linesTotal !== snapshot.linesTotal ||
    lines.length !== snapshot.lines.length ||
    transcriptLines.length !== snapshot.transcriptLines.length
  ) {
    return false
  }
  if (lines === snapshot.lines) {
    return true
  }
  for (let index = 0; index < lines.length; index++) {
    if (lines[index] !== snapshot.lines[index]) {
      return false
    }
  }
  if (transcriptLines !== snapshot.transcriptLines) {
    for (let index = 0; index < transcriptLines.length; index++) {
      if (transcriptLines[index] !== snapshot.transcriptLines[index]) {
        return false
      }
    }
  }
  return true
}

export function tailRedrawCursorsMatch(
  left: RetainedTailRedrawCursor | null,
  right: RetainedTailRedrawCursor | null
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.rowFromEnd === right.rowFromEnd && left.column === right.column
}
