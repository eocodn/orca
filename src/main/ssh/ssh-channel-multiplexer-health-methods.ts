import { KEEPALIVE_SEND_MS, TIMEOUT_MS } from './relay-protocol'
import { WAKE_GAP_MS } from './ssh-channel-multiplexer-foundation'

export const SshChannelMultiplexerHealthMethods = {
  startConnectionHealthTimer(this: any): void {
    let lastTickAt = Date.now()
    this.connectionHealthTimer = setInterval(() => {
      const now = Date.now()
      const sinceLastTick = now - lastTickAt
      lastTickAt = now
      const resumedAfterWake = sinceLastTick > WAKE_GAP_MS
      if (resumedAfterWake) {
        this.rebaseHealthClocks(now)
      }
      this.sendKeepAlive()
      if (this.disposed || resumedAfterWake || this.decoderReadPaused || this.writerSaturated) {
        return
      }
      const noDataReceived = now - this.lastReceivedAt > TIMEOUT_MS
      let oldestUnacked = Infinity
      for (const ts of this.unackedTimestamps.values()) {
        if (ts < oldestUnacked) {
          oldestUnacked = ts
        }
      }
      const oldestUnackedStale = oldestUnacked !== Infinity && now - oldestUnacked > TIMEOUT_MS
      if (noDataReceived && oldestUnackedStale) {
        this.handleProtocolError(new Error('Connection timed out (no ack received)'))
      }
    }, KEEPALIVE_SEND_MS)
  },
  pauseDecoderReads(this: any): void {
    if (this.disposed || this.decoderReadPaused) {
      return
    }
    this.decoderReadPaused = true
    try {
      this.transport.pauseReads?.()
    } catch (error) {
      this.handleProtocolError(error)
    }
  },
  resumeDecoderReads(this: any): void {
    if (!this.decoderReadPaused) {
      return
    }
    this.decoderReadPaused = false
    if (this.disposed) {
      return
    }
    this.rebaseHealthClocks(Date.now())
    try {
      this.transport.resumeReads?.()
    } catch (error) {
      this.handleProtocolError(error)
    }
  },
  handleWriterSaturationChange(this: any, saturated: boolean): void {
    this.writerSaturated = saturated
    if (!saturated && !this.disposed) {
      this.rebaseHealthClocks(Date.now())
    }
  },
  rebaseHealthClocks(this: any, now: number): void {
    this.lastReceivedAt = now
    for (const seq of this.unackedTimestamps.keys()) {
      this.unackedTimestamps.set(seq, now)
    }
  }
}

export type SshChannelMultiplexerHealthMethodsSurface = typeof SshChannelMultiplexerHealthMethods
