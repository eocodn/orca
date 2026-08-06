import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { parseExecutionHostId } from '../../../shared/execution-host'
import { buildExecutionHostRegistry } from '../../../shared/execution-host-registry'
import { getHostDisplayLabelOverrides } from '../../../shared/host-setting-overrides'
import { TASK_SOURCE_CONTEXT_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import {
  getTaskPageRepoSourceContext,
  getTaskSourceHostAvailabilityForHost
} from './task-page-source-context'
import {
  getRepoBackedProviderAvailability,
  type RuntimeProviderPreflightStatus
} from './task-source-provider-availability'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { PreflightStatus } from '../../../preload/api-types'
import type { Repo } from '../../../shared/types'
import type { useTaskPageStoreBindings } from './use-task-page-store-bindings'
import type { useTaskPageSourceSelection } from './use-task-page-source-selection'

type TaskPageStoreBindings = ReturnType<typeof useTaskPageStoreBindings>
type TaskPageSourceSelection = ReturnType<typeof useTaskPageSourceSelection>

export function useTaskPageProviderHosts(
  store: TaskPageStoreBindings,
  selection: TaskPageSourceSelection
) {
  const {
    settings,
    repos,
    sshConnectionStates,
    sshTargetLabels,
    runtimeEnvironments,
    runtimeStatusByEnvironmentId,
    preflightStatus,
    preflightStatusChecked
  } = store
  const { selectedRepos, taskSource } = selection

  const runtimePreflightMountedRef = useRef(true)
  const runtimePreflightRequestedHostIdsRef = useRef<Set<TaskSourceContext['hostId']>>(new Set())
  const [runtimePreflightStatusByHostId, setRuntimePreflightStatusByHostId] = useState<
    ReadonlyMap<TaskSourceContext['hostId'], RuntimeProviderPreflightStatus>
  >(() => new Map())
  useEffect(
    () => () => {
      runtimePreflightMountedRef.current = false
    },
    []
  )
  const taskSourceRepoContexts = useMemo(
    () =>
      taskSource === 'github' || taskSource === 'gitlab'
        ? selectedRepos
            .map((repo) => getTaskPageRepoSourceContext(repo, taskSource))
            .filter((context): context is TaskSourceContext => context !== null)
        : [],
    [selectedRepos, taskSource]
  )
  const hostRegistryById = useMemo(
    () =>
      new Map(
        buildExecutionHostRegistry({
          repos,
          settings,
          sshTargetLabels,
          sshConnectionStates,
          runtimeEnvironments,
          runtimeStatusByEnvironmentId,
          hostLabelOverrides: getHostDisplayLabelOverrides(settings)
        }).map((host) => [host.id, host])
      ),
    [
      repos,
      settings,
      sshConnectionStates,
      sshTargetLabels,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId
    ]
  )
  const hostLabelById = useMemo(
    () => new Map([...hostRegistryById].map(([hostId, host]) => [hostId, host.label])),
    [hostRegistryById]
  )
  const runtimeTaskSourceHostIds = useMemo(() => {
    if (taskSource !== 'github' && taskSource !== 'gitlab') {
      return []
    }
    const hostIds = new Set<TaskSourceContext['hostId']>()
    for (const context of taskSourceRepoContexts) {
      const parsed = parseExecutionHostId(context.hostId)
      if (parsed?.kind !== 'runtime') {
        continue
      }
      const host = hostRegistryById.get(context.hostId)
      if (
        host?.kind !== 'runtime' ||
        host.health !== 'available' ||
        !host.capabilities?.includes(TASK_SOURCE_CONTEXT_RUNTIME_CAPABILITY)
      ) {
        continue
      }
      hostIds.add(parsed.id)
    }
    return [...hostIds].sort()
  }, [hostRegistryById, taskSource, taskSourceRepoContexts])
  useEffect(() => {
    const unrequestedHostIds = runtimeTaskSourceHostIds.filter(
      (hostId) => !runtimePreflightRequestedHostIdsRef.current.has(hostId)
    )
    if (unrequestedHostIds.length === 0) {
      return
    }
    setRuntimePreflightStatusByHostId((current) => {
      const next = new Map(current)
      for (const hostId of unrequestedHostIds) {
        next.set(hostId, { checked: false, status: null })
      }
      return next
    })
    for (const hostId of unrequestedHostIds) {
      runtimePreflightRequestedHostIdsRef.current.add(hostId)
      const parsed = parseExecutionHostId(hostId)
      if (parsed?.kind !== 'runtime') {
        continue
      }
      // Why: task sources can span multiple runtime hosts; each runtime owns its own gh/glab install and auth state.
      void callRuntimeRpc<PreflightStatus>(
        { kind: 'environment', environmentId: parsed.environmentId },
        'preflight.check',
        undefined,
        { timeoutMs: 15_000 }
      )
        .then((status) => {
          if (!runtimePreflightMountedRef.current) {
            return
          }
          setRuntimePreflightStatusByHostId((current) => {
            const next = new Map(current)
            next.set(hostId, { checked: true, status })
            return next
          })
        })
        .catch(() => {
          if (!runtimePreflightMountedRef.current) {
            return
          }
          setRuntimePreflightStatusByHostId((current) => {
            const next = new Map(current)
            next.set(hostId, { checked: true, status: null })
            return next
          })
        })
    }
  }, [runtimeTaskSourceHostIds])
  const getTaskPickerRepoHostLabel = useCallback(
    (repo: Repo): string | null => {
      const provider = taskSource === 'gitlab' ? 'gitlab' : 'github'
      const context = getTaskPageRepoSourceContext(repo, provider)
      const hostId = context?.hostId ?? repo.executionHostId ?? 'local'
      return hostRegistryById.get(hostId)?.label ?? null
    },
    [hostRegistryById, taskSource]
  )
  const taskSourceHostAvailability = useMemo<TaskSourceHostAvailability[]>(() => {
    if (taskSource !== 'github' && taskSource !== 'gitlab') {
      return []
    }
    return [
      ...taskSourceRepoContexts.flatMap((context) => {
        const host = hostRegistryById.get(context.hostId)
        const availability = getTaskSourceHostAvailabilityForHost(host, context.hostId)
        return availability ? [availability] : []
      }),
      ...getRepoBackedProviderAvailability({
        provider: taskSource,
        contexts: taskSourceRepoContexts,
        preflightStatus,
        preflightReady: preflightStatusCurrent && preflightStatusChecked,
        runtimePreflightStatusByHostId
      })
    ]
  }, [
    hostRegistryById,
    preflightStatus,
    preflightStatusChecked,
    preflightStatusCurrent,
    runtimePreflightStatusByHostId,
    taskSource,
    taskSourceRepoContexts
  ])

  return {
    runtimePreflightStatusByHostId,
    taskSourceRepoContexts,
    hostRegistryById,
    hostLabelById,
    getTaskPickerRepoHostLabel,
    taskSourceHostAvailability
  }
}
