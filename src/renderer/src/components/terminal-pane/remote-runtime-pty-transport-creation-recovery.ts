import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../../shared/remote-runtime-client-error-classification'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import { TERMINAL_CREATE_IDEMPOTENCY_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { unwrapRuntimeRpcResult } from '../../runtime/runtime-rpc-client'
import { REMOTE_RUNTIME_AUTO_RECOVERY_TIMEOUT_MS } from './remote-runtime-pty-recovery-state'
import type {
  RemoteAgentSessionLaunchResult,
  RemoteRuntimePtyTransportContext
} from './remote-runtime-pty-transport-session-context'

const TERMINAL_CREATE_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 15_000, 30_000] as const

export function installRemoteRuntimePtyCreationRecovery(
  context: RemoteRuntimePtyTransportContext
): void {
  context.callRuntimeForEnvironment = async <TResult>(
    environmentId: string,
    method: string,
    params?: unknown,
    timeoutMs = 15_000
  ): Promise<TResult> => {
    const response = await window.api.runtimeEnvironments.call({
      selector: environmentId,
      method,
      params,
      timeoutMs,
      expectedEnvironmentPairingRevision: context.runtimeEnvironmentPairingRevision
    })
    return unwrapRuntimeRpcResult(response as RuntimeRpcResponse<TResult>)
  }
  context.callRuntime = <TResult>(method, params, timeoutMs): Promise<TResult> =>
    context.callRuntimeForEnvironment<TResult>(
      context.currentRuntimeEnvironmentId,
      method,
      params,
      timeoutMs
    )
  context.cancelTerminalCreateRetryWait = () => {
    const waiting = context.terminalCreateRetryWait
    context.terminalCreateRetryWait = null
    if (waiting) {
      clearTimeout(waiting.timer)
      waiting.resolve(false)
    }
  }
  context.waitForTerminalCreateRetry = (delayMs) => {
    if (context.destroyed) return Promise.resolve(false)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (context.terminalCreateRetryWait?.timer === timer) {
          context.terminalCreateRetryWait = null
        }
        resolve(!context.destroyed)
      }, delayMs)
      timer.unref?.()
      context.terminalCreateRetryWait = { timer, resolve }
    })
  }
  context.terminalCreateRecoveryCutoffReached = () =>
    context.recovery.currentPhase === 'disconnected'
  context.closeRemoteTerminal = async (handleOverride, environmentId = context.currentRuntimeEnvironmentId) => {
    const targetHandle = handleOverride ?? context.handle
    if (!targetHandle) return
    try {
      await context.callRuntimeForEnvironment(environmentId, 'terminal.close', {
        terminal: targetHandle
      })
    } catch {
      // Best-effort parity with local disconnect/kill.
    }
  }
  context.createWithUnknownOutcomeRecovery = async (
    kind,
    invoke,
    environmentId,
    expectedLifecycleEpoch
  ): Promise<RemoteAgentSessionLaunchResult | null> => {
    let retryAttempt = 0
    let idempotencySupported = kind === 'agent-session'
    let reconcileExisting =
      kind === 'agent-session'
        ? context.agentSessionRequiresHostAuthorityReplay
        : context.terminalCreateNeedsReconciliation
    let recoveryDeadlineAt: number | null = context.recovery.isActive
      ? Date.now() + REMOTE_RUNTIME_AUTO_RECOVERY_TIMEOUT_MS
      : null
    let lastError: unknown =
      context.terminalCreateUnknownOutcomeError ??
      new Error('Remote terminal creation was cancelled.')
    while (
      !context.destroyed &&
      context.lifecycleEpoch === expectedLifecycleEpoch &&
      !context.terminalCreateRecoveryCutoffReached()
    ) {
      if (recoveryDeadlineAt !== null && recoveryDeadlineAt - Date.now() <= 0) break
      while (
        reconcileExisting &&
        !idempotencySupported &&
        !context.destroyed &&
        context.lifecycleEpoch === expectedLifecycleEpoch &&
        !context.terminalCreateRecoveryCutoffReached()
      ) {
        let status: RuntimeStatus
        try {
          const statusRemainingMs =
            recoveryDeadlineAt === null ? 5_000 : recoveryDeadlineAt - Date.now()
          if (statusRemainingMs <= 0) break
          status = await context.callRuntimeForEnvironment<RuntimeStatus>(
            environmentId,
            'status.get',
            undefined,
            Math.min(5_000, statusRemainingMs)
          )
        } catch (statusError) {
          const statusClientError = toRemoteRuntimeClientErrorLike(statusError)
          if (!isRecoverableRemoteRuntimeConnectionError(statusClientError)) throw statusError
          const startsRecovery = recoveryDeadlineAt === null
          recoveryDeadlineAt ??= Date.now() + REMOTE_RUNTIME_AUTO_RECOVERY_TIMEOUT_MS
          if (startsRecovery && !context.recovery.isActive) context.recovery.begin()
          const statusDelayMs =
            TERMINAL_CREATE_RETRY_DELAYS_MS[
              Math.min(retryAttempt, TERMINAL_CREATE_RETRY_DELAYS_MS.length - 1)
            ]
          retryAttempt += 1
          const remainingMs = recoveryDeadlineAt - Date.now()
          if (
            remainingMs <= 0 ||
            context.terminalCreateRecoveryCutoffReached() ||
            !(await context.waitForTerminalCreateRetry(Math.min(statusDelayMs, remainingMs)))
          ) break
          continue
        }
        if (!status.capabilities?.includes(TERMINAL_CREATE_IDEMPOTENCY_RUNTIME_CAPABILITY)) {
          throw lastError
        }
        idempotencySupported = true
      }
      if (
        context.destroyed ||
        context.lifecycleEpoch !== expectedLifecycleEpoch ||
        (recoveryDeadlineAt !== null && recoveryDeadlineAt - Date.now() <= 0)
      ) break
      const createRemainingMs = recoveryDeadlineAt === null ? null : recoveryDeadlineAt - Date.now()
      if (createRemainingMs !== null && createRemainingMs <= 0) break
      try {
        return await invoke(Math.min(15_000, createRemainingMs ?? 15_000), reconcileExisting)
      } catch (error) {
        lastError = error
        const clientError = toRemoteRuntimeClientErrorLike(error)
        if (!isRecoverableRemoteRuntimeConnectionError(clientError)) throw error
        if (kind === 'agent-session') context.agentSessionRequiresHostAuthorityReplay = true
        else context.terminalCreateNeedsReconciliation = true
        context.terminalCreateUnknownOutcomeError ??= error
        reconcileExisting = true
        const startsRecovery = recoveryDeadlineAt === null
        recoveryDeadlineAt ??= Date.now() + REMOTE_RUNTIME_AUTO_RECOVERY_TIMEOUT_MS
        if (startsRecovery && !context.recovery.isActive) context.recovery.begin()
        if (context.destroyed || context.lifecycleEpoch !== expectedLifecycleEpoch) break
        const remainingMs = recoveryDeadlineAt - Date.now()
        if (remainingMs <= 0 || context.terminalCreateRecoveryCutoffReached()) break
        const delayMs =
          TERMINAL_CREATE_RETRY_DELAYS_MS[
            Math.min(retryAttempt, TERMINAL_CREATE_RETRY_DELAYS_MS.length - 1)
          ]
        retryAttempt += 1
        if (!(await context.waitForTerminalCreateRetry(Math.min(delayMs, remainingMs)))) break
      }
    }
    return null
  }
}
