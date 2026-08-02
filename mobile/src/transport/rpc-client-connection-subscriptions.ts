import type { StreamRequest } from './rpc-client-connection-contracts'

type Dependencies = {
  nextId: () => string
  deviceToken: string
  sendEncrypted: (request: unknown) => boolean
}

export function sendBrowserScreencastUnsubscribe(
  { nextId, deviceToken, sendEncrypted }: Dependencies,
  subscriptionId: string
): void {
  sendEncrypted({
    id: nextId(),
    deviceToken,
    method: 'browser.screencast.unsubscribe',
    params: { subscriptionId }
  })
}

export function createServerSubscriptionUnsubscriber({
  nextId,
  deviceToken,
  sendEncrypted
}: Dependencies) {
  return function sendServerSubscriptionUnsubscribe(stream: StreamRequest): void {
    if (!stream.subscriptionId) {
      return
    }
    if (stream.method === 'browser.screencast') {
      sendBrowserScreencastUnsubscribe({ nextId, deviceToken, sendEncrypted }, stream.subscriptionId)
      return
    }
    if (stream.method === 'runtime.clientEvents.subscribe') {
      sendEncrypted({
        id: nextId(),
        deviceToken,
        method: 'runtime.clientEvents.unsubscribe',
        params: { subscriptionId: stream.subscriptionId }
      })
    }
  }
}