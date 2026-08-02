// Concrete surface implementation for AgentsPane.tsx
   selection, per-agent controls, and runtime location together so settings
   reconciliation stays visible in one file. */
import { useId, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Info,
  RefreshCw,
  Terminal
} from 'lucide-react'
import type { GlobalSettings, TuiAgent } from '../../../../shared/types'
import { getAgentCatalog, AgentIcon } from '@/lib/agent-catalog'
import { useDetectedAgents, type AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { useAppStore } from '@/store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '@/lib/utils'
import { AgentAwakeSetting } from './AgentAwakeSetting'
import { AgentCacheTimerSection } from './AgentCacheTimerSection'
import { AgentRuntimeSetting } from './AgentRuntimeSetting'
import {
  AgentSessionSourceHomeInput,
  buildCodexSessionSourceHomeControl,
  type AgentSessionSourceHomeControl
} from './codex-session-source-home-control'
import {
  getAgentGeneratedTabTitlesDescription,
  getAgentGeneratedTabTitlesTitle
} from './agent-generated-tab-title-copy'
import { getAgentStatusHooksDescription, getAgentStatusHooksTitle } from './agent-status-hooks-copy'
import {
  SettingsBadge,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from './SettingsFormControls'
import {
  isTuiAgentEnabled,
  normalizeDisabledTuiAgents
} from '../../../../shared/tui-agent-selection'
import {
  getTuiAgentDefaultArgs,
  getTuiAgentDefaultEnv,
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../../shared/tui-agent-launch-defaults'
import {
  applyAgentPermissionMode,
  resolveAgentPermissionModeSummary,
  type AgentPermissionMode
} from '../../../../shared/tui-agent-permissions'
import { getSettingOwnershipSummary } from './setting-ownership'
import { translate } from '@/i18n/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { parseAgentDefaultEnvDraft, stringifyAgentDefaultEnvDraft } from './agent-default-env-draft'

export { getAgentsPaneSearchEntries } from './agents-search'
import { buildAgentAvailabilitySettingsUpdate, createAgentAvailabilityUpdateQueue, enqueueAgentAvailabilityUpdate, AgentAvailabilityControl, AgentPermissionsSetting, AgentCommandOverrideInput, AgentDefaultArgsInput, AgentDefaultEnvInput, AgentRow, DefaultAgentPill, AgentStatusHooksSetting, AgentGeneratedTabTitlesSetting } from './agents-pane-surface'
import type { AgentsPaneProps, AgentAvailabilityUpdateQueueOptions, AgentRowProps, AgentCommandOverrideInputProps, AgentDefaultArgsInputProps, AgentDefaultEnvInputProps, AgentAvailability, AgentAvailabilityControlProps, AgentPermissionsSettingProps, DefaultAgentPillProps } from './agents-pane-surface'
export function AgentsPane({
  settings,
  updateSettings,
  wslSupportedPlatform,
  wslAvailable,
  wslDistros,
  wslCapabilitiesLoading
}: AgentsPaneProps): React.JSX.Element {
  // Why: the Active Server routes agent launches and provider checks through
  // that server, so this pane must list what THAT host can launch — detecting
  // on the client showed a Windows machine's agents while paired to a Linux
  // server (the enable/disable/default toggles below stay client settings).
  const activeServerEnvironmentId = settings.activeRuntimeEnvironmentId?.trim() || null
  const agentDetectionTarget = useMemo<AgentDetectionTarget>(
    () =>
      activeServerEnvironmentId
        ? { kind: 'runtime', environmentId: activeServerEnvironmentId }
        : { kind: 'local' },
    [activeServerEnvironmentId]
  )
  const {
    detectedIds: detectedList,
    detectionFailed,
    isRefreshing,
    refresh: refreshTargetAgents
  } = useDetectedAgents(agentDetectionTarget)
  const refreshLocalAgents = useAppStore((s) => s.refreshDetectedAgents)
  const activeServerName = useAppStore((s) =>
    activeServerEnvironmentId
      ? (s.runtimeEnvironments.find((environment) => environment.id === activeServerEnvironmentId)
          ?.name ?? null)
      : null
  )
  // Why: refresh re-spawns the target host's login shell to re-capture PATH
  // (preflight:refreshAgents). This handles the "installed a new CLI, Orca
  // doesn't see it yet" case without a restart.
  const handleRefresh = (): void => {
    void refreshTargetAgents()
  }
  const detectedIds = useMemo<Set<string> | null>(
    () => (detectedList ? new Set(detectedList) : null),
    [detectedList]
  )

  const defaultAgent = settings.defaultTuiAgent
  const agentOwnership = getSettingOwnershipSummary('agentLaunchDefaults')
  const cmdOverrides = settings.agentCmdOverrides ?? {}
  const agentDefaultArgs = settings.agentDefaultArgs ?? {}
  const agentDefaultEnv = settings.agentDefaultEnv ?? {}
  const agentPermissionMode = resolveAgentPermissionModeSummary({
    agentDefaultArgs,
    agentDefaultEnv
  })
  const disabledAgents = normalizeDisabledTuiAgents(settings.disabledTuiAgents)

  const setDefault = (id: TuiAgent | 'blank' | null): void => {
    updateSettings({ defaultTuiAgent: id })
  }

  const setAgentEnabled = (id: TuiAgent, enabled: boolean): void => {
    void enqueueAgentAvailabilityUpdate({
      getSettings: () => useAppStore.getState().settings,
      fallbackSettings: settings,
      updateSettings,
      agentId: id,
      enabled
    })
  }

  const saveOverride = (id: TuiAgent, value: string): void => {
    const next = { ...cmdOverrides }
    if (value) {
      next[id] = value
    } else {
      delete next[id]
    }
    updateSettings({ agentCmdOverrides: next })
  }

  const saveAgentArgs = (id: TuiAgent, value: string): void => {
    updateSettings({
      agentDefaultArgs: {
        ...agentDefaultArgs,
        [id]: value
      }
    })
  }

  const saveAgentEnv = (id: TuiAgent, value: Record<string, string>): void => {
    updateSettings({
      agentDefaultEnv: {
        ...agentDefaultEnv,
        [id]: value
      }
    })
  }

  const saveAgentPermissionMode = (mode: Exclude<AgentPermissionMode, 'mixed'>): void => {
    updateSettings(
      applyAgentPermissionMode({
        mode,
        agentDefaultArgs,
        agentDefaultEnv
      })
    )
  }

  // Why: null means detection is in flight, not "all agents are installed".
  // Showing the full catalog here makes the default-agent picker flash invalid
  // options while switching between Windows and WSL detection contexts.
  const detectedAgents =
    detectedIds === null ? [] : getAgentCatalog().filter((agent) => detectedIds.has(agent.id))
  const enabledDetectedAgents = detectedAgents.filter((agent) =>
    isTuiAgentEnabled(agent.id, disabledAgents)
  )
  const undetectedAgents = getAgentCatalog().filter(
    (a) => detectedIds !== null && !detectedIds.has(a.id)
  )

  // Why: 'blank' is an explicit no-agent preference, not an auto fallback,
  // so the Auto pill should only light up when the default is null OR when a
  // selected agent id is no longer detected on PATH.
  const isAutoDefault =
    defaultAgent === null ||
    (defaultAgent !== 'blank' &&
      (!detectedIds?.has(defaultAgent) || !isTuiAgentEnabled(defaultAgent, disabledAgents)))
  const isBlankDefault = defaultAgent === 'blank'

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SettingsSubsectionHeader
          title={translate('auto.components.settings.AgentsPane.385212c7a1', 'Default Agent')}
          description={agentOwnership.description}
        />

        <div className="flex flex-wrap gap-2">
          <DefaultAgentPill active={isAutoDefault} onClick={() => setDefault(null)}>
            {isAutoDefault && <Check className="size-3.5" />}
            {translate('auto.components.settings.AgentsPane.92033495ff', 'Auto')}
          </DefaultAgentPill>

          {/* Why: users who prefer to open a raw shell by default need a
              first-class "no agent" choice here — without it, the Auto pill
              is the closest option but silently launches the first detected
              agent, which is the opposite of what they want. */}
          <DefaultAgentPill active={isBlankDefault} onClick={() => setDefault('blank')}>
            <Terminal className="size-3.5" />
            {translate(
              'auto.components.settings.AgentsPane.110b74b022',
              'No agent (blank terminal)'
            )}
            {isBlankDefault && <Check className="size-3.5" />}
          </DefaultAgentPill>

          {enabledDetectedAgents.map((agent) => {
            const isActive = defaultAgent === agent.id
            return (
              <DefaultAgentPill
                key={agent.id}
                active={isActive}
                onClick={() => setDefault(agent.id)}
              >
                <AgentIcon agent={agent.id} size={14} />
                {agent.label}
                {isActive && <Check className="size-3.5" />}
              </DefaultAgentPill>
            )
          })}
        </div>
      </section>

      <AgentRuntimeSetting
        settings={settings}
        updateSettings={updateSettings}
        // Why: this control changes the client-local Windows/WSL runtime even
        // while the Installed list is scoped to an active remote server.
        refresh={refreshLocalAgents}
        wslSupportedPlatform={wslSupportedPlatform}
        wslAvailable={wslAvailable}
        wslDistros={wslDistros}
        wslCapabilitiesLoading={wslCapabilitiesLoading}
      />

      <AgentStatusHooksSetting settings={settings} updateSettings={updateSettings} />

      <AgentGeneratedTabTitlesSetting settings={settings} updateSettings={updateSettings} />

      <AgentAwakeSetting settings={settings} updateSettings={updateSettings} />

      <AgentCacheTimerSection settings={settings} updateSettings={updateSettings} />

      <AgentPermissionsSetting mode={agentPermissionMode} onChange={saveAgentPermissionMode} />

      {detectedAgents.length > 0 && (
        <section className="space-y-3">
          <SettingsSubsectionHeader
            title={
              <span className="flex items-center gap-2">
                {translate('auto.components.settings.AgentsPane.02e0143be5', 'Installed')}
                <SettingsBadge tone="accent">
                  {detectedAgents.length}{' '}
                  {translate('auto.components.settings.AgentsPane.ed3e110e61', 'detected')}
                </SettingsBadge>
                {activeServerName ? (
                  <SettingsBadge tone="muted">
                    {translate('auto.components.settings.AgentsPane.03e1a5081a', 'on {{value0}}', {
                      value0: activeServerName
                    })}
                  </SettingsBadge>
                ) : null}
              </span>
            }
            action={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title={
                  activeServerEnvironmentId
                    ? translate(
                        'auto.components.settings.AgentsPane.25a41a9aad',
                        'Re-detect agents installed on the active server'
                      )
                    : translate(
                        'auto.components.settings.AgentsPane.13647f9f80',
                        'Re-read your shell PATH and re-detect installed agents'
                      )
                }
                className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
                {isRefreshing
                  ? translate('auto.components.settings.AgentsPane.c9b33eb5c0', 'Refreshing…')
                  : translate('auto.components.settings.AgentsPane.0d9e293a02', 'Refresh')}
              </Button>
            }
          />

          <div className="divide-y divide-border/40">
            {detectedAgents.map((agent) => (
              <AgentRow
                key={agent.id}
                agentId={agent.id}
                label={agent.label}
                homepageUrl={agent.homepageUrl}
                defaultCmd={agent.cmd}
                defaultArgs={getTuiAgentDefaultArgs(agent.id)}
                defaultEnv={getTuiAgentDefaultEnv(agent.id)}
                isDetected
                isEnabled={isTuiAgentEnabled(agent.id, disabledAgents)}
                isDefault={defaultAgent === agent.id}
                cmdOverride={cmdOverrides[agent.id]}
                argsOverride={resolveTuiAgentLaunchArgs(agent.id, agentDefaultArgs)}
                envOverride={resolveTuiAgentLaunchEnv(agent.id, agentDefaultEnv)}
                onSetDefault={() => setDefault(agent.id)}
                onSetEnabled={(enabled) => setAgentEnabled(agent.id, enabled)}
                onSaveOverride={(v) => saveOverride(agent.id, v)}
                onSaveArgs={(v) => saveAgentArgs(agent.id, v)}
                onSaveEnv={(v) => saveAgentEnv(agent.id, v)}
                sessionSourceHome={
                  agent.id === 'codex'
                    ? buildCodexSessionSourceHomeControl(settings, updateSettings)
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {undetectedAgents.length > 0 && (
        <section className="space-y-3">
          <SettingsSubsectionHeader
            title={
              <span className="flex items-center gap-2 text-muted-foreground">
                {translate(
                  'auto.components.settings.AgentsPane.e8da2af684',
                  'Available to install'
                )}
                <SettingsBadge tone="muted">
                  {undetectedAgents.length}{' '}
                  {translate('auto.components.settings.AgentsPane.024bd95089', 'agents')}
                </SettingsBadge>
              </span>
            }
          />

          <div className="divide-y divide-border/40">
            {undetectedAgents.map((agent) => (
              <AgentRow
                key={agent.id}
                agentId={agent.id}
                label={agent.label}
                homepageUrl={agent.homepageUrl}
                defaultCmd={agent.cmd}
                defaultArgs={getTuiAgentDefaultArgs(agent.id)}
                defaultEnv={getTuiAgentDefaultEnv(agent.id)}
                isDetected={false}
                isEnabled={isTuiAgentEnabled(agent.id, disabledAgents)}
                isDefault={false}
                cmdOverride={undefined}
                argsOverride={resolveTuiAgentLaunchArgs(agent.id, agentDefaultArgs)}
                envOverride={resolveTuiAgentLaunchEnv(agent.id, agentDefaultEnv)}
                onSetDefault={() => {}}
                onSetEnabled={(enabled) => setAgentEnabled(agent.id, enabled)}
                onSaveOverride={() => {}}
                onSaveArgs={(v) => saveAgentArgs(agent.id, v)}
                onSaveEnv={(v) => saveAgentEnv(agent.id, v)}
              />
            ))}
          </div>
        </section>
      )}

      {detectedIds === null && !detectionFailed && (
        <div className="flex items-center justify-center rounded-md border border-dashed border-border/50 py-6 text-sm text-muted-foreground">
          {translate(
            'auto.components.settings.AgentsPane.d83834f5e6',
            'Detecting installed agents…'
          )}
        </div>
      )}

      {detectionFailed && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {translate(
              'auto.components.settings.AgentsPane.remoteDetectionFailed',
              'Couldn’t detect installed agents. Check the host connection and try again.'
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleRefresh}
            className="h-6 shrink-0 gap-1.5 px-2 text-destructive hover:text-destructive"
          >
            <RefreshCw className="size-3" />
            {translate('auto.components.settings.AgentsPane.retryDetection', 'Retry')}
          </Button>
        </div>
      )}
    </div>
  )
}
