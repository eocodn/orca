import {
  FrameDecoder
} from './relay-protocol'
import type { PendingRequest } from './ssh-channel-multiplexer-foundation'
import { SshChannelMultiplexerFrameMethods,type SshChannelMultiplexerFrameMethodsSurface } from './ssh-channel-multiplexer-frame-methods'
import { SshChannelMultiplexerHealthMethods,type SshChannelMultiplexerHealthMethodsSurface } from './ssh-channel-multiplexer-health-methods'
import { SshChannelMultiplexerRequestMethods,type SshChannelMultiplexerRequestMethodsSurface } from './ssh-channel-multiplexer-request-methods'
import {
  SshMultiplexerTransportWriter,
  type MultiplexerTransport,
  type MultiplexerWriteSettlement
} from './ssh-multiplexer-transport-writer'

export type { MultiplexerTransport,MultiplexerWriteSettlement }

export type SshMultiplexerRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  beforeResolve?: (result: unknown) => void
}

export type NotificationHandler = (method: string, params: Record<string, unknown>) => void
export type MethodNotificationHandler = (params: Record<string, unknown>) => void
export type RequestHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown

export class SshChannelMultiplexer {
  private decoder: FrameDecoder
  private transport: MultiplexerTransport
  private writer: SshMultiplexerTransportWriter
  private nextRequestId = 1
  private nextOutgoingSeq = 1
  private highestReceivedSeq = 0
  private highestAckedBySelf = 0
  private lastReceivedAt = Date.now()
  private pendingRequests = new Map<number, PendingRequest>()
  private notificationHandlers: NotificationHandler[] = []
  private requestHandlers = new Map<string, RequestHandler>()
  // Why: per-method dispatch map keeps streaming consumers (fs.streamChunk,
  // fs.streamEnd, fs.streamError) from accreting string-match logic in the
  // generic notification listener that already serves fs.changed.
  private methodNotificationHandlers = new Map<string, Set<MethodNotificationHandler>>()
  private disposeHandlers: ((reason: 'shutdown' | 'connection_lost') => void)[] = []
  private connectionHealthTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false
  private decoderReadPaused = false
  private writerSaturated = false

  // Track the oldest unacked outgoing message timestamp
  private unackedTimestamps = new Map<number, number>()

  // Why: liveness probes (#7773) resolve on the first frame of any kind —
  // a keepalive ack proves the relay round-trip without a full RPC.
  private livenessProbeWaiters: { succeed: () => void; fail: () => void }[] = []

  constructor(transport: MultiplexerTransport) {
    this.transport = transport
    this.writer = new SshMultiplexerTransportWriter(
      transport,
      (error) => this.handleProtocolError(error),
      (saturated) => this.handleWriterSaturationChange(saturated)
    )

    this.decoder = new FrameDecoder(
      (frame) => this.handleFrame(frame),
      (err) => this.handleProtocolError(err),
      {
        pause: () => this.pauseDecoderReads(),
        resume: () => this.resumeDecoderReads()
      }
    )

    transport.onData((data) => {
      if (this.disposed) {
        return
      }
      this.lastReceivedAt = Date.now()
      this.decoder.feed(data)
    })

    transport.onClose(() => {
      this.dispose('connection_lost')
    })

    if (this.disposed) {
      return
    }
    this.startConnectionHealthTimer()
  }

  // Why: the session needs to know when the relay channel dies so it can
  // auto-reconnect. Without this, a relay channel close (e.g. --connect
  // bridge exits) leaves the session in 'ready' state with a dead mux
  // and no recovery path — the SSH connection stays up so onStateChange
  // never fires the reconnect logic.
  /**
   * Send a JSON-RPC request and wait for the response.
   */
  /**
   * Send a JSON-RPC notification (no response expected).
   */
  /**
   * Send a fresh keepalive and resolve true when any frame arrives before the
   * timeout. Used on system resume to distinguish a link that survived sleep
   * from a dead one before tearing the session down (#7773).
   */
  // ── Private ───────────────────────────────────────────────────────

  // Why: one 5s interval owns both the periodic keepalive and dead-link check,
  // halving per-connection timers while preserving their send-then-check order.
}

export interface SshChannelMultiplexer extends SshChannelMultiplexerRequestMethodsSurface, SshChannelMultiplexerFrameMethodsSurface, SshChannelMultiplexerHealthMethodsSurface {}

Object.assign(
  SshChannelMultiplexer.prototype,
  SshChannelMultiplexerRequestMethods,
  SshChannelMultiplexerFrameMethods,
  SshChannelMultiplexerHealthMethods
)
