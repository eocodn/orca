import type { PendingPtyData } from './pty-pending-data-drain-queue'

export function canCoalescePtyData(
  existing: Pick<PendingPtyData, 'incarnationId'> | PendingPtyData,
  incarnationId?: string
): boolean {
  return existing.incarnationId === incarnationId
}

export function preservePtyIncarnationId<T extends object>(
  value: T,
  incarnationId: string | undefined
): T & Pick<PendingPtyData, 'incarnationId'> {
  return incarnationId === undefined ? value : { ...value, incarnationId }
}
