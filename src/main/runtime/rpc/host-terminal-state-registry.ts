import type {
  HostTerminalOperation,
  HostTerminalRequest,
  HostTerminalStatus
} from '../../../shared/host-protocol'

export const HOST_TERMINAL_TAIL_MAX_BYTES = 4096

export type HostTerminalSnapshot = {
  terminal_id: string
  generation: number
  status: HostTerminalStatus
  exit_code: number | null
  failure_reason: string | null
  output_sequence: number
  tail: string
}

export class HostTerminalStateError extends Error {
  readonly code:
    | 'stale_generation'
    | 'invalid_transition'
    | 'terminal_not_found'
    | 'invalid_terminal_output_sequence'
    | 'generation_overflow'
    | 'request_id_conflict'

  constructor(code: HostTerminalStateError['code']) {
    super(code)
    this.name = 'HostTerminalStateError'
    this.code = code
  }
}

type HostTerminalState = {
  terminal_id: string
  generation: number
  status: HostTerminalStatus
  exit_code: number | null
  failure_reason: string | null
  output_sequence: number
  tail: string
}

export class HostTerminalStateRegistry {
  private readonly terminals = new Map<string, HostTerminalState>()
  private readonly committedRequests = new Map<
    string,
    { request: HostTerminalRequest; snapshot: HostTerminalSnapshot }
  >()

  apply(request: HostTerminalRequest): HostTerminalSnapshot {
    const requestId = request.envelope.request_id
    const committed = this.committedRequests.get(requestId)
    if (committed) {
      if (JSON.stringify(committed.request) !== JSON.stringify(request)) {
        throw new HostTerminalStateError('request_id_conflict')
      }
      return { ...committed.snapshot }
    }
    const snapshot = this.applyUncommitted(request)
    this.committedRequests.set(requestId, {
      request: structuredClone(request),
      snapshot: { ...snapshot }
    })
    return snapshot
  }

  private applyUncommitted(request: HostTerminalRequest): HostTerminalSnapshot {
    const current = this.terminals.get(request.terminal_id)
    if (!current) {
      if (request.operation.type !== 'start') {
        throw new HostTerminalStateError('terminal_not_found')
      }
      if (request.expected_generation !== 0) {
        throw new HostTerminalStateError('stale_generation')
      }
      const started = this.createState(request.terminal_id)
      started.status = 'running'
      started.generation = 1
      this.terminals.set(request.terminal_id, started)
      return snapshotOf(started)
    }

    if (request.expected_generation !== current.generation) {
      throw new HostTerminalStateError('stale_generation')
    }

    if (request.operation.type === 'snapshot') {
      return snapshotOf(current)
    }
    if (request.operation.type === 'start') {
      throw new HostTerminalStateError('invalid_transition')
    }
    const next = { ...current }
    if (request.operation.type === 'output') {
      this.applyOutput(next, request.operation)
    } else if (request.operation.type === 'exit') {
      if (next.status !== 'running') {
        throw new HostTerminalStateError('invalid_transition')
      }
      next.status = 'exited'
      next.exit_code = request.operation.code
    } else if (request.operation.type === 'fail') {
      if (next.status !== 'running') {
        throw new HostTerminalStateError('invalid_transition')
      }
      next.status = 'failed'
      next.failure_reason = request.operation.reason
    } else if (request.operation.type === 'close') {
      if (next.status === 'closed') {
        return snapshotOf(next)
      }
      if (next.status !== 'exited' && next.status !== 'failed') {
        throw new HostTerminalStateError('invalid_transition')
      }
      next.status = 'closed'
    }

    next.generation = nextGeneration(current.generation)
    this.terminals.set(request.terminal_id, next)
    return snapshotOf(next)
  }

  snapshot(terminalId: string): HostTerminalSnapshot | undefined {
    const state = this.terminals.get(terminalId)
    return state ? snapshotOf(state) : undefined
  }

  private createState(terminalId: string): HostTerminalState {
    return {
      terminal_id: terminalId,
      generation: 0,
      status: 'created',
      exit_code: null,
      failure_reason: null,
      output_sequence: 0,
      tail: ''
    }
  }

  private applyOutput(
    state: HostTerminalState,
    operation: Extract<HostTerminalOperation, { type: 'output' }>
  ): void {
    if (state.status !== 'running') {
      throw new HostTerminalStateError('invalid_transition')
    }
    if (operation.sequence <= state.output_sequence) {
      throw new HostTerminalStateError('invalid_terminal_output_sequence')
    }
    state.output_sequence = operation.sequence
    state.tail = trimUtf8Tail(`${state.tail}${operation.data}`)
  }
}

function nextGeneration(generation: number): number {
  if (generation >= Number.MAX_SAFE_INTEGER) {
    throw new HostTerminalStateError('generation_overflow')
  }
  return generation + 1
}

function trimUtf8Tail(value: string): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength <= HOST_TERMINAL_TAIL_MAX_BYTES) {
    return value
  }
  let start = bytes.byteLength - HOST_TERMINAL_TAIL_MAX_BYTES
  while (start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) {
    start += 1
  }
  return bytes.subarray(start).toString('utf8')
}

function snapshotOf(state: HostTerminalState): HostTerminalSnapshot {
  return { ...state }
}
