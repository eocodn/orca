import { stripTerminalControls } from './advertised-url-parsing'

const PER_PTY_BUFFER_LIMIT = 4096

export class AdvertisedUrlPtyBuffer {
  private raw = ''

  ingest(chunk: string): string {
    const chunkHasLineBreak = chunk.includes('\n') || chunk.includes('\r')
    this.raw += chunk
    if (this.raw.length > PER_PTY_BUFFER_LIMIT) {
      this.raw = this.raw.slice(-PER_PTY_BUFFER_LIMIT)
    }
    if (!chunkHasLineBreak) {
      return ''
    }
    const lastNewline = lastLineBreak(this.raw)
    if (lastNewline === -1) {
      return ''
    }
    const finalized = this.raw.slice(0, lastNewline + 1)
    this.raw = this.raw.slice(lastNewline + 1)
    return stripTerminalControls(finalized)
  }
}

function lastLineBreak(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const code = text.charCodeAt(index)
    if (code === 0x0a || code === 0x0d) {
      return index
    }
  }
  return -1
}
