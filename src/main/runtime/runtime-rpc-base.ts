import { randomBytes } from 'node:crypto'


import type { RuntimeTransportMetadata } from '../../shared/runtime-bootstrap'
import type { OrcaRuntimeService } from './orca-runtime'
import { writeRuntimeMetadata } from './runtime-metadata'
import {
  RUNTIME_METADATA_OWNERSHIP_POLL_MS,
  type RuntimeMetadataOwnershipWatch
} from './runtime-metadata-ownership-watch'
import { RpcDispatcher } from './rpc/dispatcher'
import type { RpcResponse } from './rpc/core'
import { errorResponse } from './rpc/errors'
import type { RpcTransport } from './rpc/transport'



import type { WebSocket } from 'ws'
import type { DeviceRegistry} from './device-registry'
import type { E2EEKeypair } from './e2ee-keypair'
import type { UnpairedDeviceAuthThrottle } from './rpc/unpaired-device-auth-throttle'
import type {
  MobileSocketWiring} from './rpc/mobile-socket-wiring'



import {
  RelayRevokeOutbox,
  type RelayDeviceBinding,
  type RelayRevokeOutboxItem
} from './relay/relay-revoke-outbox'



import type {
  TerminalStreamFrame
} from '../../shared/terminal-stream-protocol'

import {
  DEFAULT_WS_PORT,
  LONG_POLL_CAP,
  type OrcaRuntimeRpcServerOptions,
  KEEPALIVE_INTERVAL_MS,
  type MobilePairingOffer,
  type MobileRelayPairingProvider,
  type PairingOfferUnavailable
} from './runtime-rpc-support'

export class RuntimeRpcBaseServer {
  protected readonly runtime: OrcaRuntimeService
  protected readonly dispatcher: RpcDispatcher
  protected readonly userDataPath: string
  protected readonly pid: number
  protected readonly platform: NodeJS.Platform
  protected readonly enableWebSocket: boolean
  protected readonly wsPort: number
  protected readonly preferPinnedWsPort: boolean
  protected readonly webClientRoot: string | undefined
  protected readonly authToken = randomBytes(24).toString('hex')
  protected readonly keepaliveIntervalMs: number
  protected readonly longPollCap: number
  protected readonly metadataOwnershipPollMs: number
  protected readonly relayRevokeOutbox: RelayRevokeOutbox
  protected deviceRegistry: DeviceRegistry | null = null
  protected e2eeKeypair: E2EEKeypair | null = null
  protected pairingInitializationFailure: PairingOfferUnavailable | null = null
  protected tlsFingerprint: string | null = null
  protected activeTransports: RpcTransport[] = []
  protected transports: RuntimeTransportMetadata[] = []
  protected metadataOwnershipWatch: RuntimeMetadataOwnershipWatch | null = null
  protected mobileSocketWiring: MobileSocketWiring | null = null
  protected mobileRelayPairingProvider: MobileRelayPairingProvider | null = null
  protected mobileRelayPairingOfferQueue: Promise<void> = Promise.resolve()
  protected mobileRelayPairingOfferInFlight: {
    generation: number
    address: string | null
    rotate: boolean
    request: Promise<MobilePairingOffer>
  } | null = null
  protected mobilePairingOfferGeneration = 0
  protected onUnpairedDeviceAuthFailure: (() => void) | null = null
  protected unpairedDeviceAuthThrottle: UnpairedDeviceAuthThrottle | null = null
  protected readonly binaryStreamHandlers = new Map<
    string,
    Map<number, (frame: TerminalStreamFrame) => void>
  >()
  protected readonly wsDispatchAbortStates = new Map<
    WebSocket,
    { controllers: Set<AbortController>; abortOnClose: () => void }
  >()
  // Why: separate from server.maxConnections — count only long-running dispatches, not short RPCs. See §3.1 + §7 risk #2.
  protected activeLongPolls = 0

  constructor({
    runtime,
    userDataPath,
    pid = process.pid,
    platform = process.platform,
    enableWebSocket = false,
    wsPort = DEFAULT_WS_PORT,
    preferPinnedWsPort = false,
    webClientRoot,
    keepaliveIntervalMs = KEEPALIVE_INTERVAL_MS,
    longPollCap = LONG_POLL_CAP,
    metadataOwnershipPollMs = RUNTIME_METADATA_OWNERSHIP_POLL_MS
  }: OrcaRuntimeRpcServerOptions) {
    this.runtime = runtime
    this.dispatcher = new RpcDispatcher({ runtime })
    this.userDataPath = userDataPath
    this.pid = pid
    this.platform = platform
    this.enableWebSocket = enableWebSocket
    this.wsPort = wsPort
    this.preferPinnedWsPort = preferPinnedWsPort
    this.webClientRoot = webClientRoot
    this.keepaliveIntervalMs = keepaliveIntervalMs
    this.longPollCap = longPollCap
    this.metadataOwnershipPollMs = metadataOwnershipPollMs
    this.relayRevokeOutbox = new RelayRevokeOutbox(userDataPath)
  }

