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
import { getRuntimeEnvironmentsSearchEntry, getWebRuntimeEnvironmentsSearchEntry } from './runtime-environments-search'
import { evaluateHostDetails, getActiveServerModeDescription, getHostDetailsDescription, getHostDetailsSummary, getHostModelCapabilitySummary, getRuntimeCapabilitiesSummary, getRuntimeServerConnectionLabel, getRuntimeServerConnectionState, getRuntimeServerDotClass, isRuntimeEnvironmentRemovalBlocked } from './runtime-environment-details'
import { isUserManagedRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { RuntimeEnvironmentConnectionWorkflow } from './runtime-environment-connection-workflow'

const LOCAL_RUNTIME_VALUE = '__local__'
const NO_RUNTIME_VALUE = '__none__'

import type React from 'react'

type RuntimeEnvironmentsViewProps = Record<string, any>

export function RuntimeEnvironmentsView(props: RuntimeEnvironmentsViewProps): React.JSX.Element {
  const { settings, setActiveRuntimeEnvironmentPreference, canGeneratePairingUrl, allowLocalRuntime, addServerIntentSignal, environments, setEnvironments, isLoading, setIsLoading, isSaving, setIsSaving, detailsByEnvironmentId, setDetailsByEnvironmentId, connectingId, setConnectingId, switchingValue, setSwitchingValue, removingId, setRemovingId, disconnectingId, setDisconnectingId, pendingSwitchValue, setPendingSwitchValue, pendingRemove, setPendingRemove, addServerFormOpen, setAddServerFormOpen, shareServerFormOpen, setShareServerFormOpen, advancedOpen, setAdvancedOpen, workflow, setWorkflow, switchError, setSwitchError, removeError, setRemoveError, name, setName, pairingCode, setPairingCode, addServerFailure, setAddServerFailure, remoteServerUpdates, remoteServerUpdatesChecking, remoteServerUpdatesRunning, refreshRemoteServerUpdates, setRemoteServerUpdateDialogOpen, consumedAddServerIntentSignalRef, mountedRef, updateCheckHint, activeValue, isBusy, removingActiveServer, searchEntry, loadEnvironments, environmentIdsKey, closeAddServerForm, addEnvironment, removeEnvironment, disconnectEnvironment, connectEnvironment, switchToValue, getEnvironmentLabel, visibleWorkflow } = props
  return (
    <SearchableSetting
      title={searchEntry.title}
      description={searchEntry.description}
      keywords={searchEntry.keywords}
      className="space-y-4 py-2"
    >
      <div
        role="group"
        aria-label={translate(
          'auto.components.settings.RuntimeEnvironmentsPane.workflow',
          'Remote server workflow'
        )}
        className={cn('grid gap-2 sm:grid-cols-2', canGeneratePairingUrl && 'sm:grid-cols-3')}
      >
        {(
          [
            [
              'connect',
              translate(
                'auto.components.settings.RuntimeEnvironmentsPane.connectWorkflow',
                'Connect to a host'
              ),
              translate(
                'auto.components.settings.RuntimeEnvironmentsPane.connectWorkflowHelp',
                'This app joins another machine'
              )
            ],
            [
              'share',
              translate(
                'auto.components.settings.RuntimeEnvironmentsPane.shareWorkflow',
                'Share this host'
              ),
              translate(
                'auto.components.settings.RuntimeEnvironmentsPane.shareWorkflowHelp',
                'Other devices join this machine'
              )
            ],
            [
              'cloud-vm',
              translate(
                'auto.components.settings.RuntimeEnvironmentsPane.cloudVmWorkflow',
                'Cloud VM'
              ),
              translate(
                'auto.components.settings.RuntimeEnvironmentsPane.cloudVmWorkflowHelp',
                'Manage recipe-created cloud machines'
              )
            ]
          ] as const
        )
          .filter(([value]) => value !== 'share' || canGeneratePairingUrl)
          .map(([value, label, description]) => (
            <button
              key={value}
              type="button"
              aria-pressed={visibleWorkflow === value}
              onClick={() => {
                if (value !== 'connect') {
                  closeAddServerForm()
                }
                setWorkflow(value)
              }}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                visibleWorkflow === value
                  ? 'border-ring bg-accent text-accent-foreground'
                  : 'border-border hover:bg-accent'
              )}
            >
              <span className="block text-sm font-medium">{label}</span>
              <span
                className={cn(
                  'mt-1 block text-xs',
                  visibleWorkflow === value ? 'text-accent-foreground' : 'text-muted-foreground'
                )}
              >
                {description}
              </span>
            </button>
          ))}
      </div>

      <RuntimeEnvironmentConnectionWorkflow {...props} />

      <div className={cn('space-y-5 pt-2', visibleWorkflow !== 'cloud-vm' && 'hidden')}>
        <CloudVmSetupGuide />
        <EphemeralVmRuntimesSection />
      </div>

      <div
        data-settings-section="default-runtime"
        className={visibleWorkflow !== 'connect' ? 'hidden' : undefined}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAdvancedOpen((current) => !current)}
          className="-ml-2 text-xs"
          aria-expanded={advancedOpen}
          aria-controls="runtime-server-advanced-content"
        >
          {translate('auto.components.settings.RuntimeEnvironmentsPane.advanced', 'Advanced')}
          <ChevronDown
            className={cn('size-4 transition-transform', advancedOpen && 'rotate-180')}
          />
        </Button>

        <div
          id="runtime-server-advanced-content"
          className={cn(
            'grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out',
            advancedOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
          aria-hidden={!advancedOpen}
          inert={!advancedOpen}
        >
          <div className="min-h-0">
            <div
              className={cn(
                'space-y-2 px-1 pt-3 pb-1 transition-[opacity,transform] duration-150 ease-out',
                advancedOpen
                  ? 'translate-y-0 opacity-100 delay-200'
                  : '-translate-y-1 opacity-0 delay-0'
              )}
            >
              <div className="space-y-1">
                <Label id="runtime-active-server-label">
                  {translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.64b6bea541',
                    'Active Server'
                  )}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {getActiveServerModeDescription(allowLocalRuntime)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={activeValue}
                  onValueChange={(value) => {
                    if (value !== activeValue) {
                      setSwitchError(null)
                      setPendingSwitchValue(value)
                    }
                  }}
                  disabled={isBusy}
                >
                  <SelectTrigger
                    size="sm"
                    className="min-w-[260px]"
                    aria-labelledby="runtime-active-server-label"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowLocalRuntime ? (
                      <SelectItem value={LOCAL_RUNTIME_VALUE}>
                        {translate(
                          'auto.components.settings.RuntimeEnvironmentsPane.78692becbd',
                          'Local desktop'
                        )}
                      </SelectItem>
                    ) : environments.length === 0 ? (
                      <SelectItem value={NO_RUNTIME_VALUE} disabled>
                        {translate(
                          'auto.components.settings.RuntimeEnvironmentsPane.b07070ed3c',
                          'No server connected'
                        )}
                      </SelectItem>
                    ) : null}
                    {environments.map((environment) => (
                      <SelectItem key={environment.id} value={environment.id}>
                        {environment.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.6ce4664003',
                    'Refresh servers'
                  )}
                  title={translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.6ce4664003',
                    'Refresh servers'
                  )}
                  onClick={() => void loadEnvironments()}
                  disabled={isLoading || isBusy}
                >
                  {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </Button>
              </div>
              {environments.length > 0 ? (
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-medium">
                    {translate(
                      'auto.components.settings.RuntimeEnvironmentsPane.serverDetails',
                      'Server details'
                    )}
                  </div>
                  <div className="space-y-1 rounded-lg border border-border/50 bg-card/30 p-2">
                    {environments.map((environment) => {
                      const details = detailsByEnvironmentId[environment.id]
                      return (
                        <div
                          key={environment.id}
                          className="grid gap-1 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]"
                        >
                          <div className="truncate font-medium text-foreground">
                            {environment.name}
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <div className="truncate font-mono">
                              {environment.endpoints[0]?.endpoint ??
                                translate(
                                  'auto.components.settings.RuntimeEnvironmentsPane.6ef71985da',
                                  'No endpoint'
                                )}
                            </div>
                            {details?.runtimeStatus ? (
                              <div className="truncate">
                                {translate(
                                  'auto.components.settings.RuntimeEnvironmentsPane.0ef838094a',
                                  'Protocol {{value0}}',
                                  {
                                    value0:
                                      details.runtimeStatus?.runtimeProtocolVersion ??
                                      details.runtimeStatus?.protocolVersion ??
                                      0
                                  }
                                )}
                                {details.runtimeStatus.hostPlatform
                                  ? ` · ${details.runtimeStatus.hostPlatform}`
                                  : ''}
                                {' · '}
                                {getRuntimeCapabilitiesSummary(details.runtimeStatus)}
                              </div>
                            ) : null}
                            {getHostModelCapabilitySummary(details?.runtimeStatus) ? (
                              <div className="truncate">
                                {getHostModelCapabilitySummary(details?.runtimeStatus)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {visibleWorkflow === 'share' && canGeneratePairingUrl ? (
        <div className="space-y-3 pt-2">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.advertiseThisApp',
                'Advertise this app as a server'
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.advertiseThisAppHelp',
                'Create access links for browsers, mobile clients, or another Orca client to connect back to this running app.'
              )}
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border/50 bg-card/30">
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <div className="text-sm font-medium">
                  {translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.6e1280ca55',
                    'Share this Orca server'
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.84b9b2be05',
                    'Create a revocable access grant so a browser or another Orca client can connect.'
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setShareServerFormOpen((open) => !open)}
              >
                <Share2 />
                {shareServerFormOpen
                  ? translate(
                      'auto.components.settings.RuntimeEnvironmentsPane.54dee18f5c',
                      'Hide Form'
                    )
                  : translate(
                      'auto.components.settings.RuntimeEnvironmentsPane.3595fd1948',
                      'New Link'
                    )}
              </Button>
            </div>
            <div className="border-t border-border/40 px-3 py-3">
              <RuntimePairingUrlGenerator
                framed={false}
                showHeader={false}
                showGeneratorForm={shareServerFormOpen}
              />
            </div>
          </div>
        </div>
      ) : null}

      {visibleWorkflow === 'connect' ? (
        <details className="group rounded-lg border border-border/60">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium">
            {translate(
              'auto.components.settings.RuntimeEnvironmentsPane.troubleshootWorkflow',
              'Connection troubleshooting'
            )}
            <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t border-border/50 p-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {translate(
                  'auto.components.settings.RuntimeEnvironmentsPane.troubleshootTitle',
                  'Create a new link on the other host'
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.RuntimeEnvironmentsPane.troubleshootDescription',
                  'A link that uses 127.0.0.1 points back to the device opening it, not the computer that created it.'
                )}
              </p>
            </div>
            <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
              <li>
                {translate(
                  'auto.components.settings.RuntimeEnvironmentsPane.troubleshootStepShare',
                  'On the other computer, open Share this host.'
                )}
              </li>
              <li>
                {translate(
                  'auto.components.settings.RuntimeEnvironmentsPane.troubleshootStepAddress',
                  'Choose Another device and select its Tailscale or LAN address.'
                )}
              </li>
              <li>
                {translate(
                  'auto.components.settings.RuntimeEnvironmentsPane.troubleshootStepRegenerate',
                  'Generate a new access link and use only the newest link here.'
                )}
              </li>
            </ol>
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.troubleshootTunnel',
                'Using an SSH local forward? Return to Connect to a host, paste the loopback link, then enable “I am using an SSH tunnel” under Advanced.'
              )}
            </div>
          </div>
        </details>
      ) : null}

      <Dialog
        open={pendingSwitchValue !== null}
        onOpenChange={(open) => {
          if (!open && switchingValue === null) {
            setSwitchError(null)
            setPendingSwitchValue(null)
          }
        }}
      >
        <DialogContent className="max-w-sm sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-sm">
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.d570c35a99',
                'Switch Server'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.b2290ed203',
                'Orca will focus this host and load its projects. Existing terminals and browser tabs on other hosts stay alive.'
              )}
            </DialogDescription>
          </DialogHeader>
          {pendingSwitchValue ? (
            <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
              <div className="text-muted-foreground">
                {translate(
                  'auto.components.settings.RuntimeEnvironmentsPane.05e0fc3ebf',
                  'Switch to'
                )}
              </div>
              <div className="mt-0.5 truncate font-medium">
                {getEnvironmentLabel(pendingSwitchValue)}
              </div>
            </div>
          ) : null}
          {switchError ? <p className="text-sm text-destructive">{switchError}</p> : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSwitchError(null)
                setPendingSwitchValue(null)
              }}
              disabled={switchingValue !== null}
            >
              {translate('auto.components.settings.RuntimeEnvironmentsPane.af53761f31', 'Cancel')}
            </Button>
            <Button
              onClick={() => {
                const value = pendingSwitchValue
                if (!value) {
                  return
                }
                void switchToValue(value).then((switched) => {
                  if (switched && mountedRef.current) {
                    setPendingSwitchValue(null)
                  }
                })
              }}
              disabled={switchingValue !== null}
            >
              {switchingValue !== null ? <Loader2 className="animate-spin" /> : null}
              {translate('auto.components.settings.RuntimeEnvironmentsPane.d2e00809e4', 'Switch')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open && removingId === null) {
            setRemoveError(null)
            setPendingRemove(null)
          }
        }}
      >
        <DialogContent className="max-w-sm sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-sm">
              {translate(
                'auto.components.settings.RuntimeEnvironmentsPane.bb90dd6487',
                'Remove Server'
              )}
            </DialogTitle>
            <DialogDescription>
              {removingActiveServer
                ? translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.removeActiveServerDescription',
                    'Choose another Active Server in Advanced before removing this server. Existing host sessions are left alone.'
                  )
                : translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.ed3e3f069d',
                    'This removes the saved server from Orca. It does not change the active server.'
                  )}
            </DialogDescription>
          </DialogHeader>
          {pendingRemove ? (
            <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
              <div className="truncate font-medium">{pendingRemove.name}</div>
              <div className="mt-0.5 truncate font-mono text-muted-foreground">
                {pendingRemove.endpoints[0]?.endpoint ??
                  translate(
                    'auto.components.settings.RuntimeEnvironmentsPane.6ef71985da',
                    'No endpoint'
                  )}
              </div>
            </div>
          ) : null}
          {removeError ? <p className="text-sm text-destructive">{removeError}</p> : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRemoveError(null)
                setPendingRemove(null)
              }}
              disabled={removingId !== null}
            >
              {translate('auto.components.settings.RuntimeEnvironmentsPane.af53761f31', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const environment = pendingRemove
                if (!environment) {
                  return
                }
                void removeEnvironment(environment).then((removed) => {
                  if (removed && mountedRef.current) {
                    setPendingRemove(null)
                  }
                })
              }}
              disabled={removingId !== null}
            >
              {removingId !== null ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {translate('auto.components.settings.RuntimeEnvironmentsPane.d25f0688b1', 'Remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SearchableSetting>
  )
}
