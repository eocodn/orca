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
import { buildAgentAvailabilitySettingsUpdate, createAgentAvailabilityUpdateQueue, enqueueAgentAvailabilityUpdate, AgentAvailabilityControl, AgentPermissionsSetting, AgentCommandOverrideInput, AgentDefaultArgsInput, AgentDefaultEnvInput, AgentsPane, AgentStatusHooksSetting, AgentGeneratedTabTitlesSetting } from './agents-pane-surface'
import type { AgentsPaneProps, AgentAvailabilityUpdateQueueOptions, AgentRowProps, AgentCommandOverrideInputProps, AgentDefaultArgsInputProps, AgentDefaultEnvInputProps, AgentAvailability, AgentAvailabilityControlProps, AgentPermissionsSettingProps } from './agents-pane-surface'
export function AgentRow({
  agentId,
  label,
  homepageUrl,
  defaultCmd,
  defaultArgs,
  defaultEnv,
  isDetected,
  isEnabled,
  isDefault,
  cmdOverride,
  argsOverride,
  envOverride,
  onSetDefault,
  onSetEnabled,
  onSaveOverride,
  onSaveArgs,
  onSaveEnv,
  sessionSourceHome
}: AgentRowProps): React.JSX.Element {
  const envSummary = stringifyAgentDefaultEnvDraft(envOverride)
  const defaultEnvSummary = stringifyAgentDefaultEnvDraft(defaultEnv)
  const [cmdOpen, setCmdOpen] = useState(
    Boolean(cmdOverride) || argsOverride !== defaultArgs || envSummary !== defaultEnvSummary
  )

  return (
    <div className={cn('py-3', !isDetected && 'opacity-70')}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background/50">
          <AgentIcon agent={agentId} size={16} />
        </div>

        <div className="min-w-0 flex-1 sm:min-w-[12rem]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium leading-none">{label}</span>
            {!isEnabled && (
              <SettingsBadge tone="muted">
                {translate('auto.components.settings.AgentsPane.8dc0192e48', 'Disabled')}
              </SettingsBadge>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {cmdOverride ? (
              <span>
                <span className="text-muted-foreground/60 line-through">{defaultCmd}</span>
                <span className="ml-1.5 text-foreground/80">{cmdOverride}</span>
              </span>
            ) : (
              defaultCmd
            )}
            {argsOverride && <span className="ml-1.5 text-foreground/70">{argsOverride}</span>}
            {envSummary && <span className="ml-1.5 text-foreground/60">{envSummary}</span>}
          </div>
        </div>

        <div className="ml-auto grid shrink-0 grid-cols-[max-content_6.5rem_1.75rem_1.75rem] items-center gap-1.5">
          <AgentAvailabilityControl
            label={label}
            isEnabled={isEnabled}
            onSetEnabled={onSetEnabled}
          />

          <div className="flex justify-start">
            {isDetected && isEnabled && (
              <Button
                type="button"
                variant={isDefault ? 'secondary' : 'ghost'}
                size="xs"
                onClick={onSetDefault}
                title={
                  isDefault
                    ? translate('auto.components.settings.AgentsPane.d7625cf8b2', 'Default agent')
                    : translate('auto.components.settings.AgentsPane.5f986a9b92', 'Set as default')
                }
                className="h-7 w-full justify-center gap-1 text-xs"
              >
                {isDefault && <Check className="size-3" />}
                {isDefault
                  ? translate('auto.components.settings.AgentsPane.24e032fa34', 'Default')
                  : translate('auto.components.settings.AgentsPane.959b67385b', 'Set default')}
              </Button>
            )}
          </div>

          <a
            href={homepageUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={
              isDetected
                ? translate('auto.components.settings.AgentsPane.fe4d630c94', 'Docs')
                : translate('auto.components.settings.AgentsPane.f95b5c79b8', 'Install')
            }
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>

          <div className="flex size-7 items-center justify-center">
            {isDetected && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setCmdOpen((prev) => !prev)}
                aria-label={
                  cmdOpen
                    ? translate(
                        'auto.components.settings.AgentsPane.cea7d97be1',
                        'Collapse command override'
                      )
                    : translate(
                        'auto.components.settings.AgentsPane.dc4a2ffdc0',
                        'Expand command override'
                      )
                }
                className="size-7 text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  className={cn('size-3.5 transition-transform', cmdOpen && 'rotate-180')}
                />
              </Button>
            )}
          </div>
        </div>
      </div>

      {isDetected && cmdOpen && (
        <div className="mt-3 pl-10">
          {/* Why: key by the persisted seed so settings changes reset the draft during reconciliation, not in a follow-up effect commit. */}
          <AgentCommandOverrideInput
            key={cmdOverride ?? defaultCmd}
            defaultCmd={defaultCmd}
            cmdOverride={cmdOverride}
            onSaveOverride={onSaveOverride}
          />
          <div className="mt-2">
            <AgentDefaultArgsInput
              key={`${agentId}:${argsOverride}`}
              defaultArgs={defaultArgs}
              argsOverride={argsOverride}
              onSaveArgs={onSaveArgs}
            />
          </div>
          {(defaultEnvSummary || envSummary) && (
            <div className="mt-2">
              <AgentDefaultEnvInput
                key={`${agentId}:${envSummary}`}
                defaultEnv={defaultEnv}
                envOverride={envOverride}
                onSaveEnv={onSaveEnv}
              />
            </div>
          )}
          {sessionSourceHome && (
            <div className="mt-2">
              <AgentSessionSourceHomeInput
                key={`${agentId}:${sessionSourceHome.runtimeLabel}:${sessionSourceHome.value}`}
                runtimeLabel={sessionSourceHome.runtimeLabel}
                value={sessionSourceHome.value}
                onSave={sessionSourceHome.onSave}
              />
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {translate(
              'auto.components.settings.AgentsPane.f9f127d664',
              'Override the binary path or name, and edit the default launch arguments or environment for this agent.'
            )}
          </p>
        </div>
      )}
    </div>
  )
}
export type DefaultAgentPillProps = {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}
export function DefaultAgentPill({ active, onClick, children }: DefaultAgentPillProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'border-muted-foreground/40 bg-accent font-medium text-accent-foreground'
          : 'border-border bg-background/50 text-muted-foreground hover:border-muted-foreground/35 hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}
