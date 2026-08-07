type SshPromptAdmissionResult = 'continue' | 'stale' | 'cancelled' | 'failed'
type SshConnectSettlementResult = 'connected' | 'failed' | 'stale'

type PtyConnectionDeferredSshConnectArgs = {
  runPromptAdmission: () => Promise<SshPromptAdmissionResult>
  runSettlement: () => Promise<SshConnectSettlementResult>
}

export async function runPtyConnectionDeferredSshConnect({
  runPromptAdmission,
  runSettlement
}: PtyConnectionDeferredSshConnectArgs): Promise<
  Exclude<SshPromptAdmissionResult, 'continue'> | SshConnectSettlementResult
> {
  const admission = await runPromptAdmission()
  if (admission !== 'continue') {
    return admission
  }
  return runSettlement()
}
