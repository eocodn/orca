type SshConnectionResult = {
  connected: boolean
  error?: string
}

type PtyConnectionSshConnectSettlementArgs = {
  waitForConnection: () => Promise<SshConnectionResult>
  isCurrentAuthority: () => boolean
  isDisposed: () => boolean
  removeDeferredReconnectTarget: () => void
  reportError: (message: string) => void
  onConnected: () => void
}

export async function runPtyConnectionSshConnectSettlement({
  waitForConnection,
  isCurrentAuthority,
  isDisposed,
  removeDeferredReconnectTarget,
  reportError,
  onConnected
}: PtyConnectionSshConnectSettlementArgs): Promise<'connected' | 'failed' | 'stale'> {
  const result = await waitForConnection()
  if (!isCurrentAuthority()) {
    return 'stale'
  }
  if (!result.connected) {
    reportError(`SSH connection failed: ${result.error}`)
    return 'failed'
  }
  removeDeferredReconnectTarget()
  if (isDisposed()) {
    return 'stale'
  }
  onConnected()
  return 'connected'
}
