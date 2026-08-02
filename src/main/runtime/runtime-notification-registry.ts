import type { MobileNotificationEvent } from './orca-runtime'
import {
  MobileNotificationReplayBuffer,
  type ReplayableMobileNotification
} from './mobile-notification-replay'

type NotificationListener = (event: ReplayableMobileNotification) => void

/** Keeps notification fan-out and reconnect replay on one monotonic source. */
export class RuntimeNotificationRegistry {
  private readonly listeners = new Set<NotificationListener>()
  private readonly replay = new MobileNotificationReplayBuffer()

  get epoch(): string {
    return this.replay.epoch
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispatch(event: MobileNotificationEvent): ReplayableMobileNotification {
    const sequence = this.replay.record(event)
    const published = {
      ...event,
      notificationSeq: sequence,
      notificationEpoch: this.replay.epoch
    }
    for (const listener of Array.from(this.listeners)) {
      try {
        listener({ ...published })
      } catch (error) {
        console.error('[runtime] mobile-notification listener threw', error)
      }
    }
    return published
  }

  missedSince(lastSeenSeq: number, epoch?: string): ReplayableMobileNotification[] {
    return this.replay.getMissedSince(lastSeenSeq, epoch)
  }
}
