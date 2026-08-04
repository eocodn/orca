// Concrete surface implementation for RuntimeEnvironmentsPane.tsx
   server selection, saved server mutation, and confirmation dialogs together so
   the state transitions stay auditable. */
import { getClientRuntime } from '@/runtime/client-runtime'
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  ServerOff,
  Share2,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { GlobalSettings } from '../../../../shared/types'
import {
  isUserManagedRuntimeEnvironment,
  type PublicKnownRuntimeEnvironment
} from '../../../../shared/runtime-environments'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import { describeRuntimeCompatBlock } from '../../../../shared/protocol-compat'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { RuntimePairingUrlGenerator } from './RuntimePairingUrlGenerator'
import { EphemeralVmRuntimesSection } from './EphemeralVmRuntimesSection'
import { CloudVmSetupGuide } from './CloudVmSetupGuide'
import {
  getRuntimeEnvironmentsSearchEntry,
  getWebRuntimeEnvironmentsSearchEntry
} from './runtime-environments-search'
import { unwrapRuntimeRpcResult } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { getUpdateCheckClickOptions, getUpdateCheckHint } from '@/lib/update-check-click-options'
import {
  getRemoteServerManualUpdateHelp,
  RemoteServerUpdateStatus
} from './RemoteServerUpdateStatus'
import { RuntimeHostAccessForm, type RuntimeHostAccessFailure } from './RuntimeHostAccessForm'
import { RuntimeEnvironmentsView } from './runtime-environments-view'
import {
  evaluateHostDetails,
  getActiveServerModeDescription,
  getHostDetailsDescription,
  getHostDetailsSummary,
  getHostModelCapabilitySummary,
  getRuntimeCapabilitiesSummary,
  getRuntimeServerConnectionLabel,
  getRuntimeServerConnectionState,
  getRuntimeServerDotClass,
  isRuntimeEnvironmentRemovalBlocked,
  type RemoteServerWorkflow,
  type RuntimeHostDetails
} from './runtime-environment-details'
export {
  evaluateHostDetails,
  getActiveServerModeDescription,
  getHostDetailsDescription,
  getHostDetailsSummary,
  getHostModelCapabilitySummary,
  getRuntimeCapabilitiesSummary,
  getRuntimeServerConnectionLabel,
  getRuntimeServerConnectionState,
  getRuntimeServerDotClass,
  isRuntimeEnvironmentRemovalBlocked
} from './runtime-environment-details'
export type { RemoteServerWorkflow, RuntimeHostDetails } from './runtime-environment-details'

const LOCAL_RUNTIME_VALUE = '__local__'
const NO_RUNTIME_VALUE = '__none__'

type RuntimeEnvironmentsPaneProps = {
  settings: GlobalSettings
  setActiveRuntimeEnvironmentPreference: (environmentId: string | null) => Promise<boolean>
  canGeneratePairingUrl?: boolean
  allowLocalRuntime?: boolean
  addServerIntentSignal?: number
}

