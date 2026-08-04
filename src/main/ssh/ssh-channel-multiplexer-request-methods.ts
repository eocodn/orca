import type {
  JsonRpcNotification,
  JsonRpcRequest
} from './relay-protocol'
import {
  REQUEST_TIMEOUT_MS,
  type SshMultiplexerDisposeReason
} from './ssh-channel-multiplexer-foundation'

export const SshChannelMultiplexerRequestMethods = {
  onNotification(this: any, handler: (method: string, params: Record<string, unknown>) => void): () => void {
    if (this.disposed) {
      return () => {}
    }
    this.notificationHandlers.push(handler)
    return () => {
      const idx = this.notificationHandlers.indexOf(handler)
      if (idx !== -1) {
        this.notificationHandlers.splice(idx, 1)
      }
    }
  },
  onNotificationByMethod(this: any, method: string, handler: (params: Record<string, unknown>) => void): () => void {
    if (this.disposed) {
      return () => {}
    }
    let set = this.methodNotificationHandlers.get(method)
    if (!set) {
      set = new Set()
      this.methodNotificationHandlers.set(method, set)
    }
    set.add(handler)
    return () => {
      const current = this.methodNotificationHandlers.get(method)
      if (!current) {
        return
      }
      current.delete(handler)
      if (current.size === 0) {
        this.methodNotificationHandlers.delete(method)
      }
    }
  },
  onRequest(this: any, method: string, handler: (params: Record<string, unknown>) => Promise<unknown> | unknown): () => void {
    this.requestHandlers.set(method, handler)
    return () => {
      if (this.requestHandlers.get(method) === handler) {
        this.requestHandlers.delete(method)
      }
    }
  },
  onDispose(this: any, handler: (reason: SshMultiplexerDisposeReason) => void): () => void {
    if (this.disposed) {
      return () => {}
    }
    this.disposeHandlers.push(handler)
    return () => {
      const idx = this.disposeHandlers.indexOf(handler)
      if (idx !== -1) {
        this.disposeHandlers.splice(idx, 1)
      }
    }
  },
  async request(this: any, method: string, params?: Record<string, unknown>, options?: any): Promise<unknown> {
    if (this.disposed) {
      throw new Error('Multiplexer disposed')
    }
    if (options?.signal?.aborted) {
      const error = new Error(`Request "${method}" was cancelled`) as Error & { name: string }
      error.name = 'AbortError'
      throw error
    }

    const id = this.nextRequestId++
    const msg: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {})
    }
    const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const cleanup = (): void => {
        clearTimeout(timer)
        if (options?.signal) {
          options.signal.removeEventListener('abort', onAbort)
        }
      }
      const onAbort = (): void => {
        const pending = this.pendingRequests.get(id)
        if (!pending) {
          return
        }
        pending.cleanup()
        this.pendingRequests.delete(id)
        this.notify('rpc.cancel', { id })
        const error = new Error(`Request "${method}" was cancelled`) as Error & { name: string }
        error.name = 'AbortError'
        pending.reject(error)
      }
      timer = setTimeout(() => {
        const pending = this.pendingRequests.get(id)
        if (pending) {
          pending.cleanup()
          this.notify('rpc.cancel', { id })
        }
        this.pendingRequests.delete(id)
        reject(new Error(`Request "${method}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      if (options?.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
      this.pendingRequests.set(id, {
        resolve,
        reject,
        beforeResolve: options?.beforeResolve,
        timer,
        cleanup
      })
      this.sendMessage(msg)
    })
  },
  notify(this: any, method: string, params?: Record<string, unknown>): void {
    if (this.disposed) {
      return
    }
    const msg: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {})
    }
    this.sendMessage(msg)
  },
  notifyWithSettlement(this: any, method: string, params: Record<string, unknown> | undefined, onSettled: (result: { ok: true } | { ok: false; error: Error }) => void): void {
    if (this.disposed) {
      onSettled({ ok: false, error: new Error('Multiplexer disposed') })
      return
    }
    this.sendMessage({
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {})
    }, onSettled)
  },
  probeLiveness(this: any, timeoutMs: number): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false)
    }
    return new Promise<boolean>((resolve) => {
      const settle = (alive: boolean): void => {
        clearTimeout(timer)
        const idx = this.livenessProbeWaiters.indexOf(waiter)
        if (idx !== -1) {
          this.livenessProbeWaiters.splice(idx, 1)
        }
        resolve(alive)
      }
      const waiter = { succeed: () => settle(true), fail: () => settle(false) }
      const timer = setTimeout(() => settle(false), timeoutMs)
      this.livenessProbeWaiters.push(waiter)
      this.sendKeepAlive()
    })
  }
}

export type SshChannelMultiplexerRequestMethodsSurface = typeof SshChannelMultiplexerRequestMethods
