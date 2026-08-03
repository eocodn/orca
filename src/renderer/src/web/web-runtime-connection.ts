import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import {
  WebRuntimeConnectionLifecycle,
  type SubscriptionCallbacks,
  type RuntimeSubscription,
  type WebRuntimeSubscriptionHandle,
  type SubscribeOptions
} from './web-runtime-connection-lifecycle'
import {
  REQUEST_TIMEOUT_MS,
  SHARED_CONNECTION_SUBSCRIPTION_METHODS
} from './web-runtime-connection-lifecycle'
import {
  createFileWatchReplayOverflowResponse,
  getFileWatchSubscriptionId,
  isFileWatchStartingResponse
} from './web-runtime-connection-frame'

export type {
  SubscribeOptions,
  WebRuntimeSubscriptionHandle
} from './web-runtime-connection-lifecycle'

export class WebRuntimeClient extends WebRuntimeConnectionLifecycle {
  async call(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number }
  ): Promise<RuntimeRpcResponse<unknown>> {
    await this.waitForConnected(options?.timeoutMs)
    return new Promise((resolve, reject) => {
      const id = this.nextId()
      const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS
      const timeout = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timeout })
      if (!this.sendEncrypted({ id, deviceToken: this.pairing.deviceToken, method, params })) {
        this.pending.delete(id)
        window.clearTimeout(timeout)
        reject(new Error('Remote Orca runtime is not connected.'))
      }
    })
  }

  async subscribe(
    method: string,
    params: unknown,
    callbacks: SubscriptionCallbacks,
    options?: SubscribeOptions
  ): Promise<WebRuntimeSubscriptionHandle> {
    if (SHARED_CONNECTION_SUBSCRIPTION_METHODS.has(method)) {
      // Why: sharing the main socket for file watches avoids exhausting the server's WebSocket connection cap.
      return this.subscribeSharedFileWatch(params, callbacks, options)
    }
    const client = new WebRuntimeClient(this.pairing)
    this.childClients.add(client)
    const closeChild = (notifySubscriptions = false): void => {
      this.childClients.delete(client)
      client.close({ notifySubscriptions })
    }
    try {
      const wrappedCallbacks: SubscriptionCallbacks = {
        ...callbacks,
        onError: (error) => {
          callbacks.onError?.(error)
          closeChild()
        },
        onClose: () => {
          callbacks.onClose?.()
          closeChild()
        }
      }
      const handle = await client.subscribeOnCurrentConnection(
        method,
        params,
        wrappedCallbacks,
        options
      )
      return {
        unsubscribe: () => {
          // Why: emit the teardown RPC before closing the child socket so the server reaps the fs-watcher on view-toggle.
          handle.unsubscribe()
          closeChild()
        },
        sendBinary: (bytes) => handle.sendBinary(bytes)
      }
    } catch (error) {
      closeChild()
      throw error
    }
  }

  private async subscribeSharedFileWatch(
    params: unknown,
    callbacks: SubscriptionCallbacks,
    options?: { timeoutMs?: number }
  ): Promise<WebRuntimeSubscriptionHandle> {
    const teardownKey = JSON.stringify(params) ?? String(params)
    await Promise.all(
      Array.from(this.fileWatchTeardownRetries.get(teardownKey) ?? [], (retry) => retry())
    )
    let stopped = false
    let remoteSubscriptionId: string | null = null
    let transportInterrupted = false
    let pendingReplayResync = false
    let unwatchStarted = false
    let handle: WebRuntimeSubscriptionHandle | null = null
    const dropLocalSubscription = (): void => {
      handle?.unsubscribe()
    }
    let unwatchAttempt: Promise<void> | null = null
    const retryRemoteUnwatch = (): Promise<void> => {
      if (unwatchAttempt) {
        return unwatchAttempt
      }
      unwatchStarted = true
      const attempt = this.call(
        'files.unwatch',
        { subscriptionId: remoteSubscriptionId! },
        { timeoutMs: 5_000 }
      )
        .then((response) => {
          if (response.ok === false) {
            throw new Error(`${response.error.code}: ${response.error.message}`)
          }
          const retries = this.fileWatchTeardownRetries.get(teardownKey)
          retries?.delete(retryRemoteUnwatch)
          if (retries?.size === 0) {
            this.fileWatchTeardownRetries.delete(teardownKey)
          }
          dropLocalSubscription()
        })
        .catch((error: unknown) => {
          console.warn('Failed to unwatch remote file subscription:', error)
          throw error
        })
        .finally(() => {
          unwatchAttempt = null
          unwatchStarted = false
        })
      unwatchAttempt = attempt
      return attempt
    }
    const unwatchAndDropLocalSubscription = (): void => {
      if (unwatchStarted) {
        return
      }
      if (!remoteSubscriptionId) {
        dropLocalSubscription()
        return
      }
      // Why: retain the callback and retry until the server acks physical teardown; a new watch joins this barrier.
      const retries = this.fileWatchTeardownRetries.get(teardownKey) ?? new Set()
      retries.add(retryRemoteUnwatch)
      this.fileWatchTeardownRetries.set(teardownKey, retries)
      void retryRemoteUnwatch().catch(() => {})
    }
    const wrappedCallbacks: SubscriptionCallbacks = {
      ...callbacks,
      onResponse: (response) => {
        transportInterrupted = false
        const nextSubscriptionId = getFileWatchSubscriptionId(response)
        if (nextSubscriptionId) {
          remoteSubscriptionId = nextSubscriptionId
          if (stopped) {
            unwatchAndDropLocalSubscription()
            return
          }
        }
        // Why: server publishes cancellation ownership before native setup; callers become ready only once the watcher is live.
        if (isFileWatchStartingResponse(response)) {
          return
        }
        if (!stopped) {
          callbacks.onResponse(response)
          if (pendingReplayResync && nextSubscriptionId && response.ok) {
            pendingReplayResync = false
            // Why: a replayed watch only reports events after its own setup, so consumers must re-scan the reconnect gap.
            callbacks.onResponse(createFileWatchReplayOverflowResponse(response, params))
          }
        } else if (response.ok === false) {
          dropLocalSubscription()
        }
      },
      onError: (error) => {
        if (!stopped) {
          callbacks.onError?.(error)
        }
      },
      onClose: () => {
        if (!stopped) {
          callbacks.onClose?.()
        }
      },
      onTransportInterrupted: () => {
        transportInterrupted = true
        remoteSubscriptionId = null
        if (!stopped) {
          return
        }
        const retries = this.fileWatchTeardownRetries.get(teardownKey)
        retries?.delete(retryRemoteUnwatch)
        if (retries?.size === 0) {
          this.fileWatchTeardownRetries.delete(teardownKey)
        }
        // Why: socket close physically releases the server subscription — a stopped watch must not replay on the replacement.
        dropLocalSubscription()
      },
      onTransportReplayed: () => {
        transportInterrupted = false
        pendingReplayResync = true
      }
    }
    handle = await this.subscribeOnCurrentConnection(
      'files.watch',
      params,
      wrappedCallbacks,
      options
    )

    return {
      unsubscribe: () => {
        if (stopped) {
          return
        }
        stopped = true
        if (remoteSubscriptionId) {
          unwatchAndDropLocalSubscription()
        } else if (transportInterrupted) {
          // Why: socket close already released the server subscription — drop its replay record, don't revive a stopped watch.
          dropLocalSubscription()
        }
        // Why: an older server may not publish its id until ready — retain the callback so a late response can still unwatch.
      },
      sendBinary: (bytes) => handle?.sendBinary(bytes)
    }
  }

  private async subscribeOnCurrentConnection(
    method: string,
    params: unknown,
    callbacks: SubscriptionCallbacks,
    options?: SubscribeOptions
  ): Promise<WebRuntimeSubscriptionHandle> {
    await this.waitForConnected(options?.timeoutMs)
    const id = this.nextId()
    const subscription: RuntimeSubscription = { id, method, params, callbacks, needsReplay: false }
    this.subscriptions.set(id, subscription)
    if (!this.sendEncrypted({ id, deviceToken: this.pairing.deviceToken, method, params })) {
      this.subscriptions.delete(id)
      throw new Error('Remote Orca runtime is not connected.')
    }
    return {
      unsubscribe: () => {
        this.subscriptions.delete(subscription.id)
        // Tell the server to reap its keyed cleanup before the socket closes; best-effort (a closed socket already reaps).
        const teardown = options?.buildUnsubscribe?.(params)
        if (teardown) {
          this.sendEncrypted({
            id: this.nextId(),
            deviceToken: this.pairing.deviceToken,
            method: teardown.method,
            params: teardown.params
          })
        }
      },
      sendBinary: (bytes) => {
        this.sendEncryptedBinary(bytes)
      }
    }
  }

  close(options: { notifySubscriptions?: boolean } = {}): void {
    const shouldNotifySubscriptions = options.notifySubscriptions ?? true
    this.intentionallyClosed = true
    for (const child of Array.from(this.childClients)) {
      child.close({ notifySubscriptions: shouldNotifySubscriptions })
    }
    this.childClients.clear()
    this.fileWatchTeardownRetries.clear()
    this.clearTimers()
    this.rejectAllPending('Remote Orca runtime connection closed.')
    this.rejectAllWaiters(new Error('Remote Orca runtime connection closed.'))
    if (shouldNotifySubscriptions) {
      this.notifySubscriptionsClosed()
    } else {
      this.subscriptions.clear()
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.sharedKey = null
    this.setState('disconnected')
  }
}
