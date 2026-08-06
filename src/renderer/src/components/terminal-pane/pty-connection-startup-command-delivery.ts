import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { waitForTerminalOutputParsed } from '@/lib/pane-manager/pane-terminal-output-scheduler'
import { shouldUseShellReadyStartupDelivery } from '../../../../shared/codex-startup-delivery'
import { resolveSetupAgentSequenceLaunchCommand } from '../../../../shared/setup-agent-sequencing'
import { createShellReadyMarkerScanState } from './shell-ready-marker-scan'
import { executeTerminalStartupCommandPaste } from './terminal-startup-command-paste'
import { getTerminalPasteSshRemotePlatform } from './terminal-paste-ssh-platform'
import { resolveTerminalPasteRuntime } from './terminal-paste-runtime'
import { SSH_SHELL_READY_STARTUP_FALLBACK_MS } from './pty-connection-runtime-state'
import type { PendingStartupCommand } from './pty-connection-e2e-support'
import type { PtyConnectionDeps } from './pty-connection-types'
import type { PtyTransport } from './pty-transport'

type StartupCommandDeliveryArgs = {
  pane: ManagedPane
  deps: PtyConnectionDeps
  paneStartup: PtyConnectionDeps['startup'] | null
  connectionId: string | null
  transport: PtyTransport
  shouldDeliverStartupViaTerminalPaste: boolean
  isNativeWindowsConpty: boolean
  isDisposed: () => boolean
  armStartupDraftReadinessObservation: () => void
  releaseUnattemptedStartupDraftPasteDelivery: () => void
}

export function createPtyConnectionStartupCommandDelivery({
  pane,
  deps,
  paneStartup,
  connectionId,
  transport,
  shouldDeliverStartupViaTerminalPaste,
  isNativeWindowsConpty,
  isDisposed,
  armStartupDraftReadinessObservation,
  releaseUnattemptedStartupDraftPasteDelivery
}: StartupCommandDeliveryArgs) {
  let pendingStartupCommand: PendingStartupCommand | null =
    shouldDeliverStartupViaTerminalPaste || connectionId
      ? paneStartup?.command
        ? { command: paneStartup.command }
        : null
      : null
  const commandHint = resolveSetupAgentSequenceLaunchCommand(
    paneStartup?.env ?? {},
    paneStartup?.command
  )
  const shouldWaitForSshShellReady =
    Boolean(connectionId) &&
    shouldUseShellReadyStartupDelivery({
      command: commandHint,
      startupCommandDelivery: paneStartup?.startupCommandDelivery
    }) &&
    !shouldDeliverStartupViaTerminalPaste
  const sshShellReadyMarkerScan = shouldWaitForSshShellReady
    ? createShellReadyMarkerScanState()
    : null
  let sshStartupShellReady = !shouldWaitForSshShellReady
  let startupInjectTimer: ReturnType<typeof setTimeout> | null = null
  let sshShellReadyFallbackTimer: ReturnType<typeof setTimeout> | null = null

  const isStartupPasteTargetCurrent = (ptyId: string | null): boolean =>
    !isDisposed() &&
    deps.paneTransportsRef.current.get(pane.id) === transport &&
    transport.getPtyId() === ptyId

  const runTerminalPasteStartupCommand = async (command: string): Promise<boolean> => {
    const ptyId = transport.getPtyId()
    const result = await executeTerminalStartupCommandPaste({
      command,
      pane,
      ptyId,
      runtime: resolveTerminalPasteRuntime({
        platform: CLIENT_PLATFORM,
        ptyId,
        connectionId,
        remotePlatform: getTerminalPasteSshRemotePlatform(connectionId),
        transport,
        isWindowsConpty: isNativeWindowsConpty
      }),
      transport,
      isTargetCurrent: isStartupPasteTargetCurrent
    })
    if (result.status !== 'pasted' || !isStartupPasteTargetCurrent(ptyId)) {
      return false
    }
    return transport.sendInput('\r')
  }

  const markSshStartupShellReady = (): void => {
    if (sshStartupShellReady) {
      return
    }
    sshStartupShellReady = true
    if (sshShellReadyFallbackTimer !== null) {
      clearTimeout(sshShellReadyFallbackTimer)
      sshShellReadyFallbackTimer = null
    }
    schedulePendingStartupCommandDelivery()
  }

  const schedulePendingStartupCommandDelivery = (): void => {
    if (!pendingStartupCommand) {
      return
    }
    if (!sshStartupShellReady) {
      if (sshShellReadyFallbackTimer === null) {
        sshShellReadyFallbackTimer = setTimeout(() => {
          sshShellReadyFallbackTimer = null
          markSshStartupShellReady()
        }, SSH_SHELL_READY_STARTUP_FALLBACK_MS)
      }
      return
    }
    if (startupInjectTimer !== null) {
      clearTimeout(startupInjectTimer)
    }
    startupInjectTimer = setTimeout(() => {
      startupInjectTimer = null
      void (async () => {
        const startup = pendingStartupCommand
        if (!startup || isDisposed()) {
          return
        }
        if (shouldDeliverStartupViaTerminalPaste) {
          await waitForTerminalOutputParsed(pane.terminal)
        }
        if (pendingStartupCommand !== startup || isDisposed()) {
          return
        }
        const submitted = shouldDeliverStartupViaTerminalPaste
          ? await runTerminalPasteStartupCommand(startup.command)
          : transport.sendInput(`${startup.command}\r`)
        if (submitted) {
          armStartupDraftReadinessObservation()
        } else {
          releaseUnattemptedStartupDraftPasteDelivery()
        }
        pendingStartupCommand = null
      })()
    }, 50)
  }

  const dispose = (): void => {
    if (startupInjectTimer !== null) {
      clearTimeout(startupInjectTimer)
      startupInjectTimer = null
    }
    if (sshShellReadyFallbackTimer !== null) {
      clearTimeout(sshShellReadyFallbackTimer)
      sshShellReadyFallbackTimer = null
    }
  }

  return {
    sshShellReadyMarkerScan,
    markSshStartupShellReady,
    schedulePendingStartupCommandDelivery,
    hasPendingStartupCommand: () => pendingStartupCommand !== null,
    setPendingStartupCommand(command: PendingStartupCommand | null) {
      pendingStartupCommand = command
    },
    dispose
  }
}
