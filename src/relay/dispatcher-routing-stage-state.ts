import {
  FrameDecoder,
  MessageType,
  encodeJsonRpcFrame,
  encodeKeepAliveFrame,
  parseJsonRpcMessage,
  KEEPALIVE_SEND_MS,
  type DecodedFrame,
  type JsonRpcRequest,
  type JsonRpcNotification,
  type JsonRpcResponse
} from './protocol'
import { ClientRequestAborts } from './client-request-aborts'
import { MAX_TIMER_DELAY_MS, isSafeTimerDelayMs } from '../shared/timer-delay'
import {
  DISPATCHER_CONTROL_QUEUE_MAX_BYTES,
  DEFAULT_PRODUCER_QUEUE_MAX_BYTES,
  DispatcherClientWriter,
  type DispatcherWriterLane,
  type RelayClientSinkOptions,
  type RelayClientWrite,
  type SinkWriteSettlement
} from './dispatcher-client-writer'
import {
  LegacyRelayPublicationLedger,
  type LegacyPublicationLease
} from './legacy-relay-publication-ledger'

export type {
  RelayClientSinkOptions,
  RelayClientWrite,
  SinkWriteSettlement
} from './dispatcher-client-writer'

export type RequestContext = {
  clientId: number
  isStale: () => boolean
  signal?: AbortSignal
  sessionIdentity?: RelayClientSessionIdentity
  onResponseSettled?: (handler: (result: SinkWriteSettlement) => void) => void
}

export type RelayClientSessionIdentity = {
  principal: string
  authenticated: boolean
  allowSessionOwner: boolean
  authenticationKind: 'unproved' | 'launch-nonce' | 'endpoint-credential'
}

export type RelayClientSourceOptions = {
  pauseReads?: () => void
  resumeReads?: () => void
}

export type MethodHandler = (
  params: Record<string, unknown>,
  context: RequestContext
) => Promise<unknown>

export type NotificationHandler = (params: Record<string, unknown>, context: RequestContext) => void

type RelayClient = {
  id: number
  decoder: FrameDecoder
  writer: DispatcherClientWriter
  bulkChain: Promise<void>
  nextOutgoingSeq: number
  highestReceivedSeq: number
  generation: number
  closed: boolean
  sessionIdentity: RelayClientSessionIdentity
}

type PendingRelayRequest = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const RELAY_TO_CLIENT_REQUEST_TIMEOUT_MS = 30_000

export class RelayDispatcher {
  protected readonly primaryClient: RelayClient
  protected readonly clients = new Map<number, RelayClient>()
  protected requestHandlers = new Map<string, MethodHandler>()
  protected notificationHandlers = new Map<string, NotificationHandler>()
  protected readonly requestAborts = new ClientRequestAborts()
  protected readonly publicationLedger = new LegacyRelayPublicationLedger()
  protected pendingRelayRequests = new Map<number, PendingRelayRequest>()
  protected clientDetachListeners = new Set<(clientId: number) => void>()
  protected disposeListeners = new Set<() => void>()
  protected legacyCapacityListeners = new Set<() => void>()
  protected publicationTransactionDepth = 0
  protected deferredLegacyCapacity = false
  protected deferredForcedLegacyCapacity = false
  protected keepaliveTimer: ReturnType<typeof setInterval> | null = null
  protected disposed = false
  protected nextClientId = 1
  protected nextRequestId = 1

  constructor(
    write: RelayClientWrite,
    sinkOptions?: RelayClientSinkOptions,
    sessionIdentity?: RelayClientSessionIdentity,
    sourceOptions?: RelayClientSourceOptions
  ) {
    this.primaryClient = this.createClient(write, sinkOptions, sessionIdentity, sourceOptions)
    this.clients.set(this.primaryClient.id, this.primaryClient)
    this.startKeepalive()
  }

  // Why: redirect outgoing frames to the reconnected socket without rebuilding the dispatcher + handler tree.
  // Why: the new client's multiplexer restarts at seq=1, so reset seq/decoder state or acks stall and fire a false connection-dead signal.
}
