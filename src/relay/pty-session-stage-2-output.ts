import { PtyHandlerStage1 } from './pty-session-stage-1'
import {
  PTY_OUTPUT_BATCH_INTERVAL_MS,
  PTY_OUTPUT_DRAIN_CONTINUE_MS,
  PTY_OUTPUT_FLUSH_CHUNK_CHARS,
  PTY_OUTPUT_FLUSH_MAX_WRITES,
  PTY_OUTPUT_PRODUCER_HIGH_BYTES,
  type PendingPtyOutput
} from './pty-session-stage-contracts'
import type { RelayPtySourceOutput } from './relay-pty-source-output'
export abstract class PtyHandlerStage2Output extends PtyHandlerStage1 {
  protected enqueuePtyOutput(
    id: string,
    data: string,
    meta: { rawLength?: number; transformed?: boolean; seq?: number } = {}
  ): void {
    const queue = this.pendingOutputByPty.get(id) ?? []
    if (this.sourcePublication?.accepts(id)) {
      queue.push({ data, ...meta })
      this.pendingOutputByPty.set(id, queue)
      if (queue.length === 1 && this.shouldSendInteractiveOutputNow(id, data)) {
        queue[0].interactive = true
        if (this.flushPtyOutput(id)) {
          return
        }
      }
      if (this.pendingProducerBytes(id) >= PTY_OUTPUT_PRODUCER_HIGH_BYTES) {
        this.pausePtyOutput(id)
      }
      this.scheduleOutputFlush(PTY_OUTPUT_BATCH_INTERVAL_MS)
      return
    }
    const existing = queue.at(-1)
    if (meta.transformed === true) {
      if (queue.length === 0) {
        const transformed = { data, ...meta }
        if (this.publishPtyOutput(id, transformed, false)) {
          return
        }
        queue.push(transformed)
      } else if (existing?.transformed) {
        existing.data += data
        existing.rawLength = (existing.rawLength ?? 0) + (meta.rawLength ?? data.length)
        existing.seq = meta.seq
      } else {
        queue.push({ data, ...meta })
      }
      this.pendingOutputByPty.set(id, queue)
      this.pausePtyOutput(id)
      return
    }
    const pending: PendingPtyOutput = existing && !existing.transformed ? existing : { data: '' }
    const previousLength = pending.data.length
    pending.data += data
    if (pending.rawLength !== undefined || meta.rawLength !== undefined) {
      pending.rawLength = (pending.rawLength ?? previousLength) + (meta.rawLength ?? data.length)
    }
    if (meta.seq !== undefined) {
      pending.seq = meta.seq
    }
    if (!existing || existing.transformed) {
      queue.push(pending)
    }
    this.pendingOutputByPty.set(id, queue)
    if (queue.length === 1 && this.shouldSendInteractiveOutputNow(id, pending.data)) {
      pending.interactive = true
      if (this.flushPtyOutput(id)) {
        return
      }
    }
    if (this.pendingProducerBytes(id) >= PTY_OUTPUT_PRODUCER_HIGH_BYTES) {
      this.pausePtyOutput(id)
    }
    this.scheduleOutputFlush(PTY_OUTPUT_BATCH_INTERVAL_MS)
  }

  protected scheduleOutputFlush(delayMs: number): void {
    if (this.outputFlushTimer !== null) {
      return
    }
    this.outputFlushTimer = setTimeout(() => this.flushPendingOutput(), delayMs)
  }

  protected flushPendingOutput(): void {
    this.outputFlushTimer = null
    // Why batch before the first send: a re-entrant sink must read the values a whole-map snapshot
    // would have frozen. Why the raw iterator: `for...of` would consume one entry past the limit.
    const pendingEntries = this.pendingOutputByPty[Symbol.iterator]()
    const batch: [string, PendingPtyOutput[]][] = []
    while (batch.length < PTY_OUTPUT_FLUSH_MAX_WRITES) {
      const next = pendingEntries.next()
      if (next.done === true) {
        break
      }
      batch.push([next.value[0], next.value[1].map((pending) => ({ ...pending }))])
    }
    let writes = 0
    for (const [id, queue] of batch) {
      this.pendingOutputByPty.delete(id)
      if (this.flushPtyOutput(id, queue)) {
        writes++
      }
    }
    if (this.pendingOutputByPty.size > 0 && writes > 0) {
      // Why: yield between slices of a large chunk so client input and control frames can interleave.
      this.scheduleOutputFlush(PTY_OUTPUT_DRAIN_CONTINUE_MS)
    }
  }

