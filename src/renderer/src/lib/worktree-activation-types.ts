import type {
  SetupSplitDirection,
  TuiAgent,
  WorktreeDefaultTabsLaunch,
  WorktreeSetupLaunch
} from '../../../shared/types'
import type { EventProps } from '../../../shared/telemetry-events'
import type { StartupCommandDelivery } from '../../../shared/codex-startup-delivery'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../shared/agent-session-resume'
import type { PendingSidebarWorktreeReveal } from '@/store/slices/ui'

/** Telemetry threaded from the launch site to `pty:spawn`; main fires `agent_started`
 *  only after the spawn succeeds. See telemetry-plan.md§Agent launch semantics. */
export type AgentStartedTelemetry = EventProps<'agent_started'>

/** Startup command threaded onto a worktree's first terminal at activation. */
export type WorktreeStartupPayload = {
  command: string
  env?: Record<string, string>
  launchConfig?: SleepingAgentLaunchConfig
  resumeProviderSession?: AgentProviderSessionMetadata
  launchToken?: string
  launchAgent?: TuiAgent
  draftPrompt?: string
  /**
   * The unsent launch context, for the initial view-mode decision ONLY.
   *
   * Deliberately separate from `draftPrompt`, which drives the bracketed paste
   * in pty-connection: an argv-prefill launch already carries the draft inside
   * `command`, so reusing `draftPrompt` here would paste it a second time.
   * Set this on every draft launch; set `draftPrompt` only for paste delivery.
   */
  launchDraftText?: string
  startupCommandDelivery?: StartupCommandDelivery
  initialAgentStatus?: { agent: TuiAgent; prompt: string }
  telemetry?: AgentStartedTelemetry
}

/**
 * The unsent launch context a startup payload carries, whichever way the agent
 * receives it: argv prefill sets only `launchDraftText`, post-ready paste sets
 * `draftPrompt`. Gating on `draftPrompt` alone silently misses every
 * argv-prefill launch.
 */
export function resolveStartupLaunchDraftText(
  startup: Pick<WorktreeStartupPayload, 'draftPrompt' | 'launchDraftText'> | undefined
): string | undefined {
  return startup?.draftPrompt ?? startup?.launchDraftText
}

/** Shared by both tab-creation sites so the draft gate can't drift between them. */
function draftViewModeProps(draftText: string | undefined): {
  promptDelivery?: 'draft'
  launchDraftText?: string
} {
  return draftText == null ? {} : { promptDelivery: 'draft', launchDraftText: draftText }
}

// Why: accept either a main-generated runner script or a plain TaskPage command string, so callers needn't synthesize a runner file.
export type IssueCommandLaunch =
  | WorktreeSetupLaunch
  | { command: string; env?: Record<string, string> }

type WorktreeActivationStore = Partial<WorktreeRuntimeOwnerState> & {
  tabsByWorktree: Record<string, { id: string }[]>
  defaultTerminalTabsAppliedByWorktreeId: Record<string, true>
  createTab: (
    worktreeId: string,
    targetGroupId?: string,
    shellOverride?: string,
    options?: {
      pendingActivationSpawn?: boolean
      launchAgent?: TuiAgent
      recordInteraction?: boolean
      activate?: boolean
    }
  ) => { id: string }
  setActiveTab: (tabId: string) => void
  setTabCustomTitle: (
    tabId: string,
    title: string | null,
    opts?: { recordInteraction?: boolean }
  ) => void
  setTabColor: (tabId: string, color: string | null) => void
  markDefaultTerminalTabsApplied: (worktreeId: string) => void
  reconcileWorktreeTabModel: (worktreeId: string) => { renderableTabCount: number }
  queueTabStartupCommand: (
    tabId: string,
    startup: {
      command: string
      env?: Record<string, string>
      launchConfig?: SleepingAgentLaunchConfig
      resumeProviderSession?: AgentProviderSessionMetadata
      launchToken?: string
      launchAgent?: TuiAgent
      draftPrompt?: string
      initialAgentStatus?: { agent: TuiAgent; prompt: string }
      showSessionRestoredBanner?: boolean
      telemetry?: AgentStartedTelemetry
    }
  ) => void
  queueTabSetupSplit: (
    tabId: string,
    startup: { command: string; env?: Record<string, string>; direction: SetupSplitDirection }
  ) => void
  queueTabIssueCommandSplit: (
    tabId: string,
    startup: { command: string; env?: Record<string, string> }
  ) => void
  queueTabInitialCwd: (tabId: string, cwd: string) => void
}

/**
 * Shared activation sequence used by the worktree palette and add-repo/worktree dialogs.
 * The caller passes only `worktreeId`; the helper derives `repoId` and returns early
 * without side effects if the worktree is not found (deleted between palette open and select).
 */
export type ActivateAndRevealResult = {
  /** Id of the primary terminal tab seeded with `opts.startup`, or null. Prefer this over
   *  `activeTabIdByWorktree`, which may point at another tab if setup/issue scripts opened their own. */
  primaryTabId: string | null
}

