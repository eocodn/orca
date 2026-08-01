import { parsePairingCode, type PairingOffer } from '../../shared/pairing'
import { getPreferredPairingOffer } from '../../shared/runtime-environments'
import { resolveEnvironment } from './environments'
import { RuntimeClientError } from './types'

export type RuntimeClientSelection = {
  pairing: PairingOffer | null
  executionHostId: 'local' | `runtime:${string}` | null
}

export function resolveRuntimeClientSelection(
  userDataPath: string,
  pairingCode: string | null,
  environmentSelector: string | null
): RuntimeClientSelection {
  if (pairingCode && environmentSelector) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Use either --pairing-code or --environment, not both.'
    )
  }
  if (environmentSelector) {
    // Resolve once so the pairing endpoint and stable host ID cannot come from
    // different environment records during a concurrent remove/recreate.
    const environment = resolveEnvironment(userDataPath, environmentSelector)
    return {
      pairing: getPreferredPairingOffer(environment),
      executionHostId: `runtime:${environment.id}`
    }
  }
  if (!pairingCode) {
    return { pairing: null, executionHostId: 'local' }
  }
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Invalid remote pairing code. Expected an orca://pair?... URL or bare pairing payload.'
    )
  }
  // Raw pairing identifies only a connection/incarnation, not a stable saved host.
  return { pairing, executionHostId: null }
}
