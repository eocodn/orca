// Concrete surface implementation for use-onboarding-flow.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { applyDocumentTheme } from '@/lib/document-theme'
import { getSelectedNestedRepoPathsInScanOrder } from '@/lib/nested-repo-selected-paths'
import { buildAgentPickedPayload } from './agent-picked-payload'
import { ONBOARDING_FINAL_STEP, ONBOARDING_FLOW_VERSION } from '../../../../shared/constants'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import {
  buildNestedRepoImportActionTelemetry,
  buildNestedRepoImportResultTelemetry,
  buildNestedRepoScanTelemetry,
  createNestedRepoTelemetryAttemptId,
  shouldEmitNestedRepoImportSubmitTelemetry,
  type NestedRepoTelemetryRuntimeKind
} from '../../../../shared/nested-repo-telemetry'
import type { EventProps } from '../../../../shared/telemetry-events'
import type {
  GlobalSettings,
  NestedRepoScanResult,
  OnboardingState,
  Repo,
  TuiAgent
} from '../../../../shared/types'
import { STEPS, type StepNumber } from './use-onboarding-flow-types'
import { persistStep, useCloseWith, usePersistCurrentStep } from './use-onboarding-flow-persistence'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { buildOnboardingFolderAgentStartup } from '@/lib/onboarding-folder-agent-startup'
import { resolveOnboardingSettingsHydration } from './onboarding-settings-hydration'
import { openProjectDefaultCheckout } from '../sidebar/project-added-default-checkout'
import { translate } from '@/i18n/i18n'
import { resolveAgentPermissionModeSummary } from '../../../../shared/tui-agent-permissions'
import { isWindowsUserAgent } from '@/components/terminal-pane/pane-helpers'
import { buildWindowsTerminalSnapshotPayload } from './windows-terminal-onboarding-telemetry'

export type TaskSourcesSnapshotProps = EventProps<'onboarding_task_sources_snapshot'>
export type TaskSourcesGithubStatus = TaskSourcesSnapshotProps['github_status']
export type TaskSourcesLinearStatus = TaskSourcesSnapshotProps['linear_status']
export type TaskSourcesExitAction = TaskSourcesSnapshotProps['exit_action']

export function shouldSkipIntegrationsStep(
  status: ReturnType<typeof useAppStore.getState>['preflightStatus']
): boolean {
  return status?.gh.installed === true
}

export function shouldSkipWindowsTerminalStep(isWindows: boolean): boolean {
  return !isWindows
}

export type OnboardingStepSkipOptions = {
  skipIntegrations: boolean
  skipWindowsTerminal: boolean
}

export function isSkippedStepIndex(index: number, options: OnboardingStepSkipOptions): boolean {
  const step = STEPS[index]
  return (
    (options.skipIntegrations && step?.id === 'integrations') ||
    (options.skipWindowsTerminal && step?.id === 'windows_terminal')
  )
}

export function resolveStepIndex(
  index: number,
  skipOptions: OnboardingStepSkipOptions,
  direction: 'forward' | 'backward'
): number {
  const lastIndex = STEPS.length - 1
  let nextIndex = Math.min(Math.max(index, 0), lastIndex)
  while (isSkippedStepIndex(nextIndex, skipOptions)) {
    const candidate = nextIndex + (direction === 'forward' ? 1 : -1)
    if (candidate < 0 || candidate > lastIndex) {
      return direction === 'forward' ? lastIndex : 0
    }
    nextIndex = candidate
  }
  return nextIndex
}

export function createNestedRepoScanId(): string {
  return `nested-repo-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function getGitHubTaskSourceStatus(
  status: ReturnType<typeof useAppStore.getState>['preflightStatus'],
  loading: boolean
): TaskSourcesGithubStatus {
  if (loading || !status) {
    return 'checking'
  }
  if (!status.gh.installed) {
    return 'not_installed'
  }
  return status.gh.authenticated ? 'connected' : 'not_authenticated'
}

export function getLinearTaskSourceStatus(
  status: ReturnType<typeof useAppStore.getState>['linearStatus'],
  checked: boolean
): TaskSourcesLinearStatus {
  if (status.connected) {
    return 'connected'
  }
  return checked ? 'not_connected' : 'checking'
}

export type OnboardingStepId = (typeof STEPS)[number]['id']

export type OnboardingProgressSnapshot = Pick<
  OnboardingState,
  'flowVersion' | 'lastCompletedStep' | 'outcome'
>

export function remapOpenOnboardingLastCompletedStep({
  flowVersion,
  lastCompletedStep,
  outcome
}: OnboardingProgressSnapshot): number {
  if (flowVersion === ONBOARDING_FLOW_VERSION) {
    return lastCompletedStep
  }
  if (outcome === 'completed' && lastCompletedStep >= 4) {
    return ONBOARDING_FINAL_STEP
  }
  // Why: in v3 (four-step, pre-Windows-terminal) step 4 already meant notifications, so resume there.
  if (flowVersion === 3) {
    return Math.min(4, lastCompletedStep)
  }
  // Why: v2 (five-step) and older seven-step data used step 4 for removed agent setup, not integrations.
  if (flowVersion === 2) {
    if (lastCompletedStep === 3) {
      return 2
    }
    if (lastCompletedStep >= 4) {
      return 3
    }
    return lastCompletedStep
  }
  if (lastCompletedStep === 3) {
    return 2
  }
  if (lastCompletedStep === 4) {
    return 2
  }
  if (lastCompletedStep >= 5) {
    return 3
  }
  return lastCompletedStep
}

export type SkippedOnboardingPreferenceOptions = {
  currentStepId: OnboardingStepId
  themeBeforePreview: GlobalSettings['theme'] | null
  settingsTheme: GlobalSettings['theme'] | undefined
  selectedAgent: TuiAgent | null
  setTheme: (theme: GlobalSettings['theme']) => void
  applyTheme: (theme: GlobalSettings['theme']) => void
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void> | void
  setError: (message: string | null) => void
}

export async function prepareSkippedOnboardingPreferences({
  currentStepId,
  themeBeforePreview,
  settingsTheme,
  selectedAgent,
  setTheme,
  applyTheme,
  updateSettings,
  setError
}: SkippedOnboardingPreferenceOptions): Promise<boolean> {
  try {
    // Why: theme tiles save immediately for a stable preview, but skip must not keep this step's choice.
    if (currentStepId === 'theme') {
      const themeToRestore = themeBeforePreview ?? settingsTheme
      if (themeToRestore) {
        setTheme(themeToRestore)
        applyTheme(themeToRestore)
        await updateSettings({ theme: themeToRestore })
      }
    }
    // Why: the repo step seeds folder terminals from saved settings, so preserve the visible agent choice on skip.
    if (currentStepId === 'agent' && selectedAgent) {
      await updateSettings({ defaultTuiAgent: selectedAgent })
    }
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setError(message)
    toast.error(
      translate(
        'auto.components.onboarding.use.onboarding.flow.52acfbef51',
        'Could not save progress'
      ),
      { description: message }
    )
    return false
  }
}
