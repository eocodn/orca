import type { TuiAgent } from '../../../../shared/types'
import type {
  ColdRestoreAgentResumeStartup,
  PendingStartupCommand
} from './pty-connection-e2e-support'
import type { SessionRestoredBannerReason } from './session-restored-banner-pane-state'
import type { PtyConnectResult, PtyTransport } from './pty-transport'

type CapturedTransportOutputCallbacks = {
  generation: number
  callbacks: Parameters<PtyTransport['connect']>[0]['callbacks']
}

type FreshSpawnTransport = Pick<PtyTransport, 'connect' | 'getPtyId'>

type PtyConnectionFreshSpawnControllerArgs = {
  transport: FreshSpawnTransport
  cacheKey: string
  runtimeEnvironmentId: string | null
  cols: number
  rows: number
  captureTransportOutputCallbacks: (
    onError: (message: string) => void
  ) => CapturedTransportOutputCallbacks
  getTransportStreamGeneration: () => number
  setConnectInFlightSince: (value: number | null) => void
  mergeStartupEnvWithPaneIdentity: (
    env: Record<string, string> | undefined
  ) => Record<string, string> | undefined
  shouldDeclareHiddenAtSpawn: () => boolean
  claimCapturedDirectSshRetryPty: (ptyId: string) => boolean
  declarePendingPaneSerializer: (cacheKey: string) => Promise<number | null>
  clearPendingPaneSerializer: (cacheKey: string, generation: number) => Promise<void>
  settlePaneSerializer: (cacheKey: string, generation: number) => Promise<void>
  registerEffectiveLaunchConfig: (
    launchConfig: PtyConnectResult['launchConfig'],
    metadata?: { launchToken?: string; launchAgent?: TuiAgent }
  ) => void
  hasPaneStartupLaunchConfig: () => boolean
  clearRegisteredStartupLaunchConfig: () => void
  writeStartupCwdFallbackNotice: () => void
  showSessionRestoredBanner: (reason?: SessionRestoredBannerReason) => void
  clearSleepingRecordAfterColdRestoreSpawn: (startup: ColdRestoreAgentResumeStartup | null) => void
  getActivePanePtyBinding: () => string | null
  bindActivePanePty: (ptyId: string) => void
  reconcileSpawnedPtySize: (ptyId: string, cols: number, rows: number) => void
  isRemoteRuntimePtyId: (ptyId: string) => boolean
  hasPtySerializer: (ptyId: string) => boolean
  registerPaneSerializerFor: (ptyId: string) => void
  hasConnection: () => boolean
  schedulePendingStartupCommandDelivery: () => void
  reportError: (message: string) => void
}

function isConnectResult(result: void | string | PtyConnectResult): result is PtyConnectResult {
  return Boolean(result && typeof result === 'object' && 'id' in result)
}

