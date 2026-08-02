export type PtyLayoutTarget =
  | { kind: 'desktop'; cols: number; rows: number }
  | { kind: 'phone'; cols: number; rows: number; ownerClientId: string }
  | { kind: 'remote-desktop'; cols: number; rows: number; ownerSubscriptionKey: string }

export type PtyLayoutState = PtyLayoutTarget & {
  seq: number
  appliedAt: number
}

export type ApplyLayoutResult =
  | { ok: true; state: PtyLayoutState }
  | { ok: false; reason: 'pty-exited' | 'resize-failed' }

type LayoutQueueWaiter = {
  resolve: (result: ApplyLayoutResult) => void
  reject: (error: unknown) => void
}

type LayoutQueueSlot = {
  target: PtyLayoutTarget
  coalescible: boolean
  cancellationError?: string
  beforeApply?: () => void | Promise<void>
  resizeMutation?: (cols: number, rows: number) => boolean | Promise<boolean>
  afterApply?: (result: ApplyLayoutResult) => void | Promise<void>
  waiters: LayoutQueueWaiter[]
}

type LayoutQueueEntry = {
  generation: number
  running: Promise<ApplyLayoutResult> | null
  runningSlot: LayoutQueueSlot | null
  pending: LayoutQueueSlot[]
  cancelled: boolean
}

export type PtyLayoutQueueHost = {
  getGeneration: (ptyId: string) => number
  hasLayout: (ptyId: string) => boolean
  isFreshSubscribe: (ptyId: string, generation: number) => boolean
  apply: (
    ptyId: string,
    target: PtyLayoutTarget,
    generation: number,
    resizeMutation?: (cols: number, rows: number) => boolean | Promise<boolean>
  ) => Promise<ApplyLayoutResult>
}

export class PtyLayoutQueue {
  private readonly entries = new Map<string, LayoutQueueEntry>()

  constructor(private readonly host: PtyLayoutQueueHost) {}

  enqueue(ptyId: string, target: PtyLayoutTarget): Promise<ApplyLayoutResult> {
    return this.enqueueSlot(ptyId, {
      target,
      coalescible: true,
      waiters: []
    })
  }

  enqueueExact(
    ptyId: string,
    target: PtyLayoutTarget,
    hooks: {
      beforeApply: () => void | Promise<void>
      resizeMutation: (cols: number, rows: number) => boolean | Promise<boolean>
      afterApply: (result: ApplyLayoutResult) => void | Promise<void>
    }
  ): Promise<ApplyLayoutResult> {
    return this.enqueueSlot(ptyId, {
      target,
      coalescible: false,
      cancellationError: 'terminal_incarnation_stale',
      beforeApply: hooks.beforeApply,
      resizeMutation: hooks.resizeMutation,
      afterApply: hooks.afterApply,
      waiters: []
    })
  }

  cancel(ptyId: string, generation: number): boolean {
    const entry = this.entries.get(ptyId)
    if (!entry || entry.generation !== generation) {
      return false
    }
    entry.cancelled = true
    this.entries.delete(ptyId)
    if (entry.runningSlot) {
      this.settleCancelledSlot(entry.runningSlot)
    }
    for (const slot of entry.pending.splice(0)) {
      this.settleCancelledSlot(slot)
    }
    return true
  }

  private settleCancelledSlot(slot: LayoutQueueSlot): void {
    const waiters = slot.waiters.splice(0)
    for (const waiter of waiters) {
      if (slot.cancellationError) {
        waiter.reject(new Error(slot.cancellationError))
      } else {
        waiter.resolve({ ok: false, reason: 'pty-exited' })
      }
    }
  }

  private coalescesWith(prev: PtyLayoutTarget, next: PtyLayoutTarget): boolean {
    if (prev.kind !== next.kind) {
      return false
    }
    if (prev.kind === 'phone' && next.kind === 'phone') {
      return prev.ownerClientId === next.ownerClientId
    }
    if (prev.kind === 'remote-desktop' && next.kind === 'remote-desktop') {
      return prev.ownerSubscriptionKey === next.ownerSubscriptionKey
    }
    return true
  }

  private enqueueSlot(ptyId: string, slot: LayoutQueueSlot): Promise<ApplyLayoutResult> {
    const generation = this.host.getGeneration(ptyId)
    if (!this.host.hasLayout(ptyId) && !this.host.isFreshSubscribe(ptyId, generation)) {
      return Promise.resolve({ ok: false, reason: 'pty-exited' })
    }

    let entry = this.entries.get(ptyId)
    if (entry && entry.generation !== generation) {
      this.cancel(ptyId, entry.generation)
      entry = undefined
    }
    if (!entry) {
      entry = { generation, running: null, runningSlot: null, pending: [], cancelled: false }
      this.entries.set(ptyId, entry)
    }
    const queue = entry

    return new Promise<ApplyLayoutResult>((resolve, reject) => {
      const waiter = { resolve, reject }
      if (!queue.running) {
        slot.waiters.push(waiter)
        queue.runningSlot = slot
        queue.running = this.runSlot(ptyId, queue, slot)
        return
      }
      const tail = queue.pending.at(-1)
      if (tail?.coalescible && slot.coalescible && this.coalescesWith(tail.target, slot.target)) {
        tail.target = slot.target
        tail.waiters.push(waiter)
        return
      }
      slot.waiters.push(waiter)
      queue.pending.push(slot)
    })
  }

  private async runSlot(
    ptyId: string,
    entry: LayoutQueueEntry,
    slot: LayoutQueueSlot
  ): Promise<ApplyLayoutResult> {
    let result: ApplyLayoutResult = { ok: false, reason: 'resize-failed' }
    let slotError: unknown = null
    try {
      await slot.beforeApply?.()
    } catch (err) {
      slotError = err
    }
    if (!slotError && !entry.cancelled && this.host.getGeneration(ptyId) === entry.generation) {
      try {
        result = await this.host.apply(ptyId, slot.target, entry.generation, slot.resizeMutation)
      } catch (err) {
        console.error('[layout] applyLayout threw', { ptyId, err })
        result = { ok: false, reason: 'resize-failed' }
      }
      try {
        await slot.afterApply?.(result)
      } catch (err) {
        slotError = err
      }
    }
    for (const waiter of slot.waiters.splice(0)) {
      if (slotError) {
        waiter.reject(slotError)
      } else {
        waiter.resolve(result)
      }
    }

    if (entry.cancelled || this.entries.get(ptyId) !== entry) {
      return result
    }
    const next = entry.pending.shift()
    if (next) {
      entry.runningSlot = next
      entry.running = this.runSlot(ptyId, entry, next)
    } else {
      entry.running = null
      entry.runningSlot = null
      this.entries.delete(ptyId)
    }
    return result
  }
}
