import { areValidTerminalDimensions } from '../shared/terminal-dimensions'
import { PtyHandlerStage4Attach } from './pty-session-stage-4-attach'

export class PtyHandlerStage4Controls extends PtyHandlerStage4Attach {
  protected writeData(params: Record<string, unknown>): void {
    const id = params.id as string
    const data = params.data as string
    if (typeof data !== 'string') {
      return
    }
    const managed = this.ptys.get(id)
    if (managed && !managed.disposed) {
      this.lastInputAtByPty.set(id, performance.now())
      this.interactiveOutputCharsByPty.set(id, 0)
      managed.pty.write(data)
    }
  }

  protected resize(params: Record<string, unknown>): void {
    const id = params.id as string
    const cols = Math.max(1, Math.min(500, Math.floor(Number(params.cols) || 80)))
    const rows = Math.max(1, Math.min(500, Math.floor(Number(params.rows) || 24)))
    const managed = this.ptys.get(id)
    if (managed && !managed.disposed) {
      managed.pty.resize(cols, rows)
    }
  }

  protected async resizeIfCurrent(
    params: Record<string, unknown>
  ): Promise<{ applied: boolean }> {
    const id = params.id as string
    const expectedIncarnationId = params.expectedIncarnationId
    const cols = Number(params.cols)
    const rows = Number(params.rows)
    const managed = this.ptys.get(id)
    if (
      !managed ||
      managed.disposed ||
      typeof expectedIncarnationId !== 'string' ||
      managed.incarnationId !== expectedIncarnationId ||
      !areValidTerminalDimensions(cols, rows)
    ) {
      return { applied: false }
    }
    managed.pty.resize(cols, rows)
    return { applied: true }
  }

  protected async getSize(
    params: Record<string, unknown>
  ): Promise<{ cols: number; rows: number } | null> {
    const managed = this.ptys.get(params.id as string)
    if (!managed || managed.disposed) {
      return null
    }
    return { cols: managed.pty.cols, rows: managed.pty.rows }
  }
}

