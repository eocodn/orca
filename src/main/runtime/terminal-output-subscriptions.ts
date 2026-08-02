export type TerminalOutputSubscription<M> = (data: string, meta?: M) => void

export class TerminalOutputSubscriptions<M> {
  private readonly listenersByPtyId = new Map<string, Set<TerminalOutputSubscription<M>>>()

  subscribe(ptyId: string, listener: TerminalOutputSubscription<M>): () => void {
    let listeners = this.listenersByPtyId.get(ptyId)
    if (!listeners) {
      listeners = new Set()
      this.listenersByPtyId.set(ptyId, listeners)
    }
    listeners.add(listener)
    return () => {
      const current = this.listenersByPtyId.get(ptyId)
      current?.delete(listener)
      if (current?.size === 0) {
        this.listenersByPtyId.delete(ptyId)
      }
    }
  }

  publish(ptyId: string, data: string, meta?: M): void {
    for (const listener of Array.from(this.listenersByPtyId.get(ptyId) ?? [])) {
      try {
        listener(data, meta)
      } catch (error) {
        console.error('[runtime] pty-data listener threw', error)
      }
    }
  }

  delete(ptyId: string): void {
    this.listenersByPtyId.delete(ptyId)
  }
}
