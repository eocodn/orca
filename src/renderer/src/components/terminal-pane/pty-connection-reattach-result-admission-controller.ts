import type { TuiAgent } from '../../../../shared/types'
import type { ColdRestoreAgentResumeStartup } from './pty-connection-e2e-support'
import type { PtyConnectResult } from './pty-transport-types'

type ReattachResultAdmissionControllerOptions = {
  isDisposed: () => boolean
  isGenerationCurrent: (generation: number) => boolean
  getTransportPtyId: () => string | null
  rejectObsoleteDirectSshReattach: (ptyId: string | null | undefined) => boolean
  warnMissingPty: (staleSessionId: string | null) => void
  clearPaneBinding: (staleSessionId: string | null) => void
  clearTabBinding: (staleSessionId: string) => void
  startFreshColdRestore: (startup: ColdRestoreAgentResumeStartup | null) => void
  registerEffectiveLaunchConfig: (
    launchConfig: PtyConnectResult['launchConfig'],
    metadata?: { launchToken?: string; launchAgent?: TuiAgent }
  ) => void
  disconnect: () => void
  isPassiveResumeAuthority: (startup: ColdRestoreAgentResumeStartup | null | undefined) => boolean
}

type ReattachResultAdmissionArgs = {
  result: PtyConnectResult | string | void
  staleSessionId?: string | null
  coldRestoreStartup?: ColdRestoreAgentResumeStartup | null
  attemptGeneration: number
}

type ReattachResultAdmission =
  | { status: 'handled'; accepted: boolean }
  | {
      status: 'accepted'
      ptyId: string
      connectResult: PtyConnectResult | null
      hasStructuralReplay: boolean
    }

function asConnectResult(result: PtyConnectResult | string | void): PtyConnectResult | null {
  return result && typeof result === 'object' && 'id' in result ? result : null
}

export function createPtyConnectionReattachResultAdmissionController(
  options: ReattachResultAdmissionControllerOptions
) {
  const clearStaleBindings = (staleSessionId: string | null | undefined): void => {
    options.clearPaneBinding(staleSessionId ?? null)
    if (staleSessionId) {
      options.clearTabBinding(staleSessionId)
    }
  }

  const freshRestore = (
    staleSessionId: string | null | undefined,
    startup: ColdRestoreAgentResumeStartup | null | undefined
  ): ReattachResultAdmission => {
    clearStaleBindings(staleSessionId)
    options.startFreshColdRestore(startup ?? null)
    return { status: 'handled', accepted: false }
  }

  return {
    admit(args: ReattachResultAdmissionArgs): ReattachResultAdmission {
      if (options.isDisposed() || !options.isGenerationCurrent(args.attemptGeneration)) {
        return { status: 'handled', accepted: false }
      }
      const connectResult = asConnectResult(args.result)
      if (connectResult?.exitedBeforeAttach) {
        // The transport already delivered the dead session's final frame + exit.
        return { status: 'handled', accepted: true }
      }

      const retryPtyId =
        connectResult?.id ??
        (typeof args.result === 'string'
          ? args.result
          : (args.staleSessionId ?? options.getTransportPtyId()))
      if (options.rejectObsoleteDirectSshReattach(retryPtyId)) {
        return { status: 'handled', accepted: false }
      }

      const ptyId =
        connectResult?.id ??
        (typeof args.result === 'string' ? args.result : options.getTransportPtyId())
      if (!ptyId) {
        options.warnMissingPty(args.staleSessionId ?? null)
        return freshRestore(args.staleSessionId, args.coldRestoreStartup)
      }

      options.registerEffectiveLaunchConfig(connectResult?.launchConfig, {
        ...(args.coldRestoreStartup ? { launchToken: args.coldRestoreStartup.launchToken } : {}),
        ...(connectResult?.launchAgent
          ? { launchAgent: connectResult.launchAgent }
          : args.coldRestoreStartup
            ? { launchAgent: args.coldRestoreStartup.agent }
            : {})
      })
      if (connectResult?.sessionExpired) {
        return freshRestore(args.staleSessionId, args.coldRestoreStartup)
      }
      if (
        options.isDisposed() ||
        !options.isGenerationCurrent(args.attemptGeneration) ||
        options.getTransportPtyId() !== ptyId
      ) {
        return { status: 'handled', accepted: false }
      }

      const hasStructuralReplay = Boolean(
        connectResult?.snapshot || connectResult?.replay || connectResult?.coldRestore
      )
      if (
        !hasStructuralReplay &&
        connectResult?.isReattach &&
        options.isPassiveResumeAuthority(args.coldRestoreStartup)
      ) {
        // Reattach drops startup commands; passive hibernation is authority to replace the adopted shell.
        options.disconnect()
        return freshRestore(args.staleSessionId, args.coldRestoreStartup)
      }

      return { status: 'accepted', ptyId, connectResult, hasStructuralReplay }
    }
  }
}