  protected flushPtyOutput(id: string, capturedQueue?: PendingPtyOutput[]): boolean {
    const queue = capturedQueue ?? this.pendingOutputByPty.get(id)
    const pending = queue?.[0]
    if (!queue || !pending) {
      this.publishPendingExit(id)
      return true
    }
    const desiredChars = pending.transformed
      ? pending.data.length
      : Math.min(pending.data.length, PTY_OUTPUT_FLUSH_CHUNK_CHARS)
    const sourceOnlyEmission =
      pending.transformed === true && pending.data.length === 0 && (pending.rawLength ?? 0) > 0
    const paramsWithoutData = {
      id,
      ...(pending.seq === undefined ? {} : { seq: pending.seq }),
      ...(pending.rawLength === undefined ? {} : { rawLength: pending.rawLength }),
      ...(pending.transformed ? { transformed: true } : {})
    }
    // Why: a failed publish may already have reserved this exact span (source-ledger append,
    // partial legacy fan-out), so a retry must resend it verbatim and slice the remainder at
    // the memo boundary — capacity and coalesced data can both have changed since. The capacity
    // search is skipped on retry: its result is discarded, and publish re-checks capacity.
    let chunkChars =
      pending.transformed || pending.sourceChunk
        ? desiredChars
        : (this.dispatcher.maxLegacyPtyDataChars?.(paramsWithoutData, pending.data, desiredChars) ??
          desiredChars)
    if (
      chunkChars > 0 &&
      chunkChars < pending.data.length &&
      pending.data.charCodeAt(chunkChars - 1) >= 0xd800 &&
      pending.data.charCodeAt(chunkChars - 1) <= 0xdbff
    ) {
      chunkChars--
    }
    if (
      (!sourceOnlyEmission && chunkChars <= 0) ||
      (pending.transformed && chunkChars !== pending.data.length)
    ) {
      this.pendingOutputByPty.set(id, queue)
      this.pausePtyOutput(id)
      return false
    }
    const chunk = pending.sourceChunk?.data ?? pending.data.slice(0, chunkChars)
    const remaining = pending.data.slice(chunk.length)
    const chunkRawLength = pending.transformed
      ? pending.rawLength
      : pending.rawLength === undefined
        ? undefined
        : chunk.length
    const chunkSeq =
      pending.seq === undefined ? undefined : pending.seq - (pending.data.length - chunk.length)
    const sourceChunk =
      pending.sourceChunk ??
      ({
        data: chunk,
        ...(chunkSeq === undefined ? {} : { seq: chunkSeq }),
        ...(chunkRawLength === undefined ? {} : { rawLength: chunkRawLength }),
        ...(pending.transformed ? { transformed: true } : {})
      } satisfies RelayPtySourceOutput)
    pending.sourceChunk = sourceChunk
    const published = this.publishPtyOutput(id, sourceChunk, pending.interactive === true)
    if (!published) {
      this.pendingOutputByPty.set(id, queue)
      this.pausePtyOutput(id)
      return false
    }
    // rawLength fallback is defensive only: transformed memos always carry rawLength (ingress meta).
    const publishedRawLength = sourceChunk.rawLength ?? sourceChunk.data.length
    const remainingRawLength = pending.transformed
      ? (pending.rawLength ?? 0) - publishedRawLength
      : remaining.length
    if (remaining || (pending.transformed && remainingRawLength > 0)) {
      queue[0] = {
        data: remaining,
        ...(pending.transformed ? { transformed: true } : {}),
        ...(pending.rawLength === undefined ? {} : { rawLength: remainingRawLength }),
        seq: pending.seq
      }
    } else {
      queue.shift()
    }
    if (queue.length === 0) {
      this.pendingOutputByPty.delete(id)
      this.publishPendingExit(id)
    } else {
      this.pendingOutputByPty.set(id, queue)
    }
    this.maybeResumePtyOutput(id)
    this.clearOutputFlushTimerIfIdle()
    return true
  }

  protected clearOutputFlushTimerIfIdle(): void {
    if (this.pendingOutputByPty.size > 0 || this.outputFlushTimer === null) {
      return
    }
    clearTimeout(this.outputFlushTimer)
    this.outputFlushTimer = null
  }
}
