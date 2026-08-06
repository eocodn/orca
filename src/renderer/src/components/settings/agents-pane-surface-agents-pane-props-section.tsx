/* Concrete surface implementation for AgentsPane.tsx. */
import { Info } from 'lucide-react'
import type { GlobalSettings, TuiAgent } from '../../../../shared/types'
import type { AgentSessionSourceHomeControl } from './codex-session-source-home-control'
import {
  SettingsSegmentedControl,
  SettingsSubsectionHeader
} from './SettingsFormControls'
import type { AgentPermissionMode } from '../../../../shared/tui-agent-permissions'
import { normalizeDisabledTuiAgents } from '../../../../shared/tui-agent-selection'
import { translate } from '@/i18n/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
export type AgentsPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
  wslSupportedPlatform?: boolean
  wslAvailable?: boolean
  wslDistros?: string[]
  wslCapabilitiesLoading?: boolean
}
export type AgentAvailabilityUpdateQueueOptions = {
  getSettings: () => GlobalSettings | null | undefined
  fallbackSettings: GlobalSettings
  updateSettings: AgentsPaneProps['updateSettings']
  agentId: TuiAgent
  enabled: boolean
}
export type AgentRowProps = {
  agentId: TuiAgent
  label: string
  homepageUrl: string
  defaultCmd: string
  defaultArgs: string
  defaultEnv: Record<string, string>
  isDetected: boolean
  isEnabled: boolean
  isDefault: boolean
  cmdOverride: string | undefined
  argsOverride: string
  envOverride: Record<string, string>
  onSetDefault: () => void
  onSetEnabled: (enabled: boolean) => void
  onSaveOverride: (value: string) => void
  onSaveArgs: (value: string) => void
  onSaveEnv: (value: Record<string, string>) => void
  /** Codex-only: current runtime scope label + persisted history-source override. */
  sessionSourceHome?: AgentSessionSourceHomeControl
}
export type AgentCommandOverrideInputProps = {
  defaultCmd: string
  cmdOverride: string | undefined
  onSaveOverride: (value: string) => void
}
export type AgentDefaultArgsInputProps = {
  defaultArgs: string
  argsOverride: string
  onSaveArgs: (value: string) => void
}
export type AgentDefaultEnvInputProps = {
  defaultEnv: Record<string, string>
  envOverride: Record<string, string>
  onSaveEnv: (value: Record<string, string>) => void
}
export type AgentAvailability = 'enabled' | 'disabled'
export type AgentAvailabilityControlProps = {
  label: string
  isEnabled: boolean
  onSetEnabled: (enabled: boolean) => void
}
export type AgentPermissionsSettingProps = {
  mode: AgentPermissionMode
  onChange: (mode: Exclude<AgentPermissionMode, 'mixed'>) => void
}
export function buildAgentAvailabilitySettingsUpdate(
  settings: Pick<GlobalSettings, 'defaultTuiAgent' | 'disabledTuiAgents'>,
  id: TuiAgent,
  enabled: boolean
): Pick<GlobalSettings, 'disabledTuiAgents'> & Partial<Pick<GlobalSettings, 'defaultTuiAgent'>> {
  const latestDisabled = normalizeDisabledTuiAgents(settings.disabledTuiAgents)
  const nextDisabled = enabled
    ? latestDisabled.filter((agent) => agent !== id)
    : latestDisabled.includes(id)
      ? latestDisabled
      : [...latestDisabled, id]

  return {
    disabledTuiAgents: nextDisabled,
    ...(settings.defaultTuiAgent === id && !enabled ? { defaultTuiAgent: null } : {})
  }
}
export function createAgentAvailabilityUpdateQueue(): (
  options: AgentAvailabilityUpdateQueueOptions
) => Promise<void> {
  let pendingUpdate: Promise<unknown> = Promise.resolve()

  return ({ getSettings, fallbackSettings, updateSettings, agentId, enabled }) => {
    // Why: serialize full-array replacements so each write sees the store after
    // the previous IPC has reconciled, while preserving the user's requested state.
    pendingUpdate = pendingUpdate
      .catch(() => {})
      .then(() =>
        updateSettings(
          buildAgentAvailabilitySettingsUpdate(getSettings() ?? fallbackSettings, agentId, enabled)
        )
      )
    return pendingUpdate.then(() => undefined)
  }
}
export const enqueueAgentAvailabilityUpdate = createAgentAvailabilityUpdateQueue()
export function AgentAvailabilityControl({
  label,
  isEnabled,
  onSetEnabled
}: AgentAvailabilityControlProps): React.JSX.Element {
  const value: AgentAvailability = isEnabled ? 'enabled' : 'disabled'

  return (
    <SettingsSegmentedControl<AgentAvailability>
      value={value}
      onChange={(next) => {
        if (next !== value) {
          onSetEnabled(next === 'enabled')
        }
      }}
      ariaLabel={translate(
        'auto.components.settings.AgentsPane.1c9a9679ec',
        '{{value0}} availability',
        { value0: label }
      )}
      size="sm"
      options={[
        {
          value: 'enabled',
          label: translate('auto.components.settings.AgentsPane.d4d2a45d63', 'Enabled')
        },
        {
          value: 'disabled',
          label: translate('auto.components.settings.AgentsPane.8dc0192e48', 'Disabled')
        }
      ]}
    />
  )
}
export function AgentPermissionsSetting({
  mode,
  onChange
}: AgentPermissionsSettingProps): React.JSX.Element {
  const visibleMode: Exclude<AgentPermissionMode, 'mixed'> = mode === 'manual' ? 'manual' : 'yolo'
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={
          <span className="flex items-center gap-2">
            {translate('auto.components.settings.AgentsPane.agentPermissions', 'Agent Permissions')}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={translate(
                    'auto.components.settings.AgentsPane.agentPermissionsInfo',
                    'Agent permissions info'
                  )}
                  className="grid size-5 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {translate(
                  'auto.components.settings.AgentsPane.agentPermissionsTooltip',
                  "Doesn't apply to agents where you've overridden launch arguments."
                )}
              </TooltipContent>
            </Tooltip>
          </span>
        }
        description={translate(
          'auto.components.settings.AgentsPane.agentPermissionsDescription',
          'Choose whether Orca launches agents with fewer permission prompts or with manual checks.'
        )}
        action={
          <SettingsSegmentedControl<AgentPermissionMode>
            value={visibleMode}
            onChange={(nextMode) => {
              if (nextMode !== 'mixed') {
                onChange(nextMode)
              }
            }}
            ariaLabel={translate(
              'auto.components.settings.AgentsPane.agentPermissions',
              'Agent Permissions'
            )}
            size="sm"
            options={[
              {
                value: 'yolo',
                label: translate('auto.components.settings.AgentsPane.agentPermissionsYolo', 'Yolo')
              },
              {
                value: 'manual',
                label: translate(
                  'auto.components.settings.AgentsPane.agentPermissionsManual',
                  'Manual'
                )
              }
            ]}
          />
        }
      />
    </section>
  )
}
