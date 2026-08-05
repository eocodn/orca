import type { CommonProps, EventName, EventProps, OptInVia } from '../../shared/telemetry-events'
import type { Store } from '../persistence'

// Product analytics was removed. These process-local hooks remain as compatibility seams for
// diagnostics and existing callers; no event leaves the machine and no consent state is changed.
let sessionId: string | null = null

export function initTelemetry(store: Store): void {
  void store
  sessionId = null
}

export function shouldOptOutSdkAtInit(): boolean {
  return true
}

export function track<N extends EventName>(_name: N, _props: EventProps<N>): void {
  // Intentionally local no-op: retain call sites for diagnostics without external analytics.
}

export async function setOptIn(_via: OptInVia, _optedIn: boolean): Promise<void> {
  // Consent controls are retired with external product analytics.
}

export async function persistBannerAcknowledgeWithoutEmitting(): Promise<void> {
  // First-launch analytics banner is retired.
}

export function trackAppOpenedOnce(): void {
  // Retained as a no-op for startup dependency compatibility.
}

export async function shutdownTelemetry(): Promise<void> {
  sessionId = null
}

export function _setCommonPropsForTests(_props: CommonProps | null): void {}
export function _setStoreForTests(store: Store | null): void {
  void store
}
export function _setShuttingDownForTests(value: boolean): void {
  void value
}
export function _getSessionIdForTests(): string | null {
  return sessionId
}
export function _enableTransportForTests(_enabled: boolean): void {}
export function _resetFirstAppOpenedFiredForTests(): void {}
