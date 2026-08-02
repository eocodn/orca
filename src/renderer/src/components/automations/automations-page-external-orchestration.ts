import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import type {
  ExternalAutomationAction,
  ExternalAutomationJob,
  ExternalAutomationManager,
  ExternalAutomationRun
} from '../../../../shared/automations-types'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import type { Repo, Worktree } from '../../../../shared/types'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { DEFAULT_TIME, getExternalAutomationKey, getExternalAutomationSourceKey, isMissingExternalRunsApiError } from './automations-page-model'
import type { AutomationDraft } from './AutomationEditorDialog'
import type { ExternalAutomationListEntry, SelectedExternalRunPage } from './automations-page-model'
import { getExternalAutomationSourceAvailability, isSshConnectionBusy } from './external-automation-source-availability'
import { getExternalProviderLabel, getExternalTargetKindLabel } from './automations-page-model'
import { isValidAutomationCronSchedule } from '../../../../shared/automation-schedules'
import type { FetchExternalAutomationRuns } from './ExternalAutomationRunTable'

type ExternalAutomationDeleteTarget = {
  manager: ExternalAutomationManager
  job: ExternalAutomationJob
}

export function buildExternalAutomationEntries(
  managers: ExternalAutomationManager[]
): ExternalAutomationListEntry[] {
  return managers.flatMap((manager): ExternalAutomationListEntry[] => {
    if (manager.jobs.length === 0) {
      if (manager.provider === 'hermes' && (manager.status === 'unavailable' || manager.error)) {
        return [{ kind: 'source', key: getExternalAutomationSourceKey(manager), manager }]
      }
      return []
    }
    return manager.jobs.map((job) => ({
      kind: 'job' as const,
      key: getExternalAutomationKey(manager, job),
      manager,
      job
    }))
  })
}

export function buildExternalAutomationEditDraft({
  fallbackTarget,
  job,
  manager,
  repoMap,
  worktreesByRepo
}: {
  fallbackTarget: { projectId: string; workspaceId: string }
  job: ExternalAutomationJob
  manager: ExternalAutomationManager
  repoMap: ReadonlyMap<string, Repo>
  worktreesByRepo: Record<string, Worktree[]>
}): AutomationDraft {
  const rawSchedule = job.rawSchedule?.trim() ?? ''
  const hasCustomSchedule = isValidAutomationCronSchedule(rawSchedule)
  const targetWorktree = Object.values(worktreesByRepo).flat().find((worktree) => {
    const repo = repoMap.get(worktree.repoId)
    const repoTargetMatches = manager.target.type === 'local' ? !repo?.connectionId : repo?.connectionId === manager.target.connectionId
    return repoTargetMatches && job.workdir !== null && worktree.path === job.workdir
  })
  const projectId = targetWorktree?.repoId ?? fallbackTarget.projectId
  const workspaceId = targetWorktree?.id ?? fallbackTarget.workspaceId
  return {
    name: job.name,
    prompt: job.prompt ?? job.promptPreview,
    agentId: 'hermes',
    projectId,
    workspaceMode: 'existing',
    workspaceId,
    baseBranch: '',
    setupDecision: undefined,
    reuseSession: false,
    precheckCommand: '',
    precheckTimeoutSeconds: '60',
    preset: hasCustomSchedule ? 'custom' : 'weekdays',
    time: DEFAULT_TIME,
    dayOfWeek: '1',
    customSchedule: hasCustomSchedule ? rawSchedule : '',
    missedRunGraceMinutes: '720',
    scheduleWarning: hasCustomSchedule ? null : 'This Hermes automation has an unsupported saved schedule. Pick a supported schedule before saving changes.'
  }
}

