// Concrete onboarding flow orchestration.
// Concrete surface implementation for use-onboarding-flow.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { applyDocumentTheme } from '@/lib/document-theme'
import { buildAgentPickedPayload } from './agent-picked-payload'
import { ONBOARDING_FINAL_STEP, ONBOARDING_FLOW_VERSION } from '../../../../shared/constants'
import {
  buildNestedRepoImportActionTelemetry,
  buildNestedRepoImportResultTelemetry,
  buildNestedRepoScanTelemetry,
  createNestedRepoTelemetryAttemptId,
  shouldEmitNestedRepoImportSubmitTelemetry,
  type NestedRepoTelemetryRuntimeKind
} from '../../../../shared/nested-repo-telemetry'
import type {
  GlobalSettings,
  NestedRepoScanResult,
  OnboardingState,
  Repo,
  TuiAgent
} from '../../../../shared/types'
import { STEPS, type StepNumber } from './use-onboarding-flow-types'
import { persistStep, useCloseWith, usePersistCurrentStep } from './use-onboarding-flow-persistence'
import { useOnboardingActionController } from './onboarding-action-controller'
import { useOnboardingSshSettingsAction } from './onboarding-ssh-settings-action'
import { useOnboardingLifecycleRoot } from './onboarding-lifecycle-root'
import { resolveOnboardingSettingsHydration } from './onboarding-settings-hydration'
import { translate } from '@/i18n/i18n'
import { resolveAgentPermissionModeSummary } from '../../../../shared/tui-agent-permissions'
import { isWindowsUserAgent } from '@/components/terminal-pane/pane-helpers'
import { buildWindowsTerminalSnapshotPayload } from './windows-terminal-onboarding-telemetry'

export { STEPS } from './use-onboarding-flow-types'
export type { StepId, StepNumber } from './use-onboarding-flow-types'

export type OnboardingFlowController = ReturnType<typeof useOnboardingFlow>

import {
  TaskSourcesSnapshotProps,
  TaskSourcesGithubStatus,
  TaskSourcesLinearStatus,
  TaskSourcesExitAction,
  shouldSkipIntegrationsStep,
  shouldSkipWindowsTerminalStep,
  OnboardingStepSkipOptions,
  isSkippedStepIndex,
  resolveStepIndex,
  createNestedRepoScanId,
  getGitHubTaskSourceStatus,
  getLinearTaskSourceStatus,
  OnboardingStepId,
  OnboardingProgressSnapshot,
  remapOpenOnboardingLastCompletedStep,
  SkippedOnboardingPreferenceOptions
} from './onboarding-flow-policy'

