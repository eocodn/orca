import type { TerminalOutputSourceRange } from '../../shared/terminal-output-source-range'
import { RECENT_PTY_OUTPUT_LIMIT } from './recent-pty-output-buffer'
import type { RecentPtyOutputBuffer } from './recent-pty-output-buffer'
import { TerminalOutputReplay } from './terminal-output-replay'
import { TerminalOutputSequence } from './terminal-output-sequence'
import { TerminalOutputSubscriptions } from './terminal-output-subscriptions'

export type RuntimeTerminalDataMeta = Readonly<{
  seq?: number
  rawLength?: number
  transformed?: boolean
  cwd?: string
  sourceRanges?: readonly TerminalOutputSourceRange[]
}>

/** Owns per-PTY output sequencing, fan-out, and bounded replay state. */
export class TerminalOutputState {
  private readonly sequence = new TerminalOutputSequence()
  private readonly subscriptions = new TerminalOutputSubscriptions<RuntimeTerminalDataMeta>()
  private readonly replay = new TerminalOutputReplay()

  getSequence(ptyId: string): number {
    return this.sequence.get(ptyId)
  }

  setSequence(ptyId: string, sequence: number): void {
    if (!Number.isFinite(sequence) || sequence < 0) {
      throw new Error(`invalid terminal output sequence for ${ptyId}`)
    }
    this.sequence.set(ptyId, sequence)
  }

  advanceSequence(ptyId: string, amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`invalid terminal output increment for ${ptyId}`)
    }
    return this.sequence.advance(ptyId, amount)
  }

  subscribe(
    ptyId: string,
    listener: (data: string, meta?: RuntimeTerminalDataMeta) => void
  ): () => void {
    return this.subscriptions.subscribe(ptyId, listener)
  }

  publish(ptyId: string, data: string, meta?: RuntimeTerminalDataMeta): void {
    this.subscriptions.publish(ptyId, data, meta)
  }

  getRecent(ptyId: string): RecentPtyOutputBuffer | undefined {
    return this.replay.get(ptyId)
  }

  getOrCreateRecent(ptyId: string, preserveChunkBoundaries: boolean): RecentPtyOutputBuffer {
    return this.replay.getOrCreate(ptyId, preserveChunkBoundaries)
  }

  delete(ptyId: string): void {
    this.sequence.delete(ptyId)
    this.subscriptions.delete(ptyId)
    this.replay.delete(ptyId)
  }

  entries(): IterableIterator<[string, RecentPtyOutputBuffer]> {
    return this.replay.entries()
  }

  static readonly recentOutputLimit = RECENT_PTY_OUTPUT_LIMIT

  get sequenceMap(): Map<string, number> {
    return this.sequence.map
  }
}
