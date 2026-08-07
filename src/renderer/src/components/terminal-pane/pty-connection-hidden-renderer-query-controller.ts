import { parseTerminalOscColorQuery } from '../../../../shared/terminal-osc-color-reply'
import {
  HIDDEN_STARTUP_RENDERER_QUERY_PENDING_CHARS,
  containsStatefulRendererQuery,
  extractHiddenStartupRendererQueryData,
  findCsiFinalByteIndex,
  isStatefulRendererReplyCsiQuery,
  isStatelessRendererReplyCsiQuery
} from '../../../../shared/terminal-reply-query-extraction'
import type { PtyDataMeta } from './pty-dispatcher'
import { DEFAULT_DA1_RESPONSE } from './terminal-capability-replies'
import { createPtyConnectionHiddenRendererQueryStateController } from './pty-connection-hidden-renderer-query-state-controller'

type HiddenRendererQueryControllerOptions = {
  sendImmediateReply: (data: string) => unknown
  replyOscColorQueries: (data: string) => void
  writeRendererQuery: (data: string, foreground: boolean) => void
  getCursor: () => { cursorX: number; cursorY: number; cols: number; rows: number }
}

type PendingForegroundQuery = {
  statefulQueryData: string
  remainingData: string
  meta: PtyDataMeta | undefined
}

function splitCsiSequences(queryData: string): string[] {
  const sequences: string[] = []
  let offset = queryData.indexOf('\x1b[')
  while (offset !== -1) {
    const finalByteIndex = findCsiFinalByteIndex(queryData, offset + 2)
    if (finalByteIndex === -1) {
      break
    }
    sequences.push(queryData.slice(offset, finalByteIndex + 1))
    offset = queryData.indexOf('\x1b[', finalByteIndex + 1)
  }
  return sequences
}

function adjustMetaAfterConsumingCurrentChars(
  meta: PtyDataMeta | undefined,
  consumedCurrentChars: number
): PtyDataMeta | undefined {
  if (consumedCurrentChars === 0 || typeof meta?.rawLength !== 'number') {
    return meta
  }
  return {
    ...meta,
    rawLength: Math.max(0, meta.rawLength - consumedCurrentChars)
  }
}

export function createPtyConnectionHiddenRendererQueryController(
  options: HiddenRendererQueryControllerOptions
) {
  const state = createPtyConnectionHiddenRendererQueryStateController()

  function observeHidden(data: string): void {
    const extracted = extractHiddenStartupRendererQueryData(data, state.getPending())
    state.setPending(extracted.pending)
    if (extracted.oscColorQueryData) {
      options.replyOscColorQueries(extracted.oscColorQueryData)
    }
    if (extracted.statelessQueryData) {
      options.writeRendererQuery(extracted.statelessQueryData, false)
    }
    state.markDirty()
  }

  function takePendingForForeground(data: string, meta?: PtyDataMeta): PendingForegroundQuery {
    const pending = state.takePending()
    if (!pending) {
      return { statefulQueryData: '', remainingData: data, meta }
    }

    const input = pending + data
    let statelessQueryData = ''
    let statefulQueryData = ''
    let oscColorQueryData = ''
    let consumedInputChars = pending.length
    let nextPending = ''
    if (input.startsWith('\x1b[')) {
      const finalByteIndex = findCsiFinalByteIndex(input, 2)
      if (finalByteIndex === -1) {
        nextPending = input.slice(0, HIDDEN_STARTUP_RENDERER_QUERY_PENDING_CHARS)
        consumedInputChars = input.length
      } else {
        const sequence = input.slice(0, finalByteIndex + 1)
        if (isStatelessRendererReplyCsiQuery(sequence)) {
          statelessQueryData = sequence
        } else if (isStatefulRendererReplyCsiQuery(sequence)) {
          statefulQueryData = sequence
        }
        consumedInputChars = finalByteIndex + 1
      }
    } else if (input.startsWith('\x1b]')) {
      const query = parseTerminalOscColorQuery(input, 0)
      if (query.kind === 'partial') {
        nextPending = input.slice(0, HIDDEN_STARTUP_RENDERER_QUERY_PENDING_CHARS)
        consumedInputChars = input.length
      } else if (query.kind === 'match') {
        oscColorQueryData = input.slice(0, query.endIndex)
        consumedInputChars = query.endIndex
      }
    } else if (input.length === 1) {
      nextPending = input
      consumedInputChars = input.length
    }

    state.setPending(nextPending)
    const consumedCurrentChars = Math.max(0, consumedInputChars - pending.length)
    if (statelessQueryData) {
      options.writeRendererQuery(statelessQueryData, true)
    }
    if (oscColorQueryData) {
      options.replyOscColorQueries(oscColorQueryData)
    }
    return {
      statefulQueryData,
      remainingData: data.slice(consumedCurrentChars),
      meta: adjustMetaAfterConsumingCurrentChars(meta, consumedCurrentChars)
    }
  }

  function salvageDiscarded(data: string): void {
    if (!data || !data.includes('\x1b')) {
      return
    }
    const extracted = extractHiddenStartupRendererQueryData(data, '')
    if (extracted.oscColorQueryData) {
      options.replyOscColorQueries(extracted.oscColorQueryData)
    }
    let unansweredQueryData = ''
    for (const sequence of splitCsiSequences(
      extracted.statefulQueryData + extracted.statelessQueryData
    )) {
      if (sequence === '\x1b[6n') {
        const cursor = options.getCursor()
        const row = Math.min(cursor.cursorY + 1, cursor.rows)
        const col = Math.min(cursor.cursorX + 1, cursor.cols)
        options.sendImmediateReply(`\x1b[${row};${col}R`)
      } else if (sequence === '\x1b[c' || sequence === '\x1b[0c') {
        options.sendImmediateReply(DEFAULT_DA1_RESPONSE)
      } else {
        unansweredQueryData += sequence
      }
    }
    if (unansweredQueryData) {
      options.writeRendererQuery(unansweredQueryData, true)
    }
  }

  return {
    shouldSkip(data: string): boolean {
      return state.isDirty() || !containsStatefulRendererQuery(data)
    },
    observeHidden,
    takePendingForForeground,
    salvageDiscarded,
    markDirty: state.markDirty,
    markClean: state.markClean,
    reset: state.reset
  }
}