export function createPtyConnectionFreshSpawnController({
  transport,
  cacheKey,
  runtimeEnvironmentId,
  cols,
  rows,
  captureTransportOutputCallbacks,
  getTransportStreamGeneration,
  setConnectInFlightSince,
  mergeStartupEnvWithPaneIdentity,
  shouldDeclareHiddenAtSpawn,
  claimCapturedDirectSshRetryPty,
  declarePendingPaneSerializer,
  clearPendingPaneSerializer,
  settlePaneSerializer,
  registerEffectiveLaunchConfig,
  hasPaneStartupLaunchConfig,
  clearRegisteredStartupLaunchConfig,
  writeStartupCwdFallbackNotice,
  showSessionRestoredBanner,
  clearSleepingRecordAfterColdRestoreSpawn,
  getActivePanePtyBinding,
  bindActivePanePty,
  reconcileSpawnedPtySize,
  isRemoteRuntimePtyId,
  hasPtySerializer,
  registerPaneSerializerFor,
  hasConnection,
  schedulePendingStartupCommandDelivery,
  reportError
}: PtyConnectionFreshSpawnControllerArgs) {
  const clearSerializer = async (generation: number | null): Promise<void> => {
    if (typeof generation === 'number') {
      await clearPendingPaneSerializer(cacheKey, generation).catch(() => {})
    }
  }

  const spawn = (startupOverride?: PendingStartupCommand | null): Promise<string | null> => {
    const coldRestoreOverride =
      startupOverride && 'launchConfig' in startupOverride
        ? (startupOverride as ColdRestoreAgentResumeStartup)
        : null
    const hasLaunchConfig = hasPaneStartupLaunchConfig() || Boolean(coldRestoreOverride)
    const preSignalPromise = runtimeEnvironmentId
      ? Promise.resolve(null)
      : declarePendingPaneSerializer(cacheKey).catch(() => null)
    const outputCallbacks = captureTransportOutputCallbacks(reportError)
    setConnectInFlightSince(Date.now())
    const spawnedRaw = transport.connect({
      url: '',
      cols,
      rows,
      ...(startupOverride?.command ? { command: startupOverride.command } : {}),
      ...(startupOverride?.env
        ? { env: mergeStartupEnvWithPaneIdentity(startupOverride.env) }
        : {}),
      ...(coldRestoreOverride ? { launchConfig: coldRestoreOverride.launchConfig } : {}),
      ...(coldRestoreOverride
        ? { resumeProviderSession: coldRestoreOverride.resumeProviderSession }
        : {}),
      ...(coldRestoreOverride ? { launchToken: coldRestoreOverride.launchToken } : {}),
      ...(coldRestoreOverride ? { launchAgent: coldRestoreOverride.agent } : {}),
      ...(shouldDeclareHiddenAtSpawn() ? { initiallyHidden: true } : {}),
      callbacks: outputCallbacks.callbacks
    })
    void Promise.resolve(spawnedRaw)
      .catch(() => null)
      .finally(() => {
        setConnectInFlightSince(null)
      })

    return Promise.resolve(spawnedRaw)
      .then(async (result) => {
        if (outputCallbacks.generation !== getTransportStreamGeneration()) {
          await clearSerializer(await preSignalPromise)
          return null
        }
        const resolvedPtyId = isConnectResult(result)
          ? result.id
          : typeof result === 'string'
            ? result
            : transport.getPtyId()
        if (resolvedPtyId && !claimCapturedDirectSshRetryPty(resolvedPtyId)) {
          return null
        }
        if (isConnectResult(result)) {
          registerEffectiveLaunchConfig(result.launchConfig, {
            ...(coldRestoreOverride ? { launchToken: coldRestoreOverride.launchToken } : {}),
            ...(coldRestoreOverride ? { launchAgent: coldRestoreOverride.agent } : {})
          })
        }
        if (resolvedPtyId) {
          if (isConnectResult(result) && result.startupCwdFallback?.kind === 'worktree') {
            writeStartupCwdFallbackNotice()
          }
          if (isConnectResult(result) && result.agentResumeUnavailable) {
            showSessionRestoredBanner('resume-unavailable')
          } else if (coldRestoreOverride?.hasSleepingRecord) {
            showSessionRestoredBanner()
          }
          clearSleepingRecordAfterColdRestoreSpawn(coldRestoreOverride)
        } else if (hasLaunchConfig) {
          clearRegisteredStartupLaunchConfig()
        }
        if (
          resolvedPtyId &&
          isConnectResult(result) &&
          getActivePanePtyBinding() !== resolvedPtyId &&
          transport.getPtyId() === resolvedPtyId
        ) {
          bindActivePanePty(resolvedPtyId)
        }
        if (resolvedPtyId) {
          reconcileSpawnedPtySize(resolvedPtyId, cols, rows)
        }
        const serializerGeneration = await preSignalPromise
        if (
          resolvedPtyId &&
          (typeof serializerGeneration === 'number' || isRemoteRuntimePtyId(resolvedPtyId))
        ) {
          if (!isRemoteRuntimePtyId(resolvedPtyId) || !hasPtySerializer(resolvedPtyId)) {
            registerPaneSerializerFor(resolvedPtyId)
          }
          if (typeof serializerGeneration === 'number') {
            await settlePaneSerializer(cacheKey, serializerGeneration).catch(() => {})
          }
        } else {
          await clearSerializer(serializerGeneration)
        }
        if (resolvedPtyId && hasConnection()) {
          schedulePendingStartupCommandDelivery()
        }
        return resolvedPtyId
      })
      .catch(async () => {
        if (hasLaunchConfig) {
          clearRegisteredStartupLaunchConfig()
        }
        await clearSerializer(await preSignalPromise)
        return null
      })
  }

  return { spawn }
}
