// Registration stages share one resettable object so handlers keep closure-local lifetime semantics after extraction.
// Registration stages intentionally share one dynamic object; each stage adds only its own API.
export type PtyRegistrationSharedState = Record<string, any>

let currentState: PtyRegistrationSharedState | null = null

export function beginPtyRegistrationSharedState(): PtyRegistrationSharedState {
  currentState = {}
  return currentState
}

export function getPtyRegistrationSharedState(): PtyRegistrationSharedState {
  if (!currentState) {
    throw new Error('pty_registration_state_uninitialized')
  }
  return currentState
}
