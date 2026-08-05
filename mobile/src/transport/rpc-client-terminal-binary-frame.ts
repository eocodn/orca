import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamJson,
  decodeTerminalStreamText
} from './terminal-stream-protocol'

export type TerminalSnapshotState = {
  streamId: number
  meta: Record<string, unknown>
  chunks: string[]
}

type StreamingListener = (result: unknown) => void

type TerminalOutputSpanPayload = {
  data: string
  rawLength: number
  transformed: true
}

type TerminalBinaryFrameOptions = {
  terminalSnapshots: Map<number, TerminalSnapshotState>
  getListener: (streamId: number) => StreamingListener | undefined
  recordValidatedInboundTraffic: () => void
}

export function handleTerminalBinaryFrame(
  bytes: Uint8Array,
  options: TerminalBinaryFrameOptions
): void {
  const frame = decodeTerminalStreamFrame(bytes)
  if (!frame) {
    return
  }
  const listener = options.getListener(frame.streamId)
  if (!listener) {
    options.recordValidatedInboundTraffic()
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Output) {
    options.recordValidatedInboundTraffic()
    listener({
      type: 'data',
      streamId: frame.streamId,
      chunk: decodeTerminalStreamText(frame.payload)
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.OutputSpan) {
    const output = decodeTerminalStreamJson<unknown>(frame.payload)
    if (!isTerminalOutputSpanPayload(output)) {
      return
    }
    options.recordValidatedInboundTraffic()
    listener({
      type: 'data',
      streamId: frame.streamId,
      chunk: output.data,
      rawLength: output.rawLength,
      transformed: true,
      seq: frame.seq
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.SnapshotStart) {
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(frame.payload)
    if (!meta) {
      return
    }
    options.recordValidatedInboundTraffic()
    options.terminalSnapshots.set(frame.streamId, {
      streamId: frame.streamId,
      meta,
      chunks: []
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.SnapshotChunk) {
    options.recordValidatedInboundTraffic()
    const snapshot = options.terminalSnapshots.get(frame.streamId)
    if (!snapshot) {
      return
    }
    snapshot.chunks.push(decodeTerminalStreamText(frame.payload))
    return
  }
  if (frame.opcode === TerminalStreamOpcode.SnapshotEnd) {
    options.recordValidatedInboundTraffic()
    const snapshot = options.terminalSnapshots.get(frame.streamId)
    if (!snapshot) {
      return
    }
    options.terminalSnapshots.delete(frame.streamId)
    const kind = snapshot.meta.kind === 'resized' ? 'resized' : 'scrollback'
    listener({
      ...snapshot.meta,
      type: kind,
      streamId: frame.streamId,
      serialized: snapshot.chunks.join('')
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Resized) {
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(frame.payload)
    if (!meta) {
      return
    }
    options.recordValidatedInboundTraffic()
    listener({
      ...meta,
      type: 'resized',
      streamId: frame.streamId
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Metadata) {
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(frame.payload)
    if (!meta) {
      return
    }
    options.recordValidatedInboundTraffic()
    listener({
      ...meta,
      type: 'metadata',
      streamId: frame.streamId
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Error) {
    options.recordValidatedInboundTraffic()
    listener({
      type: 'error',
      streamId: frame.streamId,
      message: decodeTerminalStreamText(frame.payload)
    })
  }
}

function isTerminalOutputSpanPayload(value: unknown): value is TerminalOutputSpanPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return (
    keys.length === 3 &&
    keys[0] === 'data' &&
    keys[1] === 'rawLength' &&
    keys[2] === 'transformed' &&
    typeof record.data === 'string' &&
    typeof record.rawLength === 'number' &&
    Number.isSafeInteger(record.rawLength) &&
    record.rawLength >= 0 &&
    record.transformed === true
  )
}
