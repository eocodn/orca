import type { GlobalSettings } from '../../shared/types'
import {
  markHiddenRendererPty,
  shouldDropHiddenRendererPtyData,
  unmarkHiddenRendererPty
} from './pty-hidden-delivery-gate'

export type PtyHiddenRendererDeliveryTransition = {
  droppable: boolean
  droppedWhileHidden: boolean
  policyChanged: boolean
}

export function createPtyRendererHiddenDeliveryTransitions(
  getSettings: (() => GlobalSettings) | undefined,
  invalidatePendingPtyDrainPolicy: (id: string) => void
): {
  transitionHiddenRendererPtyDeliveryState: (
    id: string,
    hidden: boolean
  ) => PtyHiddenRendererDeliveryTransition
  transitionSpawnHiddenRendererPtyDeliveryState: (id: string, hidden: boolean) => void
} {
  function transitionHiddenRendererPtyDeliveryState(
    id: string,
    hidden: boolean
  ): PtyHiddenRendererDeliveryTransition {
    const settings = getSettings?.()
    const wasDroppable = shouldDropHiddenRendererPtyData(id, settings)
    let droppedWhileHidden = false
    if (hidden) {
      markHiddenRendererPty(id)
    } else {
      droppedWhileHidden = unmarkHiddenRendererPty(id).droppedWhileHidden
    }
    const droppable = shouldDropHiddenRendererPtyData(id, settings)
    return { droppable, droppedWhileHidden, policyChanged: wasDroppable !== droppable }
  }

  function transitionSpawnHiddenRendererPtyDeliveryState(id: string, hidden: boolean): void {
    const transition = transitionHiddenRendererPtyDeliveryState(id, hidden)
    if (transition.policyChanged) {
      invalidatePendingPtyDrainPolicy(id)
    }
  }

  return {
    transitionHiddenRendererPtyDeliveryState,
    transitionSpawnHiddenRendererPtyDeliveryState
  }
}
