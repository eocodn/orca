export type VisibleForegroundSampleOutcome = 'agent' | 'shell' | 'inconclusive'

type VisibleForegroundSampleDecision = {
  expectsAgent: boolean
}

type PtyConnectionVisibleForegroundSampleControllerArgs = {
  resolveSample: (forceRoutingConfirmation: boolean) => VisibleForegroundSampleDecision | null
  sample: (expectsAgent: boolean) => boolean
}

export function createPtyConnectionVisibleForegroundSampleController({
  resolveSample,
  sample
}: PtyConnectionVisibleForegroundSampleControllerArgs) {
  let pending = false
  let settled = false

  const reset = (): void => {
    pending = false
    settled = false
  }

  return {
    request(forceRoutingConfirmation = false): void {
      if (pending || settled) {
        return
      }
      const decision = resolveSample(forceRoutingConfirmation)
      if (!decision) {
        return
      }
      pending = sample(decision.expectsAgent)
    },
    settle(outcome: VisibleForegroundSampleOutcome): void {
      pending = false
      settled = outcome !== 'inconclusive'
    },
    clearPending(): void {
      pending = false
    },
    reset,
    dispose: reset
  }
}
