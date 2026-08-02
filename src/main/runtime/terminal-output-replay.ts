import { RecentPtyOutputBuffer } from './recent-pty-output-buffer'

export class TerminalOutputReplay {
  private readonly buffersByPtyId = new Map<string, RecentPtyOutputBuffer>()

  get(ptyId: string): RecentPtyOutputBuffer | undefined {
    return this.buffersByPtyId.get(ptyId)
  }

  getOrCreate(ptyId: string, preserveChunkBoundaries: boolean): RecentPtyOutputBuffer {
    let buffer = this.buffersByPtyId.get(ptyId)
    if (!buffer) {
      buffer = new RecentPtyOutputBuffer({ preserveChunkBoundaries })
      this.buffersByPtyId.set(ptyId, buffer)
    }
    return buffer
  }

  entries(): IterableIterator<[string, RecentPtyOutputBuffer]> {
    return this.buffersByPtyId.entries()
  }

  delete(ptyId: string): void {
    this.buffersByPtyId.delete(ptyId)
  }
}