export function getExternalAutomationSourceSelection({
  connectingExternalSourceKey,
  selectedExternal,
  sshConnectionStates
}: {
  connectingExternalSourceKey: string | null
  selectedExternal: ExternalAutomationListEntry | null
  sshConnectionStates: ReadonlyMap<string, SshConnectionState>
}) {
  const selectedExternalSshSource = selectedExternal?.kind === 'source' && selectedExternal.manager.target.type === 'ssh'
    ? { manager: selectedExternal.manager, connectionId: selectedExternal.manager.target.connectionId, sourceKey: getExternalAutomationSourceKey(selectedExternal.manager) }
    : null
  const selectedExternalSshStatus = selectedExternalSshSource ? sshConnectionStates.get(selectedExternalSshSource.connectionId)?.status : undefined
  const selectedExternalSshConnected = selectedExternalSshStatus === 'connected'
  const isSelectedExternalSshConnecting = selectedExternalSshSource !== null && (connectingExternalSourceKey === selectedExternalSshSource.sourceKey || isSshConnectionBusy(selectedExternalSshStatus))
  const selectedExternalSourceAvailability = selectedExternal?.kind === 'source'
    ? getExternalAutomationSourceAvailability({ manager: selectedExternal.manager, providerLabel: getExternalProviderLabel(selectedExternal.manager), targetKindLabel: getExternalTargetKindLabel(selectedExternal.manager), sshStatus: selectedExternalSshStatus, isConnectingOverride: isSelectedExternalSshConnecting })
    : null
  return { selectedExternalSshSource, selectedExternalSshStatus, selectedExternalSshConnected, isSelectedExternalSshConnecting, selectedExternalSourceAvailability }
}

export function useExternalAutomationState() {
  const [externalManagers, setExternalManagers] = useState<ExternalAutomationManager[]>([])
  const [externalActionKey, setExternalActionKey] = useState<string | null>(null)
  const [selectedExternalKey, setSelectedExternalKey] = useState<string | null>(null)
  const [selectedExternalRunPage, setSelectedExternalRunPage] =
    useState<SelectedExternalRunPage | null>(null)
  const [connectingExternalSourceKey, setConnectingExternalSourceKey] = useState<string | null>(null)
  const [externalDeleteTarget, setExternalDeleteTarget] =
    useState<ExternalAutomationDeleteTarget | null>(null)
  const [editingExternalTarget, setEditingExternalTarget] =
    useState<ExternalAutomationDeleteTarget | null>(null)

  const selectExternalKey = useCallback((externalKey: string | null): void => {
    setSelectedExternalRunPage(null)
    setSelectedExternalKey(externalKey)
  }, [])

  return {
    connectingExternalSourceKey,
    editingExternalTarget,
    externalActionKey,
    externalDeleteTarget,
    externalManagers,
    selectedExternalKey,
    selectedExternalRunPage,
    selectExternalKey,
    setConnectingExternalSourceKey,
    setEditingExternalTarget,
    setExternalActionKey,
    setExternalDeleteTarget,
    setExternalManagers,
    setSelectedExternalRunPage
  }
}

type ExternalAutomationActionOptions = {
  externalDeleteTarget: ExternalAutomationDeleteTarget | null
  refresh: () => Promise<void>
  setConnectingExternalSourceKey: Dispatch<SetStateAction<string | null>>
  setExternalActionKey: Dispatch<SetStateAction<string | null>>
  setExternalDeleteTarget: Dispatch<SetStateAction<ExternalAutomationDeleteTarget | null>>
  setSelectedExternalRunPage: Dispatch<SetStateAction<SelectedExternalRunPage | null>>
  sshConnectionStates: ReadonlyMap<string, SshConnectionState>
}