export function useOnboardingFlow(
  onboarding: OnboardingState,
  onOnboardingChange: (state: OnboardingState) => void,
  options: { onSettingsDetourStart?: () => void } = {}
) {
  const { onSettingsDetourStart } = options
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const refreshDetectedAgents = useAppStore((s) => s.refreshDetectedAgents)
  const detectedAgentIds = useAppStore((s) => s.detectedAgentIds)
  const isDetectingAgents = useAppStore((s) => s.isDetectingAgents || s.isRefreshingAgents)
  const pathSource = useAppStore((s) => s.pathSource)
  const pathFailureReason = useAppStore((s) => s.pathFailureReason)
  const fetchRepos = useAppStore((s) => s.fetchRepos)
  const fetchWorktrees = useAppStore((s) => s.fetchWorktrees)
  const setHideDefaultBranchWorkspace = useAppStore((s) => s.setHideDefaultBranchWorkspace)
  const addRepoPath = useAppStore((s) => s.addRepoPath)
  const scanNestedRepos = useAppStore((s) => s.scanNestedRepos)
  const cancelNestedRepoScan = useAppStore((s) => s.cancelNestedRepoScan)
  const importNestedRepos = useAppStore((s) => s.importNestedRepos)
  const openModal = useAppStore((s) => s.openModal)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const preflightStatus = useAppStore((s) => s.preflightStatus)
  const preflightStatusChecked = useAppStore((s) => s.preflightStatusChecked)
  const preflightStatusLoading = useAppStore((s) => s.preflightStatusLoading)
  const refreshPreflightStatus = useAppStore((s) => s.refreshPreflightStatus)
  const linearStatus = useAppStore((s) => s.linearStatus)
  const linearStatusChecked = useAppStore((s) => s.linearStatusChecked)
  // Why: repos are hydrated before onboarding mounts; the sync read lets the final step render added state without a flash.
  const repos = useAppStore((s) => s.repos)
  // Why: renderToStaticMarkup uses Zustand's initial snapshot; the sync read keeps tests and the first client render aligned.
  const effectivePreflightStatus = preflightStatus ?? useAppStore.getState().preflightStatus

  const skipIntegrations = shouldSkipIntegrationsStep(effectivePreflightStatus)
  const skipWindowsTerminal = shouldSkipWindowsTerminalStep(isWindowsUserAgent())
  const skipOptions = useMemo(
    () => ({ skipIntegrations, skipWindowsTerminal }),
    [skipIntegrations, skipWindowsTerminal]
  )
  const remappedLastCompletedStep = remapOpenOnboardingLastCompletedStep(onboarding)
  const initialStep = resolveStepIndex(
    Math.min(Math.max(remappedLastCompletedStep, 0), STEPS.length - 1),
    skipOptions,
    'forward'
  )
  const [stepIndex, setStepIndex] = useState(initialStep)
  const [selectedAgent, setSelectedAgent] = useState<TuiAgent | null>(
    settings?.defaultTuiAgent && settings.defaultTuiAgent !== 'blank'
      ? settings.defaultTuiAgent
      : null
  )
  const [yoloPermissions, setYoloPermissions] = useState(
    resolveAgentPermissionModeSummary({
      agentDefaultArgs: settings?.agentDefaultArgs,
      agentDefaultEnv: settings?.agentDefaultEnv
    }) !== 'manual'
  )
  // Why: hydrate theme from saved settings so users who already chose one see it preselected.
  const [theme, setTheme] = useState<GlobalSettings['theme']>(settings?.theme ?? 'dark')
  const [cloneUrl, setCloneUrl] = useState('')
  const [serverPath, setServerPath] = useState('')
  const [cloneDestination, setCloneDestination] = useState('')
  const [nestedScan, setNestedScan] = useState<NestedRepoScanResult | null>(null)
  const [nestedSelectedPaths, setNestedSelectedPaths] = useState<Set<string>>(new Set())
  const [nestedAttemptId, setNestedAttemptId] = useState<string | null>(null)
  const [nestedRuntimeKind, setNestedRuntimeKind] = useState<NestedRepoTelemetryRuntimeKind | null>(
    null
  )
  const [nestedScanInProgress, setNestedScanInProgress] = useState(false)
  const [nestedImportScanId, setNestedImportScanId] = useState<string | null>(null)
  const nestedScanIdRef = useRef<string | null>(null)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Why: settings hydrate async after the lazy initializers run; re-sync once before commit unless the user edited the field.
  const themeInteractedRef = useRef(false)
  const agentInteractedRef = useRef(false)
  const yoloPermissionsInteractedRef = useRef(false)
  const [settingsHydrated, setSettingsHydrated] = useState(settings != null)
  const settingsHydration = resolveOnboardingSettingsHydration({
    settings,
    settingsHydrated,
    themeInteracted: themeInteractedRef.current,
    agentInteracted: agentInteractedRef.current,
    currentTheme: theme,
    currentAgent: selectedAgent
  })
  if (settingsHydration) {
    setSettingsHydrated(settingsHydration.settingsHydrated)
    if (settingsHydration.theme !== undefined) {
      setTheme(settingsHydration.theme)
    }
    if (settingsHydration.selectedAgent !== undefined) {
      setSelectedAgent(settingsHydration.selectedAgent)
    }
  }
  if (settings && !yoloPermissionsInteractedRef.current) {
    const nextYoloPermissions =
      resolveAgentPermissionModeSummary({
        agentDefaultArgs: settings.agentDefaultArgs,
        agentDefaultEnv: settings.agentDefaultEnv
      }) !== 'manual'
    if (nextYoloPermissions !== yoloPermissions) {
      setYoloPermissions(nextYoloPermissions)
    }
  }

  // Why: track interaction so async settings hydration doesn't overwrite a value the user chose.
  const setThemeInteractive = useCallback((value: GlobalSettings['theme']) => {
    themeInteractedRef.current = true
    setTheme(value)
  }, [])
  // `fromCollapsedSection`: whether the picked agent lived under AgentStep's `<details>` disclosure — only that call site knows.
  const detectedAgentIdsRef = useRef<readonly TuiAgent[]>(detectedAgentIds ?? [])
  const isDetectingRef = useRef<boolean>(isDetectingAgents)
  const selectedAgentRef = useRef(selectedAgent)
  // Why: refs let the stable `setSelectedAgentInteractive` read the freshest hydration classification at click time.
  const pathSourceRef = useRef(pathSource)
  const pathFailureReasonRef = useRef(pathFailureReason)
  // Why: keep these mirrors fresh so stable handlers read current values at click/async time.
  selectedAgentRef.current = selectedAgent
  detectedAgentIdsRef.current = detectedAgentIds ?? []
  isDetectingRef.current = isDetectingAgents
  pathSourceRef.current = pathSource
  pathFailureReasonRef.current = pathFailureReason
  const setSelectedAgentInteractive = useCallback(
    (value: TuiAgent | null, fromCollapsedSection = false) => {
      agentInteractedRef.current = true
      // Why: de-dup re-clicks on the current agent so telemetry counts mind-changes, not idle reselection.
      const prev = selectedAgentRef.current
      setSelectedAgent(value)
      if (value === null || value === prev) {
        return
      }
      // Why: emit at click time (not step completion) to capture mind-changes; payload builder extracted for coverage — see agent-picked-payload.test.ts.
    },
    []
  )
  const setYoloPermissionsInteractive = useCallback((enabled: boolean) => {
    yoloPermissionsInteractedRef.current = true
    setYoloPermissions(enabled)
  }, [])

  const detectedSet = useMemo(() => new Set(detectedAgentIds ?? []), [detectedAgentIds])
  const currentStep = STEPS[stepIndex]
  // Why: the stepper shows only steps the user will land on; skipped optional steps are dropped, not rendered as dead dots.
  const progressSteps = useMemo(
    () =>
      STEPS.map((step, index) => ({ step, index })).filter(
        ({ index }) => !isSkippedStepIndex(index, skipOptions)
      ),
    [skipOptions]
  )
  // Why: while resuming, stepIndex can briefly point at a just-skipped step; resolve forward so the count reflects the landing step.
  const displayedStepIndex = resolveStepIndex(stepIndex, skipOptions, 'forward')
  const progressStepIndex = Math.max(
    0,
    progressSteps.findIndex(({ index }) => index === displayedStepIndex)
  )
  const hasExistingProject = repos.length > 0

  // Why: pin start time once so onboarding_completed reports a real funnel duration.
  const startTimeRef = useRef<number>(Date.now())

  // Why: ref so the unmount-only revert reads the freshest theme without retriggering on each settings change.
  const persistedThemeRef = useRef<GlobalSettings['theme']>(settings?.theme ?? 'dark')
  persistedThemeRef.current = settings?.theme ?? 'dark'
  const themeStepEntryThemeRef = useRef<GlobalSettings['theme'] | null>(null)
  const themeStepEntryCapturedRef = useRef(false)
  useEffect(() => {
    if (currentStep.id !== 'theme') {
      themeStepEntryCapturedRef.current = false
      return
    }
    if (!settings || themeStepEntryCapturedRef.current) {
      return
    }
    // Why: capture entry theme so "Skip to project setup" keeps the preference the user arrived with.
    themeStepEntryCapturedRef.current = true
    themeStepEntryThemeRef.current = settings.theme
  }, [currentStep.id, settings])

  // Apply preview when local theme changes.
  useEffect(() => {
    applyDocumentTheme(theme)
  }, [theme])

  useEffect(() => {
    void refreshPreflightStatus()
  }, [refreshPreflightStatus])

  const getNextStepIndex = useCallback(
    (idx: number): number => resolveStepIndex(idx + 1, skipOptions, 'forward'),
    [skipOptions]
  )

  const getPreviousStepIndex = useCallback(
    (idx: number): number => resolveStepIndex(idx - 1, skipOptions, 'backward'),
    [skipOptions]
  )

  useEffect(() => {
    if (currentStep.id !== 'integrations' || !preflightStatusChecked || !skipIntegrations) {
      return
    }
    const nextIndex = getNextStepIndex(stepIndex)
    setStepIndex(nextIndex)
    // Why: persistence must resume at the next visible step, not bounce back through skipped optional pages.
    const skippedThroughStepNumber = Math.max(
      currentStep.stepNumber,
      STEPS[nextIndex].stepNumber - 1
    )
    void persistStep(skippedThroughStepNumber).then(onOnboardingChange, (err) => {
      toast.error(
        translate(
          'auto.components.onboarding.use.onboarding.flow.52acfbef51',
          'Could not save progress'
        ),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
    })
  }, [
    currentStep.id,
    currentStep.stepNumber,
    getNextStepIndex,
    onOnboardingChange,
    preflightStatusChecked,
    skipIntegrations,
    stepIndex
  ])

  // Why: ref guard stops StrictMode's double-invoke from emitting onboarding_started twice.
  const startedTrackedRef = useRef(false)
  useEffect(() => {
    if (startedTrackedRef.current) {
      return
    }
    startedTrackedRef.current = true
    // Why: resumed_from_step is the step the user finished, not the one we resume into.
    const lastCompleted = remappedLastCompletedStep

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Why: re-pinned per step view so duration_ms measures only post-resume time; optional so a missing baseline drops the field, not the event. See docs/onboarding-telemetry-extensions.md.
  const stepStartedAtRef = useRef<number>(Date.now())
  useEffect(() => {
    stepStartedAtRef.current = Date.now()
  }, [currentStep.id, currentStep.stepNumber, currentStep.valueKind])

  const consumeStepDurationMs = useCallback((): number => {
    return Math.max(0, Date.now() - stepStartedAtRef.current)
  }, [])

  const setLifecycleRootRef = useOnboardingLifecycleRoot(persistedThemeRef)

  const trackTaskSourcesSnapshot = useCallback(
    (
      exitAction: TaskSourcesExitAction,
      durationMs: number,
      advancedVia: 'button' | 'keyboard'
    ): void => {
      // Why: one low-cardinality snapshot captures task-source usability at step exit without per-button telemetry.
    },
    [linearStatus, linearStatusChecked, preflightStatus, preflightStatusLoading]
  )

  // Why: auto-pick only on first mount; otherwise re-running would clobber/race the user's own agent selection.
  const didAutoSelectRef = useRef(false)
  useEffect(() => {
    if (didAutoSelectRef.current) {
      return
    }
    didAutoSelectRef.current = true
    // Why: re-read PATH on mount; the session cache can be poisoned by callers that ran before shell PATH hydration, giving a false "no agents" state.
    void refreshDetectedAgents().then((ids) => {
      if (selectedAgentRef.current !== null) {
        return
      }
      const preferred = getAgentCatalog().find((agent) => ids.includes(agent.id))?.id ?? null
      setSelectedAgent(preferred)
    })
  }, [refreshDetectedAgents])

  const closeWith = useCloseWith({
    onOnboardingChange,
    onboardingChecklist: onboarding.checklist,
    startTimeRef,
    setError
  })

  const persistCurrentStep = usePersistCurrentStep({
    currentStepId: currentStep.id,
    selectedAgent,
    yoloPermissions,
    theme,
    settings,
    updateSettings,
    onboardingChecklist: onboarding.checklist,
    onOnboardingChange,
    setError
  })

  // Why: sync latch; busyLabel state commits too late to stop a ~30ms Cmd+Enter auto-repeat from re-entering next() and skipping a step.
  const nextInFlightRef = useRef(false)
  const trackCurrentStepCompleted = useCallback(
    (advancedVia: 'button' | 'keyboard'): void => {
      const durationMs = consumeStepDurationMs()

      if (currentStep.id === 'integrations') {
        trackTaskSourcesSnapshot('continue', durationMs, advancedVia)
      }
      if (currentStep.id === 'windows_terminal') {
      }
    },
    [
      consumeStepDurationMs,
      currentStep.id,
      currentStep.stepNumber,
      currentStep.valueKind,
      settings,
      trackTaskSourcesSnapshot
    ]
  )
  const showNestedRepoReview = useCallback(
    (
      scan: NestedRepoScanResult,
      attemptId: string,
      runtimeKind: NestedRepoTelemetryRuntimeKind,
      inProgress = false,
      scanId: string | null = null
    ) => {
      setNestedScan(scan)
      setNestedSelectedPaths(new Set(scan.repos.map((repo) => repo.path)))
      setNestedAttemptId(attemptId)
      setNestedRuntimeKind(runtimeKind)
      setNestedScanInProgress(inProgress)
      setNestedImportScanId(scanId)
    },
    []
  )

  const onboardingNestedRepoRuntimeKind: NestedRepoTelemetryRuntimeKind =
    settings?.activeRuntimeEnvironmentId?.trim() ? 'runtime' : 'local'

  const dismissOnboarding = useCallback(
    async (advancedVia: 'button' | 'keyboard' = 'button'): Promise<boolean> => {
      if (busyLabel) {
        return false
      }
      setError(null)
      const closed = await closeWith('dismissed', {}, currentStep.stepNumber, undefined, {
        durationMs: consumeStepDurationMs(),
        advancedVia
      })
      if (closed) {
        if (nestedScan) {
          trackNestedBackAndClear()
        }
      }
      return closed
    },
    [
      busyLabel,
      closeWith,
      consumeStepDurationMs,
      currentStep.stepNumber,
      nestedScan,
      trackNestedBackAndClear
    ]
  )

  const back = useCallback(() => {
    if (nestedScan) {
      trackNestedBackAndClear()
      return
    }
    setStepIndex(getPreviousStepIndex)
  }, [getPreviousStepIndex, nestedScan, trackNestedBackAndClear])

  const jumpToStep = useCallback(
    (idx: number) => {
      if (nestedScan && idx !== stepIndex) {
        trackNestedBackAndClear()
      }
      setStepIndex(resolveStepIndex(idx, skipOptions, idx < stepIndex ? 'backward' : 'forward'))
    },
    [nestedScan, skipOptions, stepIndex, trackNestedBackAndClear]
  )

  const onboardingActions = useOnboardingActionController({
    settings,
    updateSettings,
    selectedAgent,
    themeStepEntryThemeRef,
    setTheme,
    cloneUrl,
    cloneDestination,
    serverPath,
    nestedScan,
    nestedSelectedPaths,
    nestedAttemptId,
    nestedRuntimeKind,
    nestedImportScanId,
    nestedScanIdRef,
    setNestedScan,
    setNestedSelectedPaths,
    setNestedAttemptId,
    setNestedRuntimeKind,
    setNestedScanInProgress,
    setNestedImportScanId,
    setError,
    setBusyLabel,
    busyLabel,
    repos,
    currentStep,
    stepIndex,
    setStepIndex,
    getNextStepIndex,
    nextInFlightRef,
    persistCurrentStep,
    trackCurrentStepCompleted,
    trackTaskSourcesSnapshot,
    trackNestedBackAndClear,
    showNestedRepoReview,
    closeWith,
    consumeStepDurationMs,
    fetchRepos,
    fetchWorktrees,
    setHideDefaultBranchWorkspace,
    onOnboardingChange,
    openModal,
    onSettingsDetourStart,
    openSettingsTarget,
    openSettingsPage,
    addRepoPath,
    scanNestedRepos,
    importNestedRepos,
    cancelNestedRepoScan,
    onboardingNestedRepoRuntimeKind
  })
  const {
    completeRepo,
    next,
    openFolder,
    importNested,
    clone,
    continueWithExistingProject,
    skipToRepo
  } = onboardingActions
  const openSshSettings = useOnboardingSshSettingsAction({
    busyLabel,
    setError,
    onOnboardingChange,
    currentStep,
    onSettingsDetourStart,
    openSettingsTarget,
    openSettingsPage
  })

  return {
    settings,
    updateSettings,
    stepIndex,
    progressSteps,
    progressStepIndex,
    currentStep,
    selectedAgent,
    setSelectedAgent: setSelectedAgentInteractive,
    yoloPermissions,
    setYoloPermissions: setYoloPermissionsInteractive,
    theme,
    setTheme: setThemeInteractive,
    cloneUrl,
    setCloneUrl,
    nestedScan,
    nestedScanInProgress,
    nestedSelectedPaths,
    setNestedSelectedPaths,
    importNested,
    cancelNested,
    stopNestedScan,
    canImportNestedForTelemetry,
    hasExistingProject,
    serverPath,
    setServerPath,
    cloneDestination,
    setCloneDestination,
    busyLabel,
    error,
    detectedSet,
    isDetectingAgents,
    next,
    skipToRepo,
    dismissOnboarding,
    back,
    jumpToStep,
    setLifecycleRootRef,
    openFolder,
    continueWithExistingProject,
    openSshSettings,
    clone
  }
}
