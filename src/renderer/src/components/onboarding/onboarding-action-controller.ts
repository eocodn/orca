import { getClientRuntime } from '@/runtime/client-runtime'
// Concrete onboarding flow orchestration.
// Concrete surface implementation for use-onboarding-flow.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { applyDocumentTheme } from '@/lib/document-theme'
import { track } from '@/lib/telemetry'
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

type OnboardingActionContext = Record<string, any>

export function useOnboardingActionController(context: OnboardingActionContext) {
  const {
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
    onboardingNestedRepoRuntimeKind,
  } = context

  const completeRepo = useCallback(
    async (projectId: string, isGit: boolean, path: 'open_folder' | 'clone_url') => {
      await fetchRepos()
      // Why: a non-authoritative Git refresh should still complete onboarding onto the project row as a fallback.
      await fetchWorktrees(projectId, isGit ? { requireAuthoritative: true } : undefined)
      const worktrees = useAppStore.getState().worktreesByRepo[projectId] ?? []
      if (isGit) {
        await openProjectDefaultCheckout({
          repoId: projectId,
          source: path === 'clone_url' ? 'onboarding_clone_url' : 'onboarding_open_folder',
          setHideDefaultBranchWorkspace
        })
      } else {
        const worktree = worktrees[0] ?? null
        if (worktree) {
          // Why: non-git folders skip the composer, so seed their first terminal with the chosen default agent here.
          const startup = buildOnboardingFolderAgentStartup(settings)
          activateAndRevealWorktree(worktree.id, { startup })
        }
      }
      // Why: next() short-circuits the repo step; emit step_completed here, gated on closeWith success so a persistence failure can't double-count.
      const closed = await closeWith(
        'completed',
        isGit ? { addedRepo: true } : { addedFolder: true },
        ONBOARDING_FINAL_STEP,
        path
      )
      if (!closed) {
        return
      }
      // Why: the final repo step has no keyboard-vs-button distinction, so emit duration_ms without advanced_via. See docs/onboarding-telemetry-extensions.md §3.
      track('onboarding_step_completed', {
        step: ONBOARDING_FINAL_STEP,
        value_kind: 'repo',
        duration_ms: consumeStepDurationMs()
      })
    },
    [
      closeWith,
      consumeStepDurationMs,
      fetchRepos,
      fetchWorktrees,
      setHideDefaultBranchWorkspace,
      settings
    ]
  )

  const next = useCallback(
    async (advancedVia: 'button' | 'keyboard' = 'button') => {
      if (nextInFlightRef.current || busyLabel) {
        return
      }
      nextInFlightRef.current = true
      try {
        const result = await persistCurrentStep()
        if (result.ok) {
          trackCurrentStepCompleted(advancedVia)
          if (currentStep.id === 'notifications') {
            setBusyLabel('Opening Add Project...')
            const closed = await closeWith(
              'completed',
              {},
              ONBOARDING_FINAL_STEP,
              'add_project_modal'
            )
            if (closed) {
              openModal('add-repo')
            }
            return
          }
          const nextIndex = getNextStepIndex(stepIndex)
          const skippedThroughStepNumber = STEPS[nextIndex].stepNumber - 1
          if (skippedThroughStepNumber > currentStep.stepNumber) {
            // Why: skipped optional pages must still persist progress at the next visible page.
            try {
              onOnboardingChange(await persistStep(skippedThroughStepNumber))
            } catch (err) {
              toast.error(
                translate(
                  'auto.components.onboarding.use.onboarding.flow.52acfbef51',
                  'Could not save progress'
                ),
                {
                  description: err instanceof Error ? err.message : String(err)
                }
              )
            }
          }
          setStepIndex(nextIndex)
        }
      } finally {
        setBusyLabel(null)
        nextInFlightRef.current = false
      }
    },
    [
      busyLabel,
      closeWith,
      currentStep.id,
      currentStep.stepNumber,
      getNextStepIndex,
      onOnboardingChange,
      openModal,
      persistCurrentStep,
      stepIndex,
      trackCurrentStepCompleted
    ]
  )

  const openFolder = useCallback(
    async (kind: 'git' | 'folder' = 'git') => {
      // Why: re-entry guard — rapid Cmd+Enter must not launch duplicate pickers.
      if (busyLabel !== null) {
        return
      }
      setError(null)
      if (settings?.activeRuntimeEnvironmentId?.trim()) {
        const path = serverPath.trim()
        if (!path) {
          const message = 'Enter a path on the selected host.'
          setError(message)
          return
        }
        track('onboarding_step4_path_clicked', { path: 'open_folder' })
        setBusyLabel(kind === 'git' ? 'Scanning for repositories…' : 'Opening folder…')
        try {
          if (kind === 'git') {
            const attemptId = createNestedRepoTelemetryAttemptId()
            const scan = await scanNestedRepos(path)
            track(
              'add_repo_nested_scan_result',
              buildNestedRepoScanTelemetry({
                attemptId,
                surface: 'onboarding',
                runtimeKind: 'runtime',
                scan
              })
            )
            if (scan?.selectedPathKind === 'non_git_folder' && scan.repos.length > 0) {
              showNestedRepoReview(scan, attemptId, 'runtime')
              return
            }
          }
          setBusyLabel(kind === 'git' ? 'Opening project…' : 'Opening folder…')
          const repo = await addRepoPath(path, kind)
          if (!repo) {
            track('onboarding_step4_path_failed', { path: 'open_folder', reason: 'invalid_path' })
            return
          }
          await completeRepo(repo.id, isGitRepoKind(repo), 'open_folder')
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
          track('onboarding_step4_path_failed', { path: 'open_folder', reason: 'invalid_path' })
        } finally {
          nestedScanIdRef.current = null
          setNestedScanInProgress(false)
          setBusyLabel(null)
        }
        return
      }
      track('onboarding_step4_path_clicked', { path: 'open_folder' })
      const path = await getClientRuntime().workspace.repos.pickFolder()
      if (!path) {
        track('onboarding_step4_path_failed', { path: 'open_folder', reason: 'cancelled' })
        return
      }
      setBusyLabel('Opening project…')
      try {
        let result = await getClientRuntime().workspace.repos.add({ path })
        if ('error' in result && result.error.includes('Not a valid git repository')) {
          setBusyLabel('Scanning for repositories...')
          const attemptId = createNestedRepoTelemetryAttemptId()
          const scanId = createNestedRepoScanId()
          nestedScanIdRef.current = scanId
          setNestedScanInProgress(true)
          const scan = await scanNestedRepos(path, undefined, {
            scanId,
            onProgress: (progressScan) => {
              if (
                nestedScanIdRef.current !== scanId ||
                progressScan.selectedPathKind !== 'non_git_folder' ||
                progressScan.repos.length === 0
              ) {
                return
              }
              showNestedRepoReview(progressScan, attemptId, 'local', true, scanId)
            }
          })
          if (nestedScanIdRef.current !== scanId) {
            return
          }
          nestedScanIdRef.current = null
          setNestedScanInProgress(false)
          track(
            'add_repo_nested_scan_result',
            buildNestedRepoScanTelemetry({
              attemptId,
              surface: 'onboarding',
              runtimeKind: 'local',
              scan
            })
          )
          if (scan?.selectedPathKind === 'non_git_folder' && scan.repos.length > 0) {
            showNestedRepoReview(scan, attemptId, 'local', false, scanId)
            return
          }
          result = await getClientRuntime().workspace.repos.add({ path, kind: 'folder' })
        }
        if ('error' in result) {
          throw new Error(result.error)
        }
        await completeRepo(result.repo.id, isGitRepoKind(result.repo), 'open_folder')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        track('onboarding_step4_path_failed', { path: 'open_folder', reason: 'invalid_path' })
      } finally {
        nestedScanIdRef.current = null
        setNestedScanInProgress(false)
        setBusyLabel(null)
      }
    },
    [
      addRepoPath,
      busyLabel,
      completeRepo,
      scanNestedRepos,
      serverPath,
      showNestedRepoReview,
      settings?.activeRuntimeEnvironmentId
    ]
  )

  const importNested = useCallback(async () => {
    const mode = 'separate'
    const attemptId = nestedAttemptId
    if (
      !nestedScan ||
      !attemptId ||
      !shouldEmitNestedRepoImportSubmitTelemetry({
        attemptId,
        selectedCount: nestedSelectedPaths.size,
        isBusy: busyLabel !== null
      })
    ) {
      return
    }
    const foundCount = nestedScan.repos.length
    const selectedCount = nestedSelectedPaths.size
    const runtimeKind = nestedRuntimeKind ?? onboardingNestedRepoRuntimeKind
    setError(null)
    setBusyLabel('Importing repositories…')
    track(
      'add_repo_nested_import_action',
      buildNestedRepoImportActionTelemetry({
        attemptId,
        surface: 'onboarding',
        runtimeKind,
        action: 'import_separate',
        foundCount,
        selectedCount
      })
    )
    let resultTracked = false
    try {
      const selectedProjectPaths = getSelectedNestedRepoPathsInScanOrder(
        nestedScan,
        nestedSelectedPaths
      )
      const result = await importNestedRepos({
        parentPath: nestedScan.selectedPath,
        groupName: '',
        // Why: Set insertion order can drift after deselect/reselect; match the visible scan order users reviewed.
        projectPaths: selectedProjectPaths,
        ...(nestedImportScanId ? { scanId: nestedImportScanId } : {}),
        mode
      })
      track(
        'add_repo_nested_import_result',
        buildNestedRepoImportResultTelemetry({
          attemptId,
          surface: 'onboarding',
          runtimeKind,
          mode,
          foundCount,
          selectedCount,
          result
        })
      )
      resultTracked = true
      const importedRepoIds =
        result?.projects
          .map((entry) => entry.projectId)
          .filter((projectId): projectId is string => typeof projectId === 'string') ?? []
      const projectId = importedRepoIds[0]
      if (!projectId) {
        const firstFailure = result?.projects.find((entry) => entry.status === 'failed')?.error
        throw new Error(
          firstFailure ? `No repositories imported: ${firstFailure}` : 'No repositories imported'
        )
      }
      for (const importedRepoId of importedRepoIds) {
        // Why: imported repos are already persisted, so a non-authoritative SSH refresh shouldn't block revealing the first project.
        await fetchWorktrees(importedRepoId, { requireAuthoritative: true })
      }
      await completeRepo(projectId, true, 'open_folder')
    } catch (err) {
      if (!resultTracked) {
        track(
          'add_repo_nested_import_result',
          buildNestedRepoImportResultTelemetry({
            attemptId,
            surface: 'onboarding',
            runtimeKind,
            mode,
            foundCount,
            selectedCount,
            result: null
          })
        )
      }
      setError(err instanceof Error ? err.message : String(err))
      track('onboarding_step4_path_failed', { path: 'open_folder', reason: 'invalid_path' })
    } finally {
      setBusyLabel(null)
    }
  }, [
    busyLabel,
    completeRepo,
    fetchWorktrees,
    importNestedRepos,
    nestedAttemptId,
    nestedScan,
    nestedSelectedPaths,
    nestedImportScanId,
    nestedRuntimeKind,
    onboardingNestedRepoRuntimeKind
  ])

  const clone = useCallback(async () => {
    // Why: re-entry guard — prevents Enter spamming from triggering duplicate clones.
    if (busyLabel !== null) {
      return
    }
    const trimmed = cloneUrl.trim()
    if (!trimmed || !settings) {
      return
    }
    setError(null)
    track('onboarding_step4_path_clicked', { path: 'clone_url' })
    const target = getActiveRuntimeTarget(settings)
    const destination =
      target.kind === 'environment' ? cloneDestination.trim() : settings.workspaceDir
    if (!destination) {
      const message = 'Enter a host path for the clone destination.'
      setError(message)
      return
    }
    setBusyLabel('Cloning repo…')
    try {
      const repo =
        target.kind === 'environment'
          ? (
              await callRuntimeRpc<{ repo: Repo }>(
                target,
                'repo.clone',
                { url: trimmed, destination },
                { timeoutMs: 10 * 60_000 }
              )
            ).repo
          : await getClientRuntime().workspace.repos.clone({
              url: trimmed,
              destination
            })
      await completeRepo(repo.id, true, 'clone_url')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      track('onboarding_step4_path_failed', { path: 'clone_url', reason: 'clone_failed' })
      toast.error(
        translate('auto.components.onboarding.use.onboarding.flow.fd74e7558e', 'Clone failed'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
    } finally {
      setBusyLabel(null)
    }
  }, [busyLabel, cloneDestination, cloneUrl, completeRepo, settings])

  const continueWithExistingProject = useCallback(
    async (advancedVia: 'button' | 'keyboard' = 'button') => {
      if (busyLabel !== null || repos.length === 0) {
        return
      }
      setError(null)
      setBusyLabel('Finishing...')
      try {
        const checklist = repos.some((repo) => isGitRepoKind(repo))
          ? { addedRepo: true }
          : { addedFolder: true }
        const closed = await closeWith('completed', checklist, ONBOARDING_FINAL_STEP)
        if (!closed) {
          return
        }
        track('onboarding_step_completed', {
          step: ONBOARDING_FINAL_STEP,
          value_kind: 'repo',
          duration_ms: consumeStepDurationMs(),
          advanced_via: advancedVia
        })
      } finally {
        setBusyLabel(null)
      }
    },
    [busyLabel, closeWith, consumeStepDurationMs, repos]
  )

  const skipToRepo = useCallback(async () => {
    if (busyLabel) {
      return
    }
    setError(null)
    if (currentStep.id === 'notifications') {
      return
    }
    const durationMs = consumeStepDurationMs()
    const preferencesSaved = await prepareSkippedOnboardingPreferences({
      currentStepId: currentStep.id,
      themeBeforePreview: themeStepEntryThemeRef.current,
      settingsTheme: settings?.theme,
      selectedAgent,
      setTheme,
      applyTheme: applyDocumentTheme,
      updateSettings,
      setError
    })
    if (!preferencesSaved) {
      return
    }
    const stepId = currentStep.id
    const stepNumber = currentStep.stepNumber
    const valueKind = currentStep.valueKind
    setBusyLabel('Opening Add Project...')
    try {
      const closed = await closeWith('completed', {}, ONBOARDING_FINAL_STEP, 'add_project_modal')
      if (!closed) {
        return
      }
      // Why: repo picker now lives in the Add Project dialog, so skipping optional setup closes onboarding and hands off to it.
      track('onboarding_step_skipped', {
        step: stepNumber,
        value_kind: valueKind,
        duration_ms: durationMs,
        advanced_via: 'button'
      })
      if (stepId === 'integrations') {
        trackTaskSourcesSnapshot('skip_to_project_setup', durationMs, 'button')
      }
      if (stepId === 'windows_terminal') {
        track(
          'onboarding_windows_terminal_snapshot',
          buildWindowsTerminalSnapshotPayload({
            settings,
            exitAction: 'skip_to_project_setup',
            durationMs,
            advancedVia: 'button'
          })
        )
      }
      openModal('add-repo')
    } finally {
      setBusyLabel(null)
    }
  }, [
    busyLabel,
    closeWith,
    consumeStepDurationMs,
    currentStep.id,
    currentStep.stepNumber,
    currentStep.valueKind,
    openModal,
    selectedAgent,
    settings,
    trackTaskSourcesSnapshot,
    updateSettings
  ])

  return {
    completeRepo,
    next,
    openFolder,
    importNested,
    clone,
    continueWithExistingProject,
    skipToRepo
  }
}
