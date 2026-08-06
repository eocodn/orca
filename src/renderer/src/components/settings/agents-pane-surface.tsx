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

import { AgentsPaneProps, AgentAvailabilityUpdateQueueOptions, AgentRowProps, AgentCommandOverrideInputProps, AgentDefaultArgsInputProps, AgentDefaultEnvInputProps, AgentAvailability, AgentAvailabilityControlProps, AgentPermissionsSettingProps, buildAgentAvailabilitySettingsUpdate, createAgentAvailabilityUpdateQueue, enqueueAgentAvailabilityUpdate, AgentAvailabilityControl, AgentPermissionsSetting } from './agents-pane-surface-agents-pane-props-section'
import { AgentCommandOverrideInput, AgentDefaultArgsInput, AgentDefaultEnvInput } from './agents-pane-surface-agent-command-override-input-section'
import { AgentRow, DefaultAgentPillProps, DefaultAgentPill } from './agents-pane-surface-agent-row-section'
import { AgentsPane } from './agents-pane-surface-agents-pane-section'
import { AgentGeneratedTabTitlesSetting } from './agents-pane-surface-agent-status-hooks-setting-section'

export { buildAgentAvailabilitySettingsUpdate, createAgentAvailabilityUpdateQueue, enqueueAgentAvailabilityUpdate, AgentAvailabilityControl, AgentPermissionsSetting, AgentCommandOverrideInput, AgentDefaultArgsInput, AgentDefaultEnvInput, AgentRow, DefaultAgentPill, AgentsPane, AgentGeneratedTabTitlesSetting }
export type { AgentsPaneProps, AgentAvailabilityUpdateQueueOptions, AgentRowProps, AgentCommandOverrideInputProps, AgentDefaultArgsInputProps, AgentDefaultEnvInputProps, AgentAvailability, AgentAvailabilityControlProps, AgentPermissionsSettingProps, DefaultAgentPillProps }
