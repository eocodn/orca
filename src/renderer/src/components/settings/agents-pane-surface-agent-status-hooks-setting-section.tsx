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
import { buildAgentAvailabilitySettingsUpdate, createAgentAvailabilityUpdateQueue, enqueueAgentAvailabilityUpdate, AgentAvailabilityControl, AgentPermissionsSetting, AgentCommandOverrideInput, AgentDefaultArgsInput, AgentDefaultEnvInput, AgentRow, DefaultAgentPill, AgentsPane } from './agents-pane-surface'
import type { AgentsPaneProps, AgentAvailabilityUpdateQueueOptions, AgentRowProps, AgentCommandOverrideInputProps, AgentDefaultArgsInputProps, AgentDefaultEnvInputProps, AgentAvailability, AgentAvailabilityControlProps, AgentPermissionsSettingProps, DefaultAgentPillProps } from './agents-pane-surface'
export function AgentGeneratedTabTitlesSetting({
  settings,
  updateSettings
}: AgentsPaneProps): React.JSX.Element {
  const enabled = settings.tabAutoGenerateTitle === true
  return (
    <section className="space-y-3">
      <SettingsSwitchRow
        label={getAgentGeneratedTabTitlesTitle()}
        description={getAgentGeneratedTabTitlesDescription()}
        checked={enabled}
        onChange={() =>
          updateSettings({
            tabAutoGenerateTitle: !enabled
          })
        }
        ariaLabel={getAgentGeneratedTabTitlesTitle()}
      />
    </section>
  )
}
