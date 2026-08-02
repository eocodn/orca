import { ORCHESTRATION_MESSAGE_WAIT_DEFAULT_TIMEOUT_MS } from '../../shared/orchestration-message-wait-timeout'

export type MessageWaitResult = 'notified' | 'timed_out' | 'cancelled' | 'waiter_exists'

type MessageWaiter = {
  handle: string
  typeFilter?: string[]
  resolve: (result: MessageWaitResult) => void
  timeout: ReturnType<typeof setTimeout> | null
  abortCleanup: (() => void) | null
}

type MessageWaitOptions = {
  typeFilter?: string[]
  timeoutMs?: number
  signal?: AbortSignal
  exclusive?: boolean
}

/** Owns long-poll timers so runtime lifecycle code cannot leak orchestration waiters. */
export class RuntimeMessageWaiters {
  private readonly waitersByHandle = new Map<string, Set<MessageWaiter>>()

  constructor(private readonly defaultTimeoutMs = ORCHESTRATION_MESSAGE_WAIT_DEFAULT_TIMEOUT_MS) {}

  notify(handle: string, messageType?: string): void {
    const waiters = this.waitersByHandle.get(handle)
    if (!waiters) {
      return
    }
    for (const waiter of Array.from(waiters)) {
      if (messageType && waiter.typeFilter && !waiter.typeFilter.includes(messageType)) {
        continue
      }
      this.resolve(waiter, 'notified')
    }
  }

  wait(handle: string, options?: MessageWaitOptions): Promise<MessageWaitResult> {
    return new Promise((resolve) => {
      const currentWaiters = this.waitersByHandle.get(handle)
      if (options?.exclusive && currentWaiters && currentWaiters.size > 0) {
        resolve('waiter_exists')
        return
      }

      const waiter: MessageWaiter = {
        handle,
        typeFilter: options?.typeFilter,
        resolve,
        timeout: null,
        abortCleanup: null
      }
      const signal = options?.signal
      const onAbort = (): void => {
        this.remove(waiter)
        resolve('cancelled')
      }
      if (signal) {
        if (signal.aborted) {
          resolve('cancelled')
          return
        }
        waiter.abortCleanup = () => signal.removeEventListener('abort', onAbort)
        signal.addEventListener('abort', onAbort, { once: true })
      }

      waiter.timeout = setTimeout(() => {
        this.remove(waiter)
        resolve('timed_out')
      }, options?.timeoutMs ?? this.defaultTimeoutMs)

      let waiters = this.waitersByHandle.get(handle)
      if (!waiters) {
        waiters = new Set()
        this.waitersByHandle.set(handle, waiters)
      }
      waiters.add(waiter)
    })
  }

  cancel(handle: string): number {
    const waiters = this.waitersByHandle.get(handle)
    if (!waiters) {
      return 0
    }
    const count = waiters.size
    for (const waiter of Array.from(waiters)) {
      this.resolve(waiter, 'cancelled')
    }
    return count
  }

  private resolve(waiter: MessageWaiter, result: MessageWaitResult): void {
    this.remove(waiter)
    waiter.resolve(result)
  }

  private remove(waiter: MessageWaiter): void {
    if (waiter.timeout) {
      clearTimeout(waiter.timeout)
      waiter.timeout = null
    }
    waiter.abortCleanup?.()
    waiter.abortCleanup = null
    const waiters = this.waitersByHandle.get(waiter.handle)
    if (!waiters) {
      return
    }
    waiters.delete(waiter)
    if (waiters.size === 0) {
      this.waitersByHandle.delete(waiter.handle)
    }
  }
}
