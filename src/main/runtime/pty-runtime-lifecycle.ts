export type PtyIncarnationState = 'current' | 'replacement' | 'cleanup_pending' | 'unknown'

export function resolvePtyIncarnationState(input: {
  current: string | undefined
  pending: string | undefined
  cleanupPending: boolean
}): PtyIncarnationState {
  if (input.cleanupPending) {
    return 'cleanup_pending'
  }
  if (input.pending && input.current && input.pending !== input.current) {
    return 'replacement'
  }
  if (input.pending && !input.current) {
    return 'replacement'
  }
  if (input.current) {
    return 'current'
  }
  return 'unknown'
}
