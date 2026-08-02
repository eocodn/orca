import { AlertTriangle, ChevronDown, Loader2, Plus, RefreshCw, Server, ServerOff, Share2, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { RuntimePairingUrlGenerator } from './RuntimePairingUrlGenerator'
import { EphemeralVmRuntimesSection } from './EphemeralVmRuntimesSection'
import { CloudVmSetupGuide } from './CloudVmSetupGuide'
import { RemoteServerUpdateStatus, getRemoteServerManualUpdateHelp } from './RemoteServerUpdateStatus'
import { RuntimeHostAccessForm } from './RuntimeHostAccessForm'
import { describeRuntimeCompatBlock } from '../../../../shared/protocol-compat'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { getUpdateCheckClickOptions } from '@/lib/update-check-click-options'
import { unwrapRuntimeRpcResult } from '@/runtime/runtime-rpc-client'
import { RuntimeEnvironmentsPaneProps } from './runtime-environments-surface'
import { getRuntimeEnvironmentsSearchEntry, getWebRuntimeEnvironmentsSearchEntry } from './runtime-environments-search'
import { evaluateHostDetails, getActiveServerModeDescription, getHostDetailsDescription, getHostDetailsSummary, getHostModelCapabilitySummary, getRuntimeCapabilitiesSummary, getRuntimeServerConnectionLabel, getRuntimeServerConnectionState, getRuntimeServerDotClass, isRuntimeEnvironmentRemovalBlocked } from './runtime-environment-details'
import { isUserManagedRuntimeEnvironment } from '../../../../shared/runtime-environments'

const LOCAL_RUNTIME_VALUE = '__local__'

type RuntimeEnvironmentConnectionWorkflowProps = Record<string, any>

export function RuntimeEnvironmentConnectionWorkflow(
  props: RuntimeEnvironmentConnectionWorkflowProps
): React.JSX.Element {
  const { settings, setActiveRuntimeEnvironmentPreference, canGeneratePairingUrl, allowLocalRuntime, addServerIntentSignal, environments, setEnvironments, isLoading, setIsLoading, isSaving, setIsSaving, detailsByEnvironmentId, setDetailsByEnvironmentId, connectingId, setConnectingId, removingId, setRemovingId, disconnectingId, setDisconnectingId, pendingSwitchValue, setPendingSwitchValue, pendingRemove, setPendingRemove, addServerFormOpen, setAddServerFormOpen, shareServerFormOpen, setShareServerFormOpen, advancedOpen, setAdvancedOpen, workflow, setWorkflow, switchError, setSwitchError, removeError, setRemoveError, name, setName, pairingCode, setPairingCode, addServerFailure, setAddServerFailure, remoteServerUpdates, remoteServerUpdatesChecking, remoteServerUpdatesRunning, refreshRemoteServerUpdates, setRemoteServerUpdateDialogOpen, consumedAddServerIntentSignalRef, mountedRef, updateCheckHint, activeValue, isBusy, removingActiveServer, searchEntry, loadEnvironments, environmentIdsKey, closeAddServerForm, addEnvironment, removeEnvironment, disconnectEnvironment, connectEnvironment, switchToValue, getEnvironmentLabel, visibleWorkflow } = props
  return (
      <div className={cn('space-y-3', visibleWorkflow !== 'connect' && 'hidden')}>
        <div
          data-settings-section="remote-server-updates"
          className="flex items-center justify-between gap-3"
        >
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-medium">
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.connectToRemoteServers',
                'Connect to remote servers'
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.connectToRemoteServersHelp',
                'Pair another Orca runtime, then connect or disconnect it here.'
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {environments.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                title={updateCheckHint}
                onClick={(event) => {
                  setRemoteServerUpdateDialogOpen(true)
                  void refreshRemoteServerUpdates(getUpdateCheckClickOptions(event))
                }}
                disabled={remoteServerUpdatesChecking && remoteServerUpdates.size === 0}
              >
                {remoteServerUpdatesChecking || remoteServerUpdatesRunning ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                {remoteServerUpdatesRunning
                  ? translate(
                      'auto.components.settings.RuntimeEnvironmentsPane.updatingServers',
                      'Updating servers…'
                    )
                  : translate(
                      'auto.components.settings.RuntimeEnvironmentsPane.reviewServerUpdates',
                      'Check for Server Updates'
                    )}
              </Button>
            ) : null}
            {addServerFormOpen ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setAddServerFormOpen(true)}
                disabled={isBusy}
              >
                <Plus />
                {translate(
                  'auto.components.settings.RuntimeEnvironmentsPane.9bee6bbeeb',
                  'Add Server'
                )}
              </Button>
            )}
          </div>
        </div>

        {addServerFormOpen ? (
          <RuntimeHostAccessForm
            name={name}
            accessLink={pairingCode}
            busy={isBusy}
            failure={addServerFailure}
            onNameChange={setName}
            onAccessLinkChange={(value) => {
              setPairingCode(value)
              setAddServerFailure(null)
            }}
            onCancel={closeAddServerForm}
            onSubmit={(allowLoopback) => void addEnvironment(allowLoopback)}
          />
        ) : null}

        <div className="rounded-lg border border-border/50 bg-card/30">
          {environments.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.9a3758d983',
                'No saved servers.'
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {environments.map((environment) => (
                <div
                  key={environment.id}
                  data-settings-section={environment.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  {(() => {
                    const details = detailsByEnvironmentId[environment.id]
                    const detailsDescription = getHostDetailsDescription(details)
                    const isActive = settings.activeRuntimeEnvironmentId === environment.id
                    const connectionState = getRuntimeServerConnectionState(details)
                    const remoteUpdate = remoteServerUpdates.get(environment.id)
                    // A connected host exposes Disconnect; otherwise Connect.
                    const isReachable = connectionState === 'connected'
                    const actionBusy =
                      connectingId === environment.id ||
                      switchingValue === environment.id ||
                      disconnectingId === environment.id ||
                      removingId === environment.id
                    return (
                      <>
                        <Server className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="truncate text-sm font-medium">{environment.name}</div>
                            <span
                              className={cn(
                                'size-2 shrink-0 rounded-full',
                                getRuntimeServerDotClass(connectionState)
                              )}
                            />
                            <span className="text-[11px] text-muted-foreground">
                              {getRuntimeServerConnectionLabel(connectionState)}
                            </span>
                            {details?.compatibility?.kind === 'blocked' ? (
                              <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                            ) : details?.status === 'loading' ? (
                              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {environment.connectionDependency === 'ssh-tunnel'
                              ? translate(
                                  'auto.components.settings.RuntimeEnvironmentsPane.sshTunnelRequired',
                                  'SSH tunnel required'
                                )
                              : isActive
                                ? translate(
                                    'auto.components.settings.RuntimeEnvironmentsPane.activeServerRowHelp',
                                    'Active server for server-routed projects, terminals, and provider checks.'
                                  )
                                : getHostDetailsSummary(details)}
                          </p>
                          {detailsDescription ? (
                            <p
                              className={cn(
                                'mt-0.5 truncate text-xs',
                                details?.compatibility?.kind === 'blocked'
                                  ? 'text-destructive'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {detailsDescription}
                            </p>
                          ) : null}
                          {remoteUpdate ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-[11px] text-muted-foreground">
                                {remoteUpdate.currentVersion
                                  ? translate(
                                      'auto.components.settings.RuntimeEnvironmentsPane.orcaVersion',
                                      'Orca v{{value0}}',
                                      { value0: remoteUpdate.currentVersion }
                                    )
                                  : translate(
                                      'auto.components.settings.RuntimeEnvironmentsPane.versionUnavailable',
                                      'Orca version unavailable'
                                    )}
                              </span>
                              <RemoteServerUpdateStatus entry={remoteUpdate} compact />
                            </div>
                          ) : null}
                          {remoteUpdate?.phase === 'manual' ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {getRemoteServerManualUpdateHelp(remoteUpdate)}
                            </p>
                          ) : null}
                          {remoteUpdate?.phase === 'failed' && remoteUpdate.error ? (
                            <p className="mt-1 text-xs text-destructive">{remoteUpdate.error}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {remoteUpdate?.phase === 'available' ||
                          remoteUpdate?.phase === 'failed' ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => setRemoteServerUpdateDialogOpen(true)}
                              disabled={remoteServerUpdatesRunning}
                            >
                              {translate(
                                'auto.components.settings.RuntimeEnvironmentsPane.updateServer',
                                'Update'
                              )}
                            </Button>
                          ) : null}
                          {isReachable ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="gap-1.5"
                              onClick={() => void disconnectEnvironment(environment)}
                              disabled={actionBusy}
                            >
                              {disconnectingId === environment.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <ServerOff className="size-3" />
                              )}
                              {translate(
                                'auto.components.settings.RuntimeEnvironmentsPane.disconnect',
                                'Disconnect'
                              )}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="gap-1.5"
                              onClick={() => void connectEnvironment(environment)}
                              disabled={actionBusy || connectionState === 'checking'}
                            >
                              {connectingId === environment.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Server className="size-3" />
                              )}
                              {translate(
                                'auto.components.settings.RuntimeEnvironmentsPane.connect',
                                'Connect'
                              )}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setRemoveError(null)
                              setPendingRemove(environment)
                            }}
                            className="size-7 text-muted-foreground hover:text-red-400"
                            disabled={isBusy}
                            aria-label={translate(
                              'auto.components.settings.RuntimeEnvironmentsPane.aeb26635d2',
                              'Remove {{value0}}',
                              { value0: environment.name }
                            )}
                          >
                            {removingId === environment.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Trash2 className="size-3" />
                            )}
                          </Button>
                        </div>
                      </>
                    )
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  )
}
