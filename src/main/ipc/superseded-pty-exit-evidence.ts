type EvidenceTimer = ReturnType<typeof setTimeout>

type EvidenceEntry = Readonly<{
  id: string
  incarnationId: string
  timer: EvidenceTimer
}>

const MAX_EVIDENCE_PER_ID = 128
const MAX_EVIDENCE_TOTAL = 4_096
const EVIDENCE_TTL_MS = 30_000

export class PtyExitEvidence {
  private readonly byPtyId = new Map<string, Map<string, EvidenceTimer>>()
  private readonly entriesByKey = new Map<string, EvidenceEntry>()

  get size(): number {
    return this.entriesByKey.size
  }

  remember(id: string, incarnationId: string): void {
    const byIncarnation = this.byPtyId.get(id) ?? new Map<string, EvidenceTimer>()
    const previousTimer = byIncarnation.get(incarnationId)
    if (previousTimer !== undefined) {
      this.remove(id, incarnationId, previousTimer)
    }
    while (byIncarnation.size >= MAX_EVIDENCE_PER_ID) {
      const oldestIncarnation = byIncarnation.keys().next().value
      if (oldestIncarnation === undefined) {
        break
      }
      const oldestTimer = byIncarnation.get(oldestIncarnation)
      if (oldestTimer === undefined) {
        break
      }
      this.remove(id, oldestIncarnation, oldestTimer)
    }
    while (this.entriesByKey.size >= MAX_EVIDENCE_TOTAL) {
      const oldestKey = this.entriesByKey.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      const oldestEntry = this.entriesByKey.get(oldestKey)
      if (oldestEntry === undefined) {
        break
      }
      this.remove(oldestEntry.id, oldestEntry.incarnationId, oldestEntry.timer)
    }
    const timer = setTimeout(() => {
      this.remove(id, incarnationId, timer)
    }, EVIDENCE_TTL_MS)
    timer.unref?.()
    byIncarnation.set(incarnationId, timer)
    this.byPtyId.set(id, byIncarnation)
    this.entriesByKey.set(this.key(id, incarnationId), { id, incarnationId, timer })
  }

  consume(id: string, incarnationId: string): boolean {
    const timer = this.byPtyId.get(id)?.get(incarnationId)
    if (timer === undefined) {
      return false
    }
    this.remove(id, incarnationId, timer)
    return true
  }

  private key(id: string, incarnationId: string): string {
    return JSON.stringify([id, incarnationId])
  }

  private remove(id: string, incarnationId: string, expectedTimer: EvidenceTimer): void {
    const byIncarnation = this.byPtyId.get(id)
    if (byIncarnation?.get(incarnationId) !== expectedTimer) {
      return
    }
    clearTimeout(expectedTimer)
    byIncarnation.delete(incarnationId)
    if (byIncarnation.size === 0) {
      this.byPtyId.delete(id)
    }
    const key = this.key(id, incarnationId)
    if (this.entriesByKey.get(key)?.timer === expectedTimer) {
      this.entriesByKey.delete(key)
    }
  }
}

export { PtyExitEvidence as SupersededPtyExitEvidence }
