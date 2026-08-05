import type { EventName, EventProps } from '../../../shared/telemetry-events'
import type { TelemetryConsentState } from '../../../shared/telemetry-consent-types'

// Product analytics is retired. Keep the typed local seam so feature code can report
// diagnostics without coupling to a network transport.
export { tuiAgentToAgentKind } from '../../../shared/agent-kind'
export const PRIVACY_URL = 'https://www.onorca.dev/docs/telemetry'

export function track<N extends EventName>(_name: N, _props: EventProps<N>): void {}
export function setOptIn(_optedIn: boolean): Promise<void> {
  return Promise.resolve()
}
export function acknowledgeBanner(): Promise<void> {
  return Promise.resolve()
}
export async function getConsentState(): Promise<TelemetryConsentState> {
  return { effective: 'disabled', reason: 'orca_disabled' }
}
