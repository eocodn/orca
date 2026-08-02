const CURSOR_SHOW_SEQUENCE = '\x1b[?25h'
const CURSOR_HIDE_SEQUENCE = '\x1b[?25l'
const SYNCHRONIZED_OUTPUT_END_SEQUENCE = '\x1b[?2026l'

export function findCursorPositionSequenceEnd(
  data: string,
  fromIndex: number,
  toIndex = data.length
): number {
  let offset = data.indexOf('\x1b[', fromIndex)
  while (offset !== -1 && offset < toIndex) {
    let index = offset + 2
    while (index < toIndex) {
      const char = data[index]
      if (char === 'G' || char === 'H' || char === 'f') {
        return index + 1
      }
      if ((char < '0' || char > '9') && char !== ';') {
        break
      }
      index += 1
    }
    offset = data.indexOf('\x1b[', offset + 2)
  }
  return -1
}

export function removeTransientCursorShowSequences(data: string): string {
  let result = ''
  let offset = 0
  let showIndex = data.indexOf(CURSOR_SHOW_SEQUENCE)
  while (showIndex !== -1) {
    const nextHideIndex = data.indexOf(
      CURSOR_HIDE_SEQUENCE,
      showIndex + CURSOR_SHOW_SEQUENCE.length
    )
    const nextPositionEnd = findCursorPositionSequenceEnd(
      data,
      showIndex + CURSOR_SHOW_SEQUENCE.length,
      nextHideIndex === -1 ? data.length : nextHideIndex
    )
    if (nextHideIndex === -1) {
      if (nextPositionEnd === -1) {
        const synchronizedEndIndex = data.indexOf(
          SYNCHRONIZED_OUTPUT_END_SEQUENCE,
          showIndex + CURSOR_SHOW_SEQUENCE.length
        )
        if (synchronizedEndIndex === -1) {
          break
        }
        // Keep the cursor hidden through the synchronized repaint, then restore it.
        result += data.slice(offset, showIndex)
        result += data.slice(
          showIndex + CURSOR_SHOW_SEQUENCE.length,
          synchronizedEndIndex + SYNCHRONIZED_OUTPUT_END_SEQUENCE.length
        )
        result += CURSOR_SHOW_SEQUENCE
        offset = synchronizedEndIndex + SYNCHRONIZED_OUTPUT_END_SEQUENCE.length
        showIndex = data.indexOf(CURSOR_SHOW_SEQUENCE, offset)
        continue
      }
      // Place the cursor after its final position so xterm cannot rasterize stale state.
      result += data.slice(offset, showIndex)
      result += data.slice(showIndex + CURSOR_SHOW_SEQUENCE.length, nextPositionEnd)
      result += CURSOR_SHOW_SEQUENCE
      offset = nextPositionEnd
      showIndex = data.indexOf(CURSOR_SHOW_SEQUENCE, offset)
      continue
    }
    result += data.slice(offset, showIndex)
    offset = showIndex + CURSOR_SHOW_SEQUENCE.length
    showIndex = data.indexOf(CURSOR_SHOW_SEQUENCE, offset)
  }
  return offset === 0 ? data : result + data.slice(offset)
}

export function containsCursorPositionSequence(data: string): boolean {
  let offset = data.indexOf('\x1b[')
  while (offset !== -1) {
    let index = offset + 2
    while (index < data.length) {
      const char = data[index]
      if (char === 'G' || char === 'H' || char === 'f') {
        return true
      }
      if ((char < '0' || char > '9') && char !== ';') {
        break
      }
      index += 1
    }
    offset = data.indexOf('\x1b[', offset + 2)
  }
  return false
}

export function containsCursorRestore(data: string): boolean {
  const hideIndex = data.indexOf(CURSOR_HIDE_SEQUENCE)
  const showIndex = data.lastIndexOf(CURSOR_SHOW_SEQUENCE)
  return hideIndex !== -1 && showIndex > hideIndex && containsCursorPositionSequence(data)
}

export function containsDrainableCursorRestore(data: string): boolean {
  const synchronizedEndIndex = data.lastIndexOf(SYNCHRONIZED_OUTPUT_END_SEQUENCE)
  if (synchronizedEndIndex === -1) {
    return containsCursorRestore(data)
  }
  return containsCursorRestore(
    data.slice(synchronizedEndIndex + SYNCHRONIZED_OUTPUT_END_SEQUENCE.length)
  )
}

export function containsFinalCursorPlacementBeforeSynchronizedEnd(data: string): boolean {
  const synchronizedEndIndex = data.lastIndexOf(SYNCHRONIZED_OUTPUT_END_SEQUENCE)
  if (synchronizedEndIndex === -1) {
    return false
  }
  const lastShowIndex = data.lastIndexOf(CURSOR_SHOW_SEQUENCE, synchronizedEndIndex)
  if (lastShowIndex === -1) {
    return false
  }
  const lastHideIndex = data.lastIndexOf(CURSOR_HIDE_SEQUENCE, synchronizedEndIndex)
  if (lastHideIndex > lastShowIndex) {
    return false
  }
  return (
    findCursorPositionSequenceEnd(
      data,
      lastShowIndex + CURSOR_SHOW_SEQUENCE.length,
      synchronizedEndIndex
    ) !== -1
  )
}
