import { getClientRuntime } from '../../runtime/client-runtime'
import type { ColdRestoreAgentResumeStartup } from './pty-connection-e2e-support'
import type { DirectSshRetryLease } from './pty-connection-direct-ssh-retry-controller'
import { isRemoteRuntimePtyId, isSshSessionExpiredError } from './pty-connection-routing-policy'
import type { PtyConnectResult, PtyTransport } from './pty-transport'

type CapturedTransportOutputCallbacks = {
  generation: number
  callbacks: Parameters<PtyTransport['connect']>[0]['callbacks']
}

type ReattachAttemptControllerArgs = {
  transport: PtyTransport
  cacheKey: string
  runtimeEnvironmentId: string | null
  cols: number
  rows: number
  captureTransportOutputCallbacks: (
    onError: (message: string) => void
  ) => CapturedTransportOutputCallbacks
  getTransportStreamGeneration: () => number
  beginLiveDataDeferral: (generation: number) => void
  finishLiveDataDeferral: (deliver: boolean, generation: number) => void
  handleReattachResult: (
    result: PtyConnectResult | string | void,
    sessionId: string,
    coldRestoreStartup: ColdRestoreAgentResumeStartup | null,
    generation: number
  ) => Promise<boolean>
  settlePaneSerializerAfterReplay: (ptyId: string, generation: number) => Promise<void>
  mergeStartupEnvWithPaneIdentity: (env: Record<string, string>) => Record<string, string>
  shouldDeclareHiddenAtSpawn: () => boolean
  directSshRetryAttempt: DirectSshRetryLease | undefined
  claimCapturedDirectSshRetryPty: (ptyId: string) => boolean
  armDirectSshPaneRetryTimeout: (
    promise: Promise<unknown>,
    attempt: DirectSshRetryLease | undefined
  ) => void
  setConnectInFlightSince: (value: number | null) => void
}

export type ReattachAttemptOptions = {
  sessionId: string
  coldRestoreStartup: ColdRestoreAgentResumeStartup | null
  onTransportError: (message: string) => void
  onExpired: () => void | Promise<void>
  onRejected: (error: unknown, generation: number) => void | Promise<void>
  onResult?: (result: PtyConnectResult | string | void) => void
}

export function createPtyConnectionReattachAttemptController({
  transport,
  cacheKey,
  runtimeEnvironmentId,
  cols,
  rows,
  captureTransportOutputCallbacks,
  getTransportStreamGeneration,
  beginLiveDataDeferral,
  finishLiveDataDeferral,
  handleReattachResult,
  settlePaneSerializerAfterReplay,
  mergeStartupEnvWithPaneIdentity,
  shouldDeclareHiddenAtSpawn,
  directSshRetryAttempt,
  claimCapturedDirectSshRetryPty,
  armDirectSshPaneRetryTimeout,
  setConnectInFlightSince
}: ReattachAttemptControllerArgs) {
  const declareSerializer = (sessionId: string): Promise<number | null> =>
    runtimeEnvironmentId || isRemoteRuntimePtyId(sessionId)
      ? Promise.resolve(null)
      : getClientRuntime()
          .terminal.declarePendingPaneSerializer(cacheKey)
          .catch(() => null)

  const clearSerializer = async (preSignalPromise: Promise<number | null>): Promise<void> => {
    const generation = await preSignalPromise
    if (typeof generation === 'number') {
      void getClientRuntime()
        .terminal.clearPendingPaneSerializer(cacheKey, generation)
        .catch(() => {})
    }
  }

  const settleSerializer = async (
    preSignalPromise: Promise<number | null>,
    accepted: boolean,
    result: PtyConnectResult | string | void,
    sessionId: string
  ): Promise<void> => {
    const generation = await preSignalPromise
    if (typeof generation !== 'number') {
      return
    }
    if (!accepted) {
      await getClientRuntime()
        .terminal.clearPendingPaneSerializer(cacheKey, generation)
        .catch(() => {})
      return
    }
    if (isRemoteRuntimePtyId(sessionId)) {
      return
    }
    const settledPtyId =
      result && typeof result === 'object' && 'id' in result
        ? result.id
        : (transport.getPtyId() ?? sessionId)
    const hasRestorePayload =
      result &&
      typeof result === 'object' &&
      ('snapshot' in result || 'replay' in result || 'coldRestore' in result)
    await (hasRestorePayload
      ? settlePaneSerializerAfterReplay(settledPtyId, generation)
      : getClientRuntime().terminal.settlePaneSerializer(cacheKey, generation))
  }

  const attempt = ({
    sessionId,
    coldRestoreStartup,
    onTransportError,
    onExpired,
    onRejected,
    onResult
  }: ReattachAttemptOptions): Promise<void> => {
    const preSignalPromise = declareSerializer(sessionId)
    let expiredReattachError = false
    const outputCallbacks = captureTransportOutputCallbacks((message) => {
      if (isSshSessionExpiredError(message)) {
        expiredReattachError = true
        return
      }
      onTransportError(message)
    })
    beginLiveDataDeferral(outputCallbacks.generation)
    setConnectInFlightSince(Date.now())
    const reattachPromise = transport.connect({
      url: '',
      cols,
      rows,
      sessionId,
      ...(coldRestoreStartup?.command ? { command: coldRestoreStartup.command } : {}),
      ...(coldRestoreStartup?.env
        ? { env: mergeStartupEnvWithPaneIdentity(coldRestoreStartup.env) }
        : {}),
      ...(coldRestoreStartup?.launchConfig
        ? { launchConfig: coldRestoreStartup.launchConfig }
        : {}),
      ...(coldRestoreStartup?.resumeProviderSession
        ? { resumeProviderSession: coldRestoreStartup.resumeProviderSession }
        : {}),
      ...(coldRestoreStartup?.launchToken ? { launchToken: coldRestoreStartup.launchToken } : {}),
      ...(coldRestoreStartup?.agent ? { launchAgent: coldRestoreStartup.agent } : {}),
      ...(shouldDeclareHiddenAtSpawn() ? { initiallyHidden: true } : {}),
      ...(directSshRetryAttempt ? { admitPtyId: claimCapturedDirectSshRetryPty } : {}),
      callbacks: outputCallbacks.callbacks
    })

    void Promise.resolve(reattachPromise)
      .catch(() => null)
      .finally(() => {
        setConnectInFlightSince(null)
      })
    const trackedPromise = Promise.resolve(reattachPromise)
      .then(async (result) => {
        if (outputCallbacks.generation !== getTransportStreamGeneration()) {
          finishLiveDataDeferral(false, outputCallbacks.generation)
          await clearSerializer(preSignalPromise)
          return
        }
        onResult?.(result)
        if (!result && expiredReattachError) {
          finishLiveDataDeferral(false, outputCallbacks.generation)
          await clearSerializer(preSignalPromise)
          await onExpired()
          return
        }
        const accepted = await handleReattachResult(
          result,
          sessionId,
          coldRestoreStartup,
          outputCallbacks.generation
        )
        finishLiveDataDeferral(accepted, outputCallbacks.generation)
        await settleSerializer(preSignalPromise, accepted, result, sessionId)
      })
      .catch(async (error) => {
        finishLiveDataDeferral(false, outputCallbacks.generation)
        await clearSerializer(preSignalPromise)
        await onRejected(error, outputCallbacks.generation)
      })
    armDirectSshPaneRetryTimeout(trackedPromise, directSshRetryAttempt)
    return trackedPromise
  }

  return { attempt }
}
