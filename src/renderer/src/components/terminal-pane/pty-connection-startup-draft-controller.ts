import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { sendAgentDraftPasteContent } from '@/lib/agent-draft-paste-content'
import { useAppStore } from '@/store'
import { inspectRuntimeTerminalProcess } from '@/runtime/runtime-terminal-inspection'
import { createDraftPasteReadyScanner } from '../../../../shared/draft-paste-ready-scanner'
import { isExpectedAgentProcess } from '../../../../shared/agent-process-recognition'
import {
  STARTUP_DRAFT_PASTE_QUIET_MS,
  STARTUP_DRAFT_PASTE_TIMEOUT_MS
} from './pty-connection-runtime-state'
import type { PtyConnectionDeps } from './pty-connection-types'
import type { PtyConnectionStartupState } from './pty-connection-startup-state'
import type { PtyTransport } from './pty-transport'
import { writeTerminalPastePtyInput } from './terminal-pty-paste-writer'

type StartupDraftControllerArgs = {
  pane: ManagedPane
  deps: PtyConnectionDeps
  transport: PtyTransport
  connectionId: string | null
  shouldDeliverStartupViaTerminalPaste: boolean
  startupDraftAgentConfig: PtyConnectionStartupState['startupDraftAgentConfig']
  startupDraftPrompt: string | null
  startupDraftDelivery: PtyConnectionStartupState['startupDraftDelivery']
  claimStartupDraftPasteDelivery: () => boolean
  isDisposed: () => boolean
  recordTerminalInputForHibernation: () => void
}

export function createPtyConnectionStartupDraftController({
  pane,
  deps,
  transport,
  connectionId,
  shouldDeliverStartupViaTerminalPaste,
  startupDraftAgentConfig,
  startupDraftPrompt,
  startupDraftDelivery,
  claimStartupDraftPasteDelivery,
  isDisposed,
  recordTerminalInputForHibernation
}: StartupDraftControllerArgs) {
  const ownsStartupDraftPaste = claimStartupDraftPasteDelivery()
  const startupDraftReadyScanner = ownsStartupDraftPaste
    ? createDraftPasteReadyScanner(
        startupDraftAgentConfig?.draftPasteReadySignal ?? 'render-quiet-after-bracketed-paste'
      )
    : null
  let startupDraftReadinessArmed = false
  let startupDraftPasteSettled = !ownsStartupDraftPaste
  let startupDraftPasteInFlight = false
  let startupDraftInputRecorded = false
  let startupDraftQuietTimer: ReturnType<typeof setTimeout> | null = null
  let startupDraftHardTimer: ReturnType<typeof setTimeout> | null = null

  const clearStartupDraftPasteTimers = (): void => {
    if (startupDraftQuietTimer !== null) {
      clearTimeout(startupDraftQuietTimer)
      startupDraftQuietTimer = null
    }
    if (startupDraftHardTimer !== null) {
      clearTimeout(startupDraftHardTimer)
      startupDraftHardTimer = null
    }
  }

  const getStartupDraftPtyId = (): string | null => {
    const ptyId = transport.getPtyId()
    if (
      !ptyId ||
      isDisposed() ||
      deps.paneTransportsRef.current.get(pane.id) !== transport ||
      transport.getPtyId() !== ptyId
    ) {
      return null
    }
    return ptyId
  }

  const sendStartupDraftPaste = (): void => {
    if (
      !startupDraftPrompt ||
      startupDraftPasteSettled ||
      startupDraftPasteInFlight ||
      !startupDraftReadinessArmed
    ) {
      return
    }
    const ptyId = getStartupDraftPtyId()
    if (!ptyId) {
      return
    }
    startupDraftPasteInFlight = true
    startupDraftPasteSettled = true
    startupDraftDelivery.pasteAttempted = true
    clearStartupDraftPasteTimers()
    const settings = getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), deps.worktreeId)
    // xterm focus reports share this queue; bypassing it can race CSI I against the draft.
    void sendAgentDraftPasteContent(settings, ptyId, startupDraftPrompt, async (data) => {
      const accepted = await writeTerminalPastePtyInput(transport, data)
      if (accepted && !startupDraftInputRecorded) {
        startupDraftInputRecorded = true
        recordTerminalInputForHibernation()
      }
      return accepted
    })
      .catch(() => false)
      .finally(() => {
        startupDraftPasteInFlight = false
      })
  }

  const deliverStartupDraftIfAgentOwnsPty = async (): Promise<void> => {
    if (!startupDraftAgentConfig || startupDraftPasteSettled) {
      return
    }
    const ptyId = getStartupDraftPtyId()
    if (!ptyId) {
      return
    }
    const settings = getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), deps.worktreeId)
    try {
      const process = await inspectRuntimeTerminalProcess(settings, ptyId)
      const foreground = process.foregroundProcess?.toLowerCase() ?? ''
      if (
        getStartupDraftPtyId() === ptyId &&
        isExpectedAgentProcess(foreground, startupDraftAgentConfig.expectedProcess)
      ) {
        sendStartupDraftPaste()
      }
    } catch {
      // The PTY readiness marker remains the primary path.
    }
  }

  const armStartupDraftHardTimer = (): void => {
    if (!startupDraftReadyScanner || startupDraftPasteSettled || startupDraftHardTimer !== null) {
      return
    }
    startupDraftHardTimer = setTimeout(() => {
      startupDraftHardTimer = null
      void deliverStartupDraftIfAgentOwnsPty()
    }, STARTUP_DRAFT_PASTE_TIMEOUT_MS)
  }

  const armStartupDraftQuietTimer = (): void => {
    if (!startupDraftReadyScanner || startupDraftPasteSettled) {
      return
    }
    if (startupDraftQuietTimer !== null) {
      clearTimeout(startupDraftQuietTimer)
    }
    startupDraftQuietTimer = setTimeout(() => {
      startupDraftQuietTimer = null
      sendStartupDraftPaste()
    }, STARTUP_DRAFT_PASTE_QUIET_MS)
  }

  const armStartupDraftReadinessObservation = (): void => {
    if (!startupDraftReadyScanner || startupDraftReadinessArmed) {
      return
    }
    startupDraftReadinessArmed = true
    armStartupDraftHardTimer()
  }

  const observeStartupDraftPasteReadiness = (data: string): void => {
    if (!startupDraftReadyScanner || !startupDraftReadinessArmed || startupDraftPasteSettled) {
      return
    }
    const scanned = startupDraftReadyScanner.observe(data)
    if (scanned.ready) {
      sendStartupDraftPaste()
      return
    }
    if (scanned.armQuietTimer) {
      armStartupDraftQuietTimer()
    }
  }

  if (ownsStartupDraftPaste && !connectionId && !shouldDeliverStartupViaTerminalPaste) {
    armStartupDraftReadinessObservation()
  }

  return {
    armStartupDraftReadinessObservation,
    observeStartupDraftPasteReadiness,
    dispose: clearStartupDraftPasteTimers
  }
}