export function RuntimeEnvironmentsPane({
  settings,
  setActiveRuntimeEnvironmentPreference,
  canGeneratePairingUrl = true,
  allowLocalRuntime = true,
  addServerIntentSignal
}: RuntimeEnvironmentsPaneProps): React.JSX.Element {
  const [environments, setEnvironments] = useState<PublicKnownRuntimeEnvironment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [detailsByEnvironmentId, setDetailsByEnvironmentId] = useState<
    Record<string, RuntimeHostDetails>
  >({})
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [switchingValue, setSwitchingValue] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [pendingSwitchValue, setPendingSwitchValue] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<PublicKnownRuntimeEnvironment | null>(null)
  const [addServerFormOpen, setAddServerFormOpen] = useState(false)
  const [shareServerFormOpen, setShareServerFormOpen] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [workflow, setWorkflow] = useState<RemoteServerWorkflow>('connect')
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [addServerFailure, setAddServerFailure] = useState<RuntimeHostAccessFailure | null>(null)
  const remoteServerUpdates = useAppStore((state) => state.remoteServerUpdates)
  const remoteServerUpdatesChecking = useAppStore((state) => state.remoteServerUpdatesChecking)
  const remoteServerUpdatesRunning = useAppStore((state) => state.remoteServerUpdatesRunning)
  const refreshRemoteServerUpdates = useAppStore((state) => state.refreshRemoteServerUpdates)
  const setRemoteServerUpdateDialogOpen = useAppStore(
    (state) => state.setRemoteServerUpdateDialogOpen
  )
  const consumedAddServerIntentSignalRef = useRef(0)
  const mountedRef = useMountedRef()
  const updateCheckHint = getUpdateCheckHint()
  const activeValue =
    settings.activeRuntimeEnvironmentId ??
    (allowLocalRuntime ? LOCAL_RUNTIME_VALUE : NO_RUNTIME_VALUE)
  const isBusy =
    isSaving ||
    connectingId !== null ||
    switchingValue !== null ||
    removingId !== null ||
    disconnectingId !== null
  const removingActiveServer = pendingRemove
    ? isRuntimeEnvironmentRemovalBlocked(settings.activeRuntimeEnvironmentId, pendingRemove.id)
    : false
  const searchEntry = canGeneratePairingUrl
    ? getRuntimeEnvironmentsSearchEntry()
    : getWebRuntimeEnvironmentsSearchEntry()

  const loadEnvironments = useCallback(
    async (verified?: { environmentId: string; runtimeStatus: RuntimeStatus }): Promise<void> => {
      if (mountedRef.current) {
        setIsLoading(true)
      }
      try {
        const nextEnvironments = await getClientRuntime().remoteHost.list()
        const visibleEnvironments = nextEnvironments.filter(isUserManagedRuntimeEnvironment)
        // Why: drop store status for servers no longer saved so stale hosts don't
        // linger in the sidebar registry.
        useAppStore.getState().setRuntimeEnvironments(nextEnvironments)
        if (verified) {
          useAppStore.getState().setRuntimeEnvironmentStatus(verified.environmentId, {
            status: verified.runtimeStatus,
            checkedAt: Date.now()
          })
        }
        if (mountedRef.current) {
          setEnvironments(visibleEnvironments)
          setDetailsByEnvironmentId((current) => {
            const next: Record<string, RuntimeHostDetails> = {}
            for (const environment of visibleEnvironments) {
              next[environment.id] =
                verified?.environmentId === environment.id
                  ? {
                      status: 'ready',
                      runtimeStatus: verified.runtimeStatus,
                      compatibility: evaluateHostDetails(verified.runtimeStatus),
                      error: null
                    }
                  : (current[environment.id] ?? {
                      status: 'loading',
                      runtimeStatus: null,
                      compatibility: null,
                      error: null
                    })
            }
            return next
          })
        }
        await Promise.allSettled(
          visibleEnvironments
            .filter((environment) => environment.id !== verified?.environmentId)
            .map(async (environment) => {
              try {
                const response = await getClientRuntime().remoteHost.getStatus({
                  selector: environment.id,
                  timeoutMs: 10_000
                })
                const runtimeStatus = unwrapRuntimeRpcResult<RuntimeStatus>(response)
                // Why: feed the live status into the store so sidebar host pickers
                // reflect manual refreshes, not just the settings pane.
                useAppStore.getState().setRuntimeEnvironmentStatus(environment.id, {
                  status: runtimeStatus,
                  checkedAt: Date.now()
                })
                if (!mountedRef.current) {
                  return
                }
                setDetailsByEnvironmentId((current) => ({
                  ...current,
                  [environment.id]: {
                    status: 'ready',
                    runtimeStatus,
                    compatibility: evaluateHostDetails(runtimeStatus),
                    error: null
                  }
                }))
              } catch (error) {
                // Why: record the failed probe (null status) so the sidebar can
                // distinguish unreachable from never-checked.
                useAppStore.getState().setRuntimeEnvironmentStatus(environment.id, {
                  status: null,
                  checkedAt: Date.now()
                })
                if (!mountedRef.current) {
                  return
                }
                setDetailsByEnvironmentId((current) => ({
                  ...current,
                  [environment.id]: {
                    status: 'error',
                    runtimeStatus: null,
                    compatibility: null,
                    error: error instanceof Error ? error.message : String(error)
                  }
                }))
              }
            })
        )
      } catch (error) {
        if (mountedRef.current) {
          toast.error(
            error instanceof Error
              ? error.message
              : translate(
                  'auto.components.settings.RuntimeEnvironmentsPane.e6410d72c3',
                  'Failed to load runtime environments.'
                )
          )
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false)
        }
      }
    },
    [mountedRef]
  )

  useEffect(() => {
    void loadEnvironments()
  }, [loadEnvironments])

  const environmentIdsKey = environments.map((environment) => environment.id).join('\n')
  useEffect(() => {
    void refreshRemoteServerUpdates()
  }, [environmentIdsKey, refreshRemoteServerUpdates])
  useEffect(() => {
    if (
      !addServerIntentSignal ||
      consumedAddServerIntentSignalRef.current === addServerIntentSignal
    ) {
      return
    }
    consumedAddServerIntentSignalRef.current = addServerIntentSignal
    // Why: composer deep-links should land on the existing pairing form, not just
    // the server list.
    setAddServerFormOpen(true)
  }, [addServerIntentSignal])

  const closeAddServerForm = (): void => {
    if (isSaving) {
      return
    }
    setAddServerFormOpen(false)
    setName('')
    setPairingCode('')
    setAddServerFailure(null)
  }

  const addEnvironment = async (allowLoopback: boolean): Promise<void> => {
    const trimmedName = name.trim()
    const trimmedPairingCode = pairingCode.trim()
    if (!trimmedName || !trimmedPairingCode) {
      toast.error(
        translate(
          'auto.components.settings.RuntimeEnvironmentsPane.0c55a47480',
          'Name and pairing code are required.'
        )
      )
      return
    }
    const duplicate = environments.find(
      (environment) => environment.name.trim().toLowerCase() === trimmedName.toLowerCase()
    )
    if (duplicate) {
      toast.error(
        translate(
          'auto.components.settings.RuntimeEnvironmentsPane.5ef712f407',
          'A server named "{{value0}}" already exists.',
          { value0: duplicate.name }
        )
      )
      return
    }
    setAddServerFailure(null)
    setIsSaving(true)
    try {
      const result = await getClientRuntime().remoteHost.verifyAndAddFromPairingCode({
        name: trimmedName,
        pairingCode: trimmedPairingCode,
        allowLoopback
      })
      if (!result.ok) {
        if (mountedRef.current) {
          setAddServerFailure({ kind: result.kind, message: result.message })
        }
        return
      }
      if (mountedRef.current) {
        setName('')
        setPairingCode('')
      }
      await loadEnvironments({
        environmentId: result.environment.id,
        runtimeStatus: result.runtimeStatus
      })
      if (!allowLocalRuntime) {
        const connected = await connectEnvironment(result.environment)
        if (!connected) {
          await getClientRuntime().remoteHost.remove({ selector: result.environment.id })
          await loadEnvironments()
          return
        }
      } else {
        if (mountedRef.current) {
          toast.success(
            translate(
              'auto.components.settings.RuntimeEnvironmentsPane.7b5986c8df',
              'Connected to {{value0}}. Use Advanced > Active Server to make it the default.',
              { value0: result.environment.name }
            )
          )
        }
      }
      if (mountedRef.current) {
        setAddServerFormOpen(false)
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.settings.RuntimeEnvironmentsPane.6cb6eae14f',
                'Failed to save runtime environment.'
              )
        )
      }
    } finally {
      if (mountedRef.current) {
        setIsSaving(false)
      }
    }
  }

  const removeEnvironment = async (
    environment: PublicKnownRuntimeEnvironment
  ): Promise<boolean> => {
    setRemovingId(environment.id)
    setRemoveError(null)
    try {
      if (isRuntimeEnvironmentRemovalBlocked(settings.activeRuntimeEnvironmentId, environment.id)) {
        if (mountedRef.current) {
          setRemoveError(
            translate(
              'auto.components.settings.RuntimeEnvironmentsPane.removeActiveServerBlocked',
              'Choose another Active Server in Advanced before removing this server.'
            )
          )
        }
        return false
      }
      await getClientRuntime().remoteHost.remove({ selector: environment.id })
      await loadEnvironments()
      if (mountedRef.current) {
        toast.success(
          translate(
            'auto.components.settings.RuntimeEnvironmentsPane.b5b5114cb0',
            'Removed {{value0}}.',
            { value0: environment.name }
          )
        )
      }
      return true
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to remove runtime environment.'
      if (mountedRef.current) {
        setRemoveError(message)
        toast.error(message)
      }
      return false
    } finally {
      if (mountedRef.current) {
        setRemovingId(null)
      }
    }
  }

  const disconnectEnvironment = async (
    environment: PublicKnownRuntimeEnvironment
  ): Promise<boolean> => {
    setDisconnectingId(environment.id)
    setSwitchError(null)
    try {
      await getClientRuntime().remoteHost.disconnect({ selector: environment.id })
      // Why: disconnect is non-destructive; keep the saved server but show the
      // user that this live client is no longer attached to it.
      useAppStore.getState().setRuntimeEnvironmentStatus(environment.id, {
        status: null,
        checkedAt: Date.now()
      })
      if (mountedRef.current) {
        setDetailsByEnvironmentId((current) => ({
          ...current,
          [environment.id]: {
            status: 'error',
            runtimeStatus: null,
            compatibility: null,
            error: null
          }
        }))
        toast.success(
          translate(
            'auto.components.settings.RuntimeEnvironmentsPane.disconnectedServer',
            'Disconnected from {{value0}}.',
            { value0: environment.name }
          )
        )
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disconnect server.'
      if (mountedRef.current) {
        setSwitchError(message)
        toast.error(message)
      }
      return false
    } finally {
      if (mountedRef.current) {
        setDisconnectingId(null)
      }
    }
  }

  const connectEnvironment = async (
    environment: PublicKnownRuntimeEnvironment
  ): Promise<boolean> => {
    setConnectingId(environment.id)
    setSwitchError(null)
    try {
      const response = await getClientRuntime().remoteHost.connect({
        selector: environment.id,
        timeoutMs: 15_000
      })
      const runtimeStatus = unwrapRuntimeRpcResult<RuntimeStatus>(response)
      const compatibility = evaluateHostDetails(runtimeStatus)
      // Why: row Connect is reachability only. The Advanced selector is the
      // explicit default-host control and should be the only active-server path.
      useAppStore.getState().setRuntimeEnvironmentStatus(environment.id, {
        status: runtimeStatus,
        checkedAt: Date.now()
      })
      if (mountedRef.current) {
        setDetailsByEnvironmentId((current) => ({
          ...current,
          [environment.id]: {
            status: 'ready',
            runtimeStatus,
            compatibility,
            error: null
          }
        }))
      }
      if (compatibility.kind === 'blocked') {
        const message = describeRuntimeCompatBlock(compatibility)
        if (mountedRef.current) {
          setSwitchError(message)
          toast.error(message)
        }
        return false
      }
      const store = useAppStore.getState()
      // Why: Connect is not the Active Server selector anymore, but connected
      // hosts should still contribute their projects/workspaces to the sidebar.
      const repos = await store.fetchRuntimeEnvironmentRepos(environment.id)
      await Promise.all(repos.map((repo) => useAppStore.getState().fetchWorktrees(repo.id)))
      await useAppStore.getState().fetchWorktreeLineage()
      if (mountedRef.current) {
        toast.success(
          translate(
            'auto.components.settings.RuntimeEnvironmentsPane.runtimeReachable',
            '{{value0}} is reachable.',
            { value0: environment.name }
          )
        )
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect server.'
      useAppStore.getState().setRuntimeEnvironmentStatus(environment.id, {
        status: null,
        checkedAt: Date.now()
      })
      if (mountedRef.current) {
        setDetailsByEnvironmentId((current) => ({
          ...current,
          [environment.id]: {
            status: 'error',
            runtimeStatus: null,
            compatibility: null,
            error: message
          }
        }))
        setSwitchError(message)
        toast.error(message)
      }
      return false
    } finally {
      if (mountedRef.current) {
        setConnectingId(null)
      }
    }
  }

  const switchToValue = async (value: string): Promise<boolean> => {
    if (value === NO_RUNTIME_VALUE) {
      return false
    }
    setSwitchingValue(value)
    setSwitchError(null)
    try {
      const switched = await setActiveRuntimeEnvironmentPreference(
        allowLocalRuntime && value === LOCAL_RUNTIME_VALUE ? null : value
      )
      if (switched) {
        if (mountedRef.current) {
          toast.success(
            translate(
              'auto.components.settings.RuntimeEnvironmentsPane.99ac81fb43',
              'Switched to {{value0}}.',
              { value0: getEnvironmentLabel(value) }
            )
          )
        }
        return true
      }
      if (mountedRef.current) {
        setSwitchError('Could not switch servers. Fix the issue and try again.')
      }
      return false
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to switch servers.'
      if (mountedRef.current) {
        setSwitchError(message)
        toast.error(message)
      }
      return false
    } finally {
      if (mountedRef.current) {
        setSwitchingValue(null)
      }
    }
  }

  const getEnvironmentLabel = (value: string): string => {
    if (value === LOCAL_RUNTIME_VALUE) {
      return 'Local desktop'
    }
    if (value === NO_RUNTIME_VALUE) {
      return 'No server connected'
    }
    return environments.find((environment) => environment.id === value)?.name ?? 'remote server'
  }
  const visibleWorkflow: RemoteServerWorkflow = addServerFormOpen ? 'connect' : workflow

  return <RuntimeEnvironmentsView settings={settings} setActiveRuntimeEnvironmentPreference={setActiveRuntimeEnvironmentPreference} canGeneratePairingUrl={canGeneratePairingUrl} allowLocalRuntime={allowLocalRuntime} addServerIntentSignal={addServerIntentSignal} environments={environments} setEnvironments={setEnvironments} isLoading={isLoading} setIsLoading={setIsLoading} isSaving={isSaving} setIsSaving={setIsSaving} detailsByEnvironmentId={detailsByEnvironmentId} setDetailsByEnvironmentId={setDetailsByEnvironmentId} connectingId={connectingId} setConnectingId={setConnectingId} switchingValue={switchingValue} setSwitchingValue={setSwitchingValue} removingId={removingId} setRemovingId={setRemovingId} disconnectingId={disconnectingId} setDisconnectingId={setDisconnectingId} pendingSwitchValue={pendingSwitchValue} setPendingSwitchValue={setPendingSwitchValue} pendingRemove={pendingRemove} setPendingRemove={setPendingRemove} addServerFormOpen={addServerFormOpen} setAddServerFormOpen={setAddServerFormOpen} shareServerFormOpen={shareServerFormOpen} setShareServerFormOpen={setShareServerFormOpen} advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen} workflow={workflow} setWorkflow={setWorkflow} switchError={switchError} setSwitchError={setSwitchError} removeError={removeError} setRemoveError={setRemoveError} name={name} setName={setName} pairingCode={pairingCode} setPairingCode={setPairingCode} addServerFailure={addServerFailure} setAddServerFailure={setAddServerFailure} remoteServerUpdates={remoteServerUpdates} remoteServerUpdatesChecking={remoteServerUpdatesChecking} remoteServerUpdatesRunning={remoteServerUpdatesRunning} refreshRemoteServerUpdates={refreshRemoteServerUpdates} setRemoteServerUpdateDialogOpen={setRemoteServerUpdateDialogOpen} consumedAddServerIntentSignalRef={consumedAddServerIntentSignalRef} mountedRef={mountedRef} updateCheckHint={updateCheckHint} activeValue={activeValue} isBusy={isBusy} removingActiveServer={removingActiveServer} searchEntry={searchEntry} loadEnvironments={loadEnvironments} environmentIdsKey={environmentIdsKey} closeAddServerForm={closeAddServerForm} addEnvironment={addEnvironment} removeEnvironment={removeEnvironment} disconnectEnvironment={disconnectEnvironment} connectEnvironment={connectEnvironment} switchToValue={switchToValue} getEnvironmentLabel={getEnvironmentLabel} visibleWorkflow={visibleWorkflow} />
}