  getDeviceRegistry(): DeviceRegistry | null {
    return this.deviceRegistry
  }

  getTlsFingerprint(): string | null {
    return this.tlsFingerprint
  }

  getE2EEPublicKey(): string | null {
    return this.e2eeKeypair?.publicKeyB64 ?? null
  }

  getE2EEKeypair(): E2EEKeypair | null {
    return this.e2eeKeypair
  }

  getMobileSocketWiring(): MobileSocketWiring | null {
    return this.mobileSocketWiring
  }

  getRelayRevokeOutbox(): RelayRevokeOutbox {
    return this.relayRevokeOutbox
  }

  setMobileRelayBinding(deviceId: string, binding: RelayDeviceBinding): boolean {
    const current = this.deviceRegistry?.getDevice(deviceId)
    if (
      current?.scope !== 'mobile' ||
      this.deviceRegistry?.getMobilePairingConnectionMode(deviceId) === 'local-only'
    ) {
      return false
    }
    if (
      current.relayBinding &&
      (current.relayBinding.relayHostId !== binding.relayHostId ||
        current.relayBinding.ownerIdentityKey !== binding.ownerIdentityKey)
    ) {
      // Why: switching the owning account/host must not strand the old cloud credential family, even if that account is offline.
      if (!this.queueRelayDeviceRevoke(current.relayBinding)) {
        return false
      }
    }
    const updated = this.deviceRegistry?.setRelayBinding(deviceId, binding) ?? false
    if (updated) {
      this.mobileRelayPairingProvider?.onDemandStateChanged?.()
    }
    return updated
  }

  // Why: only the desktop shell can surface UI; headless serve leaves this unset.
  setOnUnpairedDeviceAuthFailure(callback: (() => void) | null): void {
    this.onUnpairedDeviceAuthFailure = callback
  }

  setMobileRelayPairingProvider(provider: MobileRelayPairingProvider | null): void {
    this.mobileRelayPairingProvider = provider
  }

  async revokeMobileDevice(deviceId: string): Promise<boolean> {
    const device = this.deviceRegistry?.getDevice(deviceId)
    if (device?.scope !== 'mobile') {
      return false
    }
    if (device.relayBinding) {
      if (!this.queueRelayDeviceRevoke(device.relayBinding)) {
        return false
      }
    }
    if (!this.deviceRegistry?.removeDevice(deviceId)) {
      return false
    }
    this.mobileRelayPairingProvider?.onDemandStateChanged?.()
    this.runtime.forgetClientNavigationState(deviceId)
    this.mobileSocketWiring?.terminateDeviceConnections(device.token)
    return true
  }

  revokeRuntimeAccess(deviceId: string): boolean {
    const device = this.deviceRegistry?.getDevice(deviceId)
    if (device?.scope !== 'runtime' || !this.deviceRegistry?.removeDevice(deviceId)) {
      return false
    }
    this.runtime.forgetClientNavigationState(deviceId)
    this.mobileSocketWiring?.terminateDeviceConnections(device.token)
    return true
  }

  getWebSocketEndpoint(): string | null {
    const ws = this.transports.find((t) => t.kind === 'websocket')
    return ws?.endpoint ?? null
  }

  protected queueRelayDeviceRevoke(binding: RelayDeviceBinding): boolean {
    let item: RelayRevokeOutboxItem
    try {
      item = this.relayRevokeOutbox.enqueue(binding)
    } catch (error) {
      console.error('[runtime] Failed to persist Relay device cleanup:', error)
      return false
    }
    try {
      this.mobileRelayPairingProvider?.onDeviceRevokeQueued(item)
    } catch (error) {
      console.warn('[runtime] Failed to notify Relay cleanup worker:', error)
    }
    return true
  }

  protected buildError(id: string, code: string, message: string): RpcResponse {
    return errorResponse(id, { runtimeId: this.runtime.getRuntimeId() }, code, message)
  }

  protected writeMetadata(): void {
    writeRuntimeMetadata(this.userDataPath, {
      runtimeId: this.runtime.getRuntimeId(),
      pid: this.pid,
      transports: this.transports,
      authToken: this.authToken,
      startedAt: this.runtime.getStartedAt()
    })
  }


}
