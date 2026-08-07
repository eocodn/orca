const TRANSPORT_CONNECT_SETTLE_GRACE_MS = 60_000

type PtyConnectionTransportSettleControllerArgs = {
  now: () => number
}

export function createPtyConnectionTransportSettleController({
  now
}: PtyConnectionTransportSettleControllerArgs) {
  let inFlightSince: number | null = null

  return {
    setInFlightSince(value: number | null): void {
      inFlightSince = value
    },
    isSettling(): boolean {
      return inFlightSince !== null && now() - inFlightSince < TRANSPORT_CONNECT_SETTLE_GRACE_MS
    }
  }
}
