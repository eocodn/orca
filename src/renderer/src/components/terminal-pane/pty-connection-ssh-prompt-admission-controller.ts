type SshPromptConnectOutcome = 'connected' | 'failed' | 'cancelled'

type PtyConnectionSshPromptAdmissionArgs = {
  needsPassphrasePrompt: () => Promise<boolean>
  isCurrentAuthority: () => boolean
  isAlreadyConnected: () => boolean
  waitForUserConnect: () => Promise<SshPromptConnectOutcome>
  warnProbeFailure: (error: unknown) => void
  reportError: (message: string) => void
}

export async function runPtyConnectionSshPromptAdmission({
  needsPassphrasePrompt,
  isCurrentAuthority,
  isAlreadyConnected,
  waitForUserConnect,
  warnProbeFailure,
  reportError
}: PtyConnectionSshPromptAdmissionArgs): Promise<'continue' | 'stale' | 'cancelled' | 'failed'> {
  let needsPrompt = false
  try {
    needsPrompt = await needsPassphrasePrompt()
  } catch (error) {
    warnProbeFailure(error)
  }
  if (!isCurrentAuthority()) {
    return 'stale'
  }
  if (!needsPrompt || isAlreadyConnected()) {
    return 'continue'
  }
  const outcome = await waitForUserConnect()
  if (!isCurrentAuthority()) {
    return 'stale'
  }
  if (outcome === 'cancelled') {
    return 'cancelled'
  }
  if (outcome === 'failed') {
    reportError('SSH connection failed')
    return 'failed'
  }
  return 'continue'
}
