import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { isPtyIncarnationId } from '../../shared/pty-incarnation'
import type {
  SshPtyDataCallback,
  SshPtyDeliveryPauseAdapter,
  SshPtyExitCallback,
  SshPtyReplayCallback
} from './ssh-pty-provider-contract'
import {
  subscribeSshPtyNotifications,
  type SshPtyNotificationSubscription,
  type SshPtyReceivingActivationLease
} from './ssh-pty-notification-routing'
import type { PtySourceReceivingActivation } from '../../shared/pty-source-receiving-activation'

export class SshPtyProviderOutputState {
  private readonly dataListeners = new Set<SshPtyDataCallback>()
  private readonly replayListeners = new Set<SshPtyReplayCallback>()
  private readonly exitListeners = new Set<SshPtyExitCallback>()
  private readonly incarnationByRelayPtyId = new Map<string, string>()
  private readonly legacyIncarnationByRelayPtyId = new Map<string, string>()
  private readonly pausedRelayPtyIds = new Set<string>()
  private deliveryPauseAdapter: SshPtyDeliveryPauseAdapter | null = null
  private legacyIncarnationSerial = 1
  private subscription: SshPtyNotificationSubscription | null

  constructor(
    private readonly providerGeneration: number,
    args: {
      mux: SshChannelMultiplexer
      toAppPtyId: (id: string) => string
      livePtyIds: Set<string>
      recordExit: (relayPtyId: string, incarnationId: unknown) => void
    }
  ) {
    this.subscription = subscribeSshPtyNotifications({
      ...args,
      dataListeners: this.dataListeners,
      replayListeners: this.replayListeners,
      exitListeners: this.exitListeners,
      providerGeneration,
      resolvePtyIncarnation: (relayPtyId, incarnationId) =>
        this.resolvePtyIncarnation(relayPtyId, incarnationId),
      resolvePtyExitIncarnation: (relayPtyId, incarnationId) =>
        this.resolvePtyExitIncarnation(relayPtyId, incarnationId),
      recordExit: (relayPtyId, incarnationId) => {
        const currentIncarnation = this.incarnationByRelayPtyId.get(relayPtyId)
        if (isPtyIncarnationId(incarnationId)) {
          if (currentIncarnation !== undefined && incarnationId !== currentIncarnation) {
            return false
          }
          args.recordExit(relayPtyId, incarnationId)
          this.incarnationByRelayPtyId.delete(relayPtyId)
          this.legacyIncarnationByRelayPtyId.delete(relayPtyId)
          this.pausedRelayPtyIds.delete(relayPtyId)
          return true
        }
        args.recordExit(relayPtyId, incarnationId)
        if (currentIncarnation?.startsWith('legacy:') || currentIncarnation === undefined) {
          this.incarnationByRelayPtyId.delete(relayPtyId)
          this.legacyIncarnationByRelayPtyId.delete(relayPtyId)
          this.pausedRelayPtyIds.delete(relayPtyId)
        }
        return true
      }
    })
  }

  dispose(): void {
    this.resumePausedDeliveries()
    this.subscription?.dispose()
    this.subscription = null
    this.dataListeners.clear()
    this.replayListeners.clear()
    this.exitListeners.clear()
    this.incarnationByRelayPtyId.clear()
    this.legacyIncarnationByRelayPtyId.clear()
    this.deliveryPauseAdapter = null
  }

  onData(callback: SshPtyDataCallback): () => void {
    this.dataListeners.add(callback)
    return () => this.dataListeners.delete(callback)
  }

  onReplay(callback: SshPtyReplayCallback): () => void {
    this.replayListeners.add(callback)
    return () => this.replayListeners.delete(callback)
  }

  onExit(callback: SshPtyExitCallback): () => void {
    this.exitListeners.add(callback)
    return () => this.exitListeners.delete(callback)
  }

  setDeliveryPauseAdapter(adapter: SshPtyDeliveryPauseAdapter | null): void {
    if (adapter !== this.deliveryPauseAdapter) {
      this.resumePausedDeliveries()
    }
    this.deliveryPauseAdapter = adapter
  }

  hasDeliveryPauseAdapter(): boolean {
    return this.deliveryPauseAdapter !== null
  }

  pause(id: string): void {
    if (!this.deliveryPauseAdapter || this.pausedRelayPtyIds.has(id)) {
      return
    }
    this.pausedRelayPtyIds.add(id)
    this.deliveryPauseAdapter({ id, providerGeneration: this.providerGeneration, paused: true })
  }

  resume(id: string): void {
    if (!this.deliveryPauseAdapter || !this.pausedRelayPtyIds.delete(id)) {
      return
    }
    this.deliveryPauseAdapter({ id, providerGeneration: this.providerGeneration, paused: false })
  }

  installReceivingActivation(
    relayPtyId: string,
    activation: PtySourceReceivingActivation
  ): SshPtyReceivingActivationLease {
    if (!this.subscription) {
      throw new Error('ssh_source_receiving_activation_disposed')
    }
    return this.subscription.installReceivingActivation(relayPtyId, activation)
  }

  rememberPtyIncarnation(relayPtyId: string, incarnationId: unknown): void {
    if (!isPtyIncarnationId(incarnationId)) {
      return
    }
    const currentIncarnation = this.incarnationByRelayPtyId.get(relayPtyId)
    if (currentIncarnation === undefined || currentIncarnation.startsWith('legacy:')) {
      this.incarnationByRelayPtyId.set(relayPtyId, incarnationId)
    }
  }

  private resolvePtyIncarnation(relayPtyId: string, incarnationId: unknown): string {
    this.rememberPtyIncarnation(relayPtyId, incarnationId)
    let resolved = this.incarnationByRelayPtyId.get(relayPtyId)
    if (!resolved) {
      resolved = `legacy:${this.providerGeneration}:${this.legacyIncarnationSerial++}:${relayPtyId}`
      this.incarnationByRelayPtyId.set(relayPtyId, resolved)
      this.legacyIncarnationByRelayPtyId.set(relayPtyId, resolved)
    }
    return resolved
  }

  private resolvePtyExitIncarnation(relayPtyId: string, incarnationId: unknown): string {
    if (isPtyIncarnationId(incarnationId)) {
      this.rememberPtyIncarnation(relayPtyId, incarnationId)
      return incarnationId
    }
    const currentIncarnation = this.incarnationByRelayPtyId.get(relayPtyId)
    if (currentIncarnation?.startsWith('legacy:')) {
      return currentIncarnation
    }
    const previousLegacyIncarnation = this.legacyIncarnationByRelayPtyId.get(relayPtyId)
    if (previousLegacyIncarnation) {
      return previousLegacyIncarnation
    }
    // Why: an unversioned exit must carry synthetic evidence downstream so SSH can prove that a same-id replacement is live.
    const generated = `legacy:${this.providerGeneration}:${this.legacyIncarnationSerial++}:${relayPtyId}`
    this.legacyIncarnationByRelayPtyId.set(relayPtyId, generated)
    return generated
  }

  private resumePausedDeliveries(): void {
    const adapter = this.deliveryPauseAdapter
    if (!adapter) {
      this.pausedRelayPtyIds.clear()
      return
    }
    for (const id of this.pausedRelayPtyIds) {
      try {
        adapter({ id, providerGeneration: this.providerGeneration, paused: false })
      } catch {
        /* Generation close is the fallback cleanup proof. */
      }
    }
    this.pausedRelayPtyIds.clear()
  }
}
