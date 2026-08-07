import type { UserInitiatedSshConnectOutcome } from './pty-connection-routing-policy'

type PtyConnectionSshPromptWaitArgs = {
  getStatus: () => string | undefined
  subscribe: (listener: () => void) => () => void
  isDisposed: () => boolean
  waitTeardowns: (() => void)[]
  outcomeForStatus: (
    status: string | undefined,
    sawNonDisconnected: boolean
  ) => UserInitiatedSshConnectOutcome | null
}

export function waitForUserInitiatedSshConnect({
  getStatus,
  subscribe,
  isDisposed,
  waitTeardowns,
  outcomeForStatus
}: PtyConnectionSshPromptWaitArgs): Promise<UserInitiatedSshConnectOutcome> {
  return new Promise((resolve) => {
    const entryStatus = getStatus()
    let sawNonDisconnected = entryStatus !== 'disconnected' && entryStatus !== undefined
    let settled = false
    let unsubscribe = (): void => {}

    const finish = (outcome: UserInitiatedSshConnectOutcome): void => {
      if (settled) {
        return
      }
      settled = true
      unsubscribe()
      const index = waitTeardowns.indexOf(teardown)
      if (index !== -1) {
        waitTeardowns.splice(index, 1)
      }
      resolve(outcome)
    }
    const teardown = (): void => finish('cancelled')
    const observeCurrentStatus = (): void => {
      if (isDisposed()) {
        finish('cancelled')
        return
      }
      const status = getStatus()
      if (status && status !== 'disconnected') {
        sawNonDisconnected = true
      }
      const outcome = outcomeForStatus(status, sawNonDisconnected)
      if (outcome) {
        finish(outcome)
      }
    }

    waitTeardowns.push(teardown)
    const subscribedUnsubscribe = subscribe(observeCurrentStatus)
    unsubscribe = subscribedUnsubscribe
    if (settled) {
      unsubscribe()
      return
    }
    // Why: catch a status change that lands between the entry read and subscription registration.
    observeCurrentStatus()
  })
}
