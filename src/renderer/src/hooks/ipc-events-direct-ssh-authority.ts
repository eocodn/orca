import { useAppStore } from '../store'
import type { DirectSshAuthority } from '../../../shared/ssh-types'

export function currentDirectSshAuthority(targetId: string): DirectSshAuthority | null {
  const state = useAppStore.getState().sshConnectionStates?.get(targetId)
  if (
    state?.status !== 'connected' ||
    state.targetId !== targetId ||
    !state.providerEpoch ||
    state.connectionGeneration === undefined
  ) {
    return null
  }
  return {
    targetId,
    providerEpoch: state.providerEpoch,
    connectionGeneration: state.connectionGeneration
  }
}
