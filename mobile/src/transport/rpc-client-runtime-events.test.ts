import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect, type RpcClient } from './rpc-client'

vi.mock('./e2ee', () => ({
  generateKeyPair: () => ({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(32)
  }),
  deriveSharedKey: () => new Uint8Array(32),
  publicKeyFromBase64: () => new Uint8Array(32),
  publicKeyToBase64: () => 'client-public-key',
  encrypt: (plaintext: string) => `encrypted:${plaintext}`,
  decrypt: (raw: string) => raw.replace(/^encrypted:/, ''),
  decryptBytes: (bytes: Uint8Array) => bytes
}))

class RuntimeEventTestSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readonly CONNECTING = RuntimeEventTestSocket.CONNECTING
  readonly OPEN = RuntimeEventTestSocket.OPEN
  readonly CLOSING = RuntimeEventTestSocket.CLOSING
  readonly CLOSED = RuntimeEventTestSocket.CLOSED

  readyState = RuntimeEventTestSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(readonly endpoint: string) {
    sockets.push(this)
  }

  send(payload: string): void {
    this.sent.push(payload)
  }

  close(): void {
    this.readyState = RuntimeEventTestSocket.CLOSED
    this.onclose?.()
  }

  open(): void {
    this.readyState = RuntimeEventTestSocket.OPEN
    this.onopen?.()
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: payload })
  }
}

type SentRequest = { id: string; method: string; params?: unknown }

const sockets: RuntimeEventTestSocket[] = []
const originalWebSocket = globalThis.WebSocket

function sentRequests(socket: RuntimeEventTestSocket, method: string): SentRequest[] {
  return socket.sent
    .map((payload) => JSON.parse(payload.replace(/^encrypted:/, '')) as SentRequest)
    .filter((request) => request.method === method)
}

function unauthorizedResponsePayload(id: string): string {
  return `encrypted:${JSON.stringify({
    id,
    ok: false,
    error: { code: 'unauthorized', message: 'Unauthorized' }
  })}`
}

function connectReadyClient(): { client: RpcClient; socket: RuntimeEventTestSocket } {
  const client = connect('ws://desktop.invalid', 'token', 'server-key')
  const socket = sockets[0]!
  socket.open()
  socket.receive(JSON.stringify({ type: 'e2ee_ready' }))
  socket.receive('encrypted:{"type":"e2ee_authenticated"}')
  return { client, socket }
}

function emitReady(
  socket: RuntimeEventTestSocket,
  requestId: string,
  subscriptionId: string
): void {
  socket.receive(
    `encrypted:${JSON.stringify({
      id: requestId,
      ok: true,
      streaming: true,
      result: { type: 'ready', subscriptionId },
      _meta: { runtimeId: 'r1' }
    })}`
  )
}

describe('runtime client-event stream disposal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sockets.length = 0
    globalThis.WebSocket = RuntimeEventTestSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    vi.useRealTimers()
  })

  it('unsubscribes a stream disposed after ready', () => {
    const { client, socket } = connectReadyClient()
    const unsubscribe = client.subscribe('runtime.clientEvents.subscribe', null, () => {})
    const request = sentRequests(socket, 'runtime.clientEvents.subscribe')[0]!
    emitReady(socket, request.id, 'runtime-events:test')

    unsubscribe()

    expect(sentRequests(socket, 'runtime.clientEvents.unsubscribe')).toEqual([
      expect.objectContaining({ params: { subscriptionId: 'runtime-events:test' } })
    ])
    client.close()
  })

  it('keeps a tombstone and unsubscribes a stream disposed before ready', () => {
    const { client, socket } = connectReadyClient()
    const listener = vi.fn()
    const unsubscribe = client.subscribe('runtime.clientEvents.subscribe', null, listener)
    const request = sentRequests(socket, 'runtime.clientEvents.subscribe')[0]!

    unsubscribe()
    emitReady(socket, request.id, 'runtime-events:late')

    expect(listener).not.toHaveBeenCalled()
    expect(sentRequests(socket, 'runtime.clientEvents.unsubscribe')).toEqual([
      expect.objectContaining({ params: { subscriptionId: 'runtime-events:late' } })
    ])
    client.close()
  })

  it('uses the replayed subscription identity when disposed during auth recovery', async () => {
    const { client, socket } = connectReadyClient()
    const unsubscribe = client.subscribe('runtime.clientEvents.subscribe', null, () => {})
    const initialRequest = sentRequests(socket, 'runtime.clientEvents.subscribe')[0]!
    emitReady(socket, initialRequest.id, 'runtime-events:old')
    await vi.waitFor(() => expect(sentRequests(socket, 'runtime.clientEvents.subscribe')).toHaveLength(1))

    const statusRequest = client.sendRequest('status.get').catch(() => undefined)
    await vi.waitFor(() => expect(sentRequests(socket, 'status.get')).toHaveLength(1))
    socket.receive(unauthorizedResponsePayload(sentRequests(socket, 'status.get')[0]!.id))
    await statusRequest
    await vi.waitFor(() => expect(client.getState()).toBe('reconnecting'))

    await vi.advanceTimersByTimeAsync(500)
    const replacement = sockets.at(-1)!
    replacement.open()
    replacement.receive(JSON.stringify({ type: 'e2ee_ready' }))
    replacement.receive('encrypted:{"type":"e2ee_authenticated"}')
    const replayRequest = await vi.waitFor(() => {
      const request = sentRequests(replacement, 'runtime.clientEvents.subscribe')[0]
      expect(request).toBeDefined()
      return request!
    })

    unsubscribe()
    expect(sentRequests(replacement, 'runtime.clientEvents.unsubscribe')).toHaveLength(0)

    emitReady(replacement, replayRequest.id, 'runtime-events:new')
    await vi.waitFor(() =>
      expect(sentRequests(replacement, 'runtime.clientEvents.unsubscribe')).toEqual([
        expect.objectContaining({ params: { subscriptionId: 'runtime-events:new' } })
      ])
    )
    client.close()
  })
})
