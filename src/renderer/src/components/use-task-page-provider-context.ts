import { useMemo } from 'react'
import { getSettingsFocusedExecutionHostId } from '../../../shared/execution-host'
import {
  getTaskSourceCacheScope,
  normalizeTaskSourceContext
} from '../../../shared/task-source-context'
import type { TaskProvider } from '../../../shared/types'
import {
  getTaskSourceAvailabilityNotice,
  getTaskSourceContextSummary,
  type TaskSourceAvailabilityNotice,
  type TaskSourceHostAvailability
} from './task-source-context-summary'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import { getTaskPageRepoSourceContext } from './task-page-source-context'
import type { useTaskPageStoreBindings } from './use-task-page-store-bindings'
import type { useTaskPageSourceSelection } from './use-task-page-source-selection'
import { useTaskPageProviderHosts } from './use-task-page-provider-hosts'

type TaskPageStoreBindings = ReturnType<typeof useTaskPageStoreBindings>
type TaskPageSourceSelection = ReturnType<typeof useTaskPageSourceSelection>

export function useTaskPageProviderContext(
  store: TaskPageStoreBindings,
  selection: TaskPageSourceSelection
) {
  const { settings, preflightStatus, preflightStatusChecked, linearListInvalidationToken } = store
  const {
    providerRuntimeContextKey,
    preflightStatusCurrent,
    selectedRepos,
    selectedLinearWorkspaceId,
    selectedLinearWorkspace,
    selectedJiraSiteId,
    selectedJiraSite,
    sourceOptions,
    taskSource
  } = selection

  const {
    runtimePreflightStatusByHostId,
    taskSourceRepoContexts,
    hostRegistryById,
    hostLabelById,
    getTaskPickerRepoHostLabel,
    taskSourceHostAvailability
  } = useTaskPageProviderHosts(store, selection)
  const accountBackedTaskSourceHostId = useMemo(
    () => getSettingsFocusedExecutionHostId(settings),
    [settings]
  )
  const fallbackTaskSourceProjectId = useMemo(() => {
    const firstRepoContext = selectedRepos
      .map((repo) => getTaskPageRepoSourceContext(repo, 'github'))
      .find((context): context is TaskSourceContext => context !== null)
    return firstRepoContext?.projectId ?? 'account-backed-task-source'
  }, [selectedRepos])
  const linearTaskSourceContext = useMemo(
    () =>
      normalizeTaskSourceContext({
        provider: 'linear',
        projectId: fallbackTaskSourceProjectId,
        hostId: accountBackedTaskSourceHostId,
        providerIdentity: {
          provider: 'linear',
          workspaceId:
            selectedLinearWorkspaceId && selectedLinearWorkspaceId !== 'all'
              ? selectedLinearWorkspaceId
              : null,
          workspaceName:
            selectedLinearWorkspace?.organizationName ??
            selectedLinearWorkspace?.displayName ??
            null
        },
        accountLabel:
          selectedLinearWorkspace?.organizationName ?? selectedLinearWorkspace?.displayName ?? null
      }),
    [
      accountBackedTaskSourceHostId,
      fallbackTaskSourceProjectId,
      selectedLinearWorkspace,
      selectedLinearWorkspaceId
    ]
  )
  // Why: only react to invalidation tokens for this TaskPage source scope.
  const linearListInvalidationVersionForSource = useMemo(() => {
    const scope = linearTaskSourceContext
      ? getTaskSourceCacheScope(linearTaskSourceContext)
      : 'local'
    return linearListInvalidationToken.scope === scope ? linearListInvalidationToken.version : 0
  }, [linearListInvalidationToken, linearTaskSourceContext])
  const jiraTaskSourceContext = useMemo(
    () =>
      normalizeTaskSourceContext({
        provider: 'jira',
        projectId: fallbackTaskSourceProjectId,
        hostId: accountBackedTaskSourceHostId,
        providerIdentity: {
          provider: 'jira',
          siteId: selectedJiraSiteId && selectedJiraSiteId !== 'all' ? selectedJiraSiteId : null,
          siteUrl: selectedJiraSite?.siteUrl ?? null
        },
        accountLabel: selectedJiraSite?.displayName ?? selectedJiraSite?.siteUrl ?? null
      }),
    [
      accountBackedTaskSourceHostId,
      fallbackTaskSourceProjectId,
      selectedJiraSite,
      selectedJiraSiteId
    ]
  )
  const jiraTaskSourceScopeKey = jiraTaskSourceContext
    ? getTaskSourceCacheScope(jiraTaskSourceContext)
    : providerRuntimeContextKey
  const accountBackedTaskSourceHostAvailability = useMemo<TaskSourceHostAvailability[]>(() => {
    if (taskSource !== 'linear' && taskSource !== 'jira') {
      return []
    }
    const host = hostRegistryById.get(accountBackedTaskSourceHostId)
    const availability = getTaskSourceHostAvailabilityForHost(host, accountBackedTaskSourceHostId)
    return availability ? [availability] : []
  }, [accountBackedTaskSourceHostId, hostRegistryById, taskSource])
  const taskSourceAvailabilityNoticeByProvider = useMemo<
    Partial<Record<TaskProvider, TaskSourceAvailabilityNotice>>
  >(() => {
    const availabilityForContexts = (
      provider: Extract<TaskProvider, 'github' | 'gitlab'>,
      contexts: readonly TaskSourceContext[]
    ): TaskSourceHostAvailability[] => [
      ...contexts.flatMap((context) => {
        const host = hostRegistryById.get(context.hostId)
        const availability = getTaskSourceHostAvailabilityForHost(host, context.hostId)
        return availability ? [availability] : []
      }),
      ...getRepoBackedProviderAvailability({
        provider,
        contexts,
        preflightStatus,
        preflightReady: preflightStatusCurrent && preflightStatusChecked,
        runtimePreflightStatusByHostId
      })
    ]
    const accountHost = hostRegistryById.get(accountBackedTaskSourceHostId)
    const accountHostAvailability = getTaskSourceHostAvailabilityForHost(
      accountHost,
      accountBackedTaskSourceHostId
    )
    const accountAvailability = accountHostAvailability ? [accountHostAvailability] : []
    const labelFor = (provider: TaskProvider): string =>
      sourceOptions.find((source) => source.id === provider)?.label ?? provider
    return {
      github:
        getTaskSourceAvailabilityNotice({
          providerLabel: labelFor('github'),
          sourceCount: selectedRepos.length,
          hostLabelById,
          hostAvailability: availabilityForContexts(
            'github',
            selectedRepos
              .map((repo) => getTaskPageRepoSourceContext(repo, 'github'))
              .filter((context): context is TaskSourceContext => context !== null)
          )
        }) ?? undefined,
      gitlab:
        getTaskSourceAvailabilityNotice({
          providerLabel: labelFor('gitlab'),
          sourceCount: selectedRepos.length,
          hostLabelById,
          hostAvailability: availabilityForContexts(
            'gitlab',
            selectedRepos
              .map((repo) => getTaskPageRepoSourceContext(repo, 'gitlab'))
              .filter((context): context is TaskSourceContext => context !== null)
          )
        }) ?? undefined,
      linear:
        getTaskSourceAvailabilityNotice({
          providerLabel: labelFor('linear'),
          sourceCount: 1,
          hostLabelById,
          hostAvailability: accountAvailability
        }) ?? undefined,
      jira:
        getTaskSourceAvailabilityNotice({
          providerLabel: labelFor('jira'),
          sourceCount: 1,
          hostLabelById,
          hostAvailability: accountAvailability
        }) ?? undefined
    }
  }, [
    accountBackedTaskSourceHostId,
    hostRegistryById,
    hostLabelById,
    preflightStatus,
    preflightStatusChecked,
    preflightStatusCurrent,
    runtimePreflightStatusByHostId,
    selectedRepos,
    sourceOptions
  ])
  const taskSourceContextSummary = useMemo(() => {
    const providerLabel =
      sourceOptions.find((source) => source.id === taskSource)?.label ?? taskSource
    return getTaskSourceContextSummary({
      provider: taskSource,
      providerLabel,
      repoContexts: taskSourceRepoContexts,
      hostAvailability:
        taskSource === 'linear' || taskSource === 'jira'
          ? accountBackedTaskSourceHostAvailability
          : taskSourceHostAvailability,
      accountHostId: accountBackedTaskSourceHostId,
      hostLabelById,
      selectedRepoCount: selectedRepos.length,
      linearWorkspaceName:
        selectedLinearWorkspace?.organizationName ?? selectedLinearWorkspace?.id ?? null,
      jiraSiteName: selectedJiraSite?.displayName ?? selectedJiraSite?.siteUrl ?? null
    })
  }, [
    selectedJiraSite,
    selectedLinearWorkspace,
    selectedRepos.length,
    sourceOptions,
    taskSource,
    accountBackedTaskSourceHostAvailability,
    accountBackedTaskSourceHostId,
    hostLabelById,
    taskSourceHostAvailability,
    taskSourceRepoContexts
  ])
  const taskSourceAvailabilityNotice = useMemo(() => {
    const providerLabel =
      sourceOptions.find((source) => source.id === taskSource)?.label ?? taskSource
    return getTaskSourceAvailabilityNotice({
      providerLabel,
      sourceCount:
        taskSource === 'linear' || taskSource === 'jira'
          ? 1
          : Math.max(1, taskSourceRepoContexts.length),
      hostAvailability:
        taskSource === 'linear' || taskSource === 'jira'
          ? accountBackedTaskSourceHostAvailability
          : taskSourceHostAvailability,
      hostLabelById
    })
  }, [
    accountBackedTaskSourceHostAvailability,
    hostLabelById,
    sourceOptions,
    taskSource,
    taskSourceHostAvailability,
    taskSourceRepoContexts.length
  ])

  return {
    runtimePreflightStatusByHostId,
    taskSourceRepoContexts,
    hostRegistryById,
    hostLabelById,
    getTaskPickerRepoHostLabel,
    taskSourceHostAvailability,
    accountBackedTaskSourceHostId,
    fallbackTaskSourceProjectId,
    linearTaskSourceContext,
    linearListInvalidationVersionForSource,
    jiraTaskSourceContext,
    jiraTaskSourceScopeKey,
    accountBackedTaskSourceHostAvailability,
    taskSourceAvailabilityNoticeByProvider,
    taskSourceContextSummary,
    taskSourceAvailabilityNotice
  }
}