export function useExternalAutomationActions({
  externalDeleteTarget,
  refresh,
  setConnectingExternalSourceKey,
  setExternalActionKey,
  setExternalDeleteTarget,
  setSelectedExternalRunPage,
  sshConnectionStates
}: ExternalAutomationActionOptions) {
  const runExternalAction = useCallback(
    async (
      manager: ExternalAutomationManager,
      job: ExternalAutomationJob,
      action: ExternalAutomationAction
    ): Promise<void> => {
      const key = `${manager.id}:${job.id}:${action}`
      setExternalActionKey(key)
      try {
        await window.api.automations.runExternalAction({
          managerId: manager.id,
          provider: manager.provider,
          target: manager.target,
          jobId: job.id,
          action
        })
        if (action === 'run') {
          useAppStore.getState().recordFeatureInteraction('automation-run')
        }
        await refresh()
        toast.success(
          action === 'delete'
            ? translate('auto.components.automations.AutomationsPage.4c22bc9913', 'External automation deleted.')
            : action === 'run'
              ? translate('auto.components.automations.AutomationsPage.4d7878402c', 'External automation queued.')
              : action === 'pause'
                ? translate('auto.components.automations.AutomationsPage.77c518a34b', 'External automation paused.')
                : translate('auto.components.automations.AutomationsPage.37288942f0', 'External automation resumed.')
        )
      } catch (error) {
        await refresh().catch(() => undefined)
        toast.error(
          error instanceof Error
            ? error.message
            : translate('auto.components.automations.AutomationsPage.126d726546', 'External automation action failed.')
        )
      } finally {
        setExternalActionKey(null)
      }
    },
    [refresh, setExternalActionKey]
  )

  const fetchExternalAutomationRuns = useCallback<FetchExternalAutomationRuns>(
    async ({ manager, job, page, pageSize }) => {
      const fallbackRunsPage = {
        runs: job.runs.slice(page * pageSize, page * pageSize + pageSize),
        totalCount: job.runCount
      }
      const listExternalRuns = (window.api.automations as Partial<Pick<typeof window.api.automations, 'listExternalRuns'>>)
        .listExternalRuns
      if (typeof listExternalRuns !== 'function') {
        return fallbackRunsPage
      }
      try {
        const result = await listExternalRuns({
          managerId: manager.id,
          provider: manager.provider,
          target: manager.target,
          jobId: job.id,
          page: page + 1,
          pageSize
        })
        return { runs: result.runs, totalCount: result.total }
      } catch (error) {
        if (isMissingExternalRunsApiError(error)) {
          return fallbackRunsPage
        }
        throw error
      }
    },
    []
  )

  const openExternalRunPage = useCallback(
    (manager: ExternalAutomationManager, job: ExternalAutomationJob, run: ExternalAutomationRun): void => {
      setSelectedExternalRunPage({ manager, job, run })
    },
    [setSelectedExternalRunPage]
  )

  const requestExternalAction = useCallback(
    (manager: ExternalAutomationManager, job: ExternalAutomationJob, action: ExternalAutomationAction): void => {
      if (action === 'delete') {
        setExternalDeleteTarget({ manager, job })
        return
      }
      void runExternalAction(manager, job, action)
    },
    [runExternalAction, setExternalDeleteTarget]
  )

  const confirmDeleteExternalAutomation = useCallback(async (): Promise<void> => {
    if (!externalDeleteTarget) {
      return
    }
    const target = externalDeleteTarget
    setExternalDeleteTarget(null)
    await runExternalAction(target.manager, target.job, 'delete')
  }, [externalDeleteTarget, runExternalAction, setExternalDeleteTarget])

  const connectExternalAutomationSource = useCallback(
    async (manager: ExternalAutomationManager): Promise<void> => {
      if (manager.target.type !== 'ssh') {
        return
      }
      const sourceKey = getExternalAutomationSourceKey(manager)
      setConnectingExternalSourceKey(sourceKey)
      try {
        if (sshConnectionStates.get(manager.target.connectionId)?.status === 'connected') {
          await refresh()
          toast.success(translate('auto.components.automations.AutomationsPage.a21f6c33ad', 'Automation source refreshed.'))
          return
        }
        const state = await window.api.ssh.connect({ targetId: manager.target.connectionId })
        if (!state || state.status !== 'connected') {
          toast.error(
            state?.error ??
              translate('auto.components.automations.AutomationsPage.7b2e285552', 'SSH connections are unavailable in this client.')
          )
          return
        }
        await refresh()
        toast.success(translate('auto.components.automations.AutomationsPage.9f2855677c', 'SSH connected.'))
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate('auto.components.automations.AutomationsPage.3e42a5cc1b', 'SSH connection failed.')
        )
      } finally {
        setConnectingExternalSourceKey(null)
      }
    },
    [refresh, setConnectingExternalSourceKey, sshConnectionStates]
  )

  return {
    confirmDeleteExternalAutomation,
    connectExternalAutomationSource,
    fetchExternalAutomationRuns,
    openExternalRunPage,
    requestExternalAction
  }
}
