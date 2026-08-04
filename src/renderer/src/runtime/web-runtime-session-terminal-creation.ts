import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type {
  RuntimeMobileSessionCreateTerminalResult,
  RuntimeTerminalCreate
} from '../../../shared/runtime-types'
import type { StartupCommandDelivery } from '../../../shared/codex-startup-delivery'
import type {
  SleepingAgentLaunchConfig,
  AgentProviderSessionMetadata
} from '../../../shared/agent-session-resume'
import type {
  AgentLaunchPreferences,
  AgentPromptDelivery,
  RuntimeCreateAgentSessionResult,
  RuntimeEnsureAgentSessionResult
} from '../../../shared/agent-session-host-authority'
import type { TuiAgent } from '../../../shared/types'
import { AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import { useAppStore } from '../store'
import { unwrapRuntimeRpcResult } from './runtime-rpc-client'
import {
  createAgentSessionCreateOperation,
  withAgentSessionCreateOperationId
} from './agent-session-create-operation'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { recordWebSessionFocusIntent } from './web-session-focus-intent'
import { toHostSessionTabId, toWebTerminalSurfaceTabId } from './web-terminal-surface-id'
import { deliverLaunchPromptToAgentTab } from '../lib/agent-launch-prompt-delivery'
import { runRemoteAgentSessionLaunch } from './remote-agent-session-launch'
import { translate } from '../i18n/i18n'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import {
  isWebRuntimeSessionActive,
  refreshWebRuntimeSessionTabsSnapshot,
  selectWebRuntimeSessionWorktree
} from './web-runtime-session-transport'
import { getRuntimeEnvironmentRevision } from './runtime-environment-revision'
import { getClientRuntime } from './client-runtime'
import type { WebSessionIntentOwner } from './web-session-intent-owner'

export type WebRuntimeTerminalCreateOutcome =
  | { status: 'created' }
  | { status: 'failed'; message: string }

export const pendingRuntimeWorktreeRecoveryRefreshes = new Map<string, symbol>()
export const RUNTIME_WORKTREE_RECOVERY_REFRESH_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const

export function captureRuntimeEnvironmentCall(
  environmentId: string,
  expectedEnvironmentPairingRevision = getRuntimeEnvironmentRevision(environmentId)
): (args: {
  method: string
  params?: unknown
  timeoutMs?: number
}) => Promise<RuntimeRpcResponse<unknown>> {
  return (args) =>
    getClientRuntime().remoteHost.call({
      selector: environmentId,
      ...args,
      expectedEnvironmentPairingRevision
    })
}

export function captureWebSessionIntentOwner(environmentId: string): WebSessionIntentOwner {
  return {
    environmentId,
    pairingRevision: getRuntimeEnvironmentRevision(environmentId)
  }
}

export function matchesWebSessionIntentOwner(owner: WebSessionIntentOwner): boolean {
  return getRuntimeEnvironmentRevision(owner.environmentId) === owner.pairingRevision
}

type CreateWebRuntimeSessionTerminalArgs = {
  worktreeId: string
  environmentId?: string | null
  afterTabId?: string
  targetGroupId?: string
  command?: string
  cwd?: string
  env?: Record<string, string>
  envToDelete?: string[]
  startupCommandDelivery?: StartupCommandDelivery
  launchConfig?: SleepingAgentLaunchConfig
  launchToken?: string
  agent?: TuiAgent
  launchAgent?: TuiAgent
  agentSessionKind?: 'fresh' | 'resume'
  prompt?: string
  promptDelivery?: AgentPromptDelivery
  /** Explicit CLI override; omission leaves the remote host's defaults authoritative. */
  agentArgs?: string | null
  launchPreferences?: AgentLaunchPreferences
  providerSession?: AgentProviderSessionMetadata
  viewMode?: 'terminal' | 'chat'
  activate?: boolean
  selectWorktree?: boolean
}

type CreatedWebRuntimeSessionTerminal = {
  outcome: WebRuntimeTerminalCreateOutcome
  hostTabId?: string
}

type CreatedAgentTerminalIdentity = Pick<RuntimeTerminalCreate, 'tabId' | 'paneKey'> & {
  leafId?: string
}

function createdTerminalLeafId(terminal: CreatedAgentTerminalIdentity): string | undefined {
  const pane = parsePaneKey(terminal.paneKey ?? '')
  return pane && pane.tabId === terminal.tabId ? pane.leafId : undefined
}

export async function createWebRuntimeSessionTerminal(
  args: CreateWebRuntimeSessionTerminalArgs
): Promise<WebRuntimeTerminalCreateOutcome> {
  return (await createWebRuntimeSessionTerminalResult(args)).outcome
}

export async function createWebRuntimeAgentSessionTerminal(
  args: CreateWebRuntimeSessionTerminalArgs & {
    agent: TuiAgent
    promptAfterReady: string
    submitPrompt: boolean
    forcePromptPaste: boolean
  }
): Promise<{
  outcome: WebRuntimeTerminalCreateOutcome
  promptDelivered: boolean
}> {
  const created = await createWebRuntimeSessionTerminalResult(args)
  if (created.outcome.status === 'failed' || !created.hostTabId) {
    return { outcome: created.outcome, promptDelivered: false }
  }

  const promptDelivered = await deliverLaunchPromptToAgentTab({
    tabId: toWebTerminalSurfaceTabId(created.hostTabId),
    content: args.promptAfterReady,
    agent: args.agent,
    submit: args.submitPrompt,
    forcePaste: args.forcePromptPaste
  })
  return { outcome: created.outcome, promptDelivered }
}

/** Launch a web-host agent terminal whose draft already rode in on the launch command. */
export async function createWebRuntimeAgentSessionTerminalWithLaunchDraft(
  args: CreateWebRuntimeSessionTerminalArgs & {
    agent: TuiAgent
    launchDraft: string
  }
): Promise<WebRuntimeTerminalCreateOutcome> {
  const created = await createWebRuntimeSessionTerminalResult(args)
  return created.outcome
}

async function createWebRuntimeSessionTerminalResult(
  args: CreateWebRuntimeSessionTerminalArgs
): Promise<CreatedWebRuntimeSessionTerminal> {
  const environmentId =
    args.environmentId?.trim() ??
    useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim() ??
    null
  if (!environmentId || !isWebRuntimeSessionActive(environmentId)) {
    return {
      outcome: {
        status: 'failed',
        message: translate(
          'auto.runtime.webRuntimeSession.remoteHostDisconnected',
          'The workspace is not connected to a remote Orca host.'
        )
      }
    }
  }
  const intentOwner = captureWebSessionIntentOwner(environmentId)
  const callEnvironment = captureRuntimeEnvironmentCall(environmentId, intentOwner.pairingRevision)

  if (args.selectWorktree !== false) {
    selectWebRuntimeSessionWorktree(args.worktreeId, environmentId)
  }
  let hostCreated = false
  let createdTabId: string | undefined
  let createdLeafId: string | undefined
  try {
    const agent = args.launchAgent ?? args.agent
    const agentArgsOverride =
      args.agentArgs !== undefined ? args.agentArgs : args.launchConfig?.agentArgs
    if (agent) {
      let legacyAlreadyPlacedInGroup = false
      // Why: structured creation cannot yet express afterTabId; keep the exact legacy placement contract until it can.
      // Why: focus belongs to the paired client; a headless execution host has no renderer to focus.
      const hostAuthority = args.afterTabId
        ? undefined
        : args.agentSessionKind === 'resume'
          ? args.providerSession
            ? async () =>
                unwrapRuntimeRpcResult(
                  (await callEnvironment({
                    method: 'terminal.ensureAgentSession',
                    params: {
                      kind: 'explicit',
                      worktree: toRuntimeWorktreeSelector(args.worktreeId),
                      agent,
                      providerSession: args.providerSession!,
                      ...(args.launchConfig?.ompResumeFilePath
                        ? { ompResumeFilePath: args.launchConfig.ompResumeFilePath }
                        : {}),
                      ...(agentArgsOverride !== undefined ? { agentArgs: agentArgsOverride } : {}),
                      ...(args.launchPreferences
                        ? { launchPreferences: args.launchPreferences }
                        : {}),
                      presentation: 'background'
                    },
                    timeoutMs: 15_000
                  })) as RuntimeRpcResponse<RuntimeEnsureAgentSessionResult>
                )
            : undefined
          : async () =>
              await createAgentSessionCreateOperation().run(async (clientOperationId) =>
                unwrapRuntimeRpcResult(
                  (await callEnvironment({
                    method: 'terminal.createAgentSession',
                    params: withAgentSessionCreateOperationId(
                      {
                        worktree: toRuntimeWorktreeSelector(args.worktreeId),
                        agent,
                        ...(args.prompt ? { prompt: args.prompt } : {}),
                        ...(args.promptDelivery ? { promptDelivery: args.promptDelivery } : {}),
                        ...(agentArgsOverride !== undefined
                          ? { agentArgs: agentArgsOverride }
                          : {}),
                        ...(args.launchPreferences
                          ? { launchPreferences: args.launchPreferences }
                          : {}),
                        ...(args.cwd ? { startupCwd: args.cwd } : {}),
                        ...(args.viewMode ? { viewMode: args.viewMode } : {}),
                        presentation: 'background'
                      },
                      clientOperationId
                    ),
                    timeoutMs: 15_000
                  })) as RuntimeRpcResponse<RuntimeCreateAgentSessionResult>
                )
              )
      const created = await runRemoteAgentSessionLaunch<{
        terminal: CreatedAgentTerminalIdentity
      }>({
        environmentId,
        ...(hostAuthority ? { hostAuthority } : {}),
        ...(args.agentSessionKind === 'resume' && agent === 'omp'
          ? { hostAuthorityCapability: AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY }
          : {}),
        legacy: async () => {
          const response = await callEnvironment({
            method: 'session.tabs.createTerminal',
            params: {
              worktree: toRuntimeWorktreeSelector(args.worktreeId),
              afterTabId: args.afterTabId ? toHostSessionTabId(args.afterTabId) : undefined,
              targetGroupId: args.targetGroupId,
              command: args.command,
              cwd: args.cwd,
              ...(args.env ? { env: args.env } : {}),
              ...(args.envToDelete ? { envToDelete: args.envToDelete } : {}),
              startupCommandDelivery: args.startupCommandDelivery,
              ...(args.launchConfig ? { launchConfig: args.launchConfig } : {}),
              ...(args.launchToken ? { launchToken: args.launchToken } : {}),
              ...(args.agent ? { agent: args.agent } : {}),
              ...(args.launchAgent ? { launchAgent: args.launchAgent } : {}),
              ...(args.viewMode ? { viewMode: args.viewMode } : {}),
              // Why: old hosts understand activate:false; new hosts use select/navigation for caller-local focus.
              activate: false,
              select: args.activate !== false,
              navigation: 'caller'
            },
            timeoutMs: 15_000
          })
          const legacyCreated = unwrapRuntimeRpcResult(
            response as RuntimeRpcResponse<RuntimeMobileSessionCreateTerminalResult>
          )
          legacyAlreadyPlacedInGroup = true
          return {
            terminal: {
              tabId: legacyCreated.tab.id,
              leafId: legacyCreated.tab.leafId
            }
          }
        }
      })
      hostCreated = true
      createdTabId = created.terminal.tabId
      createdLeafId = legacyAlreadyPlacedInGroup
        ? created.terminal.leafId
        : createdTerminalLeafId(created.terminal)
      if (args.targetGroupId && createdTabId && !legacyAlreadyPlacedInGroup) {
        await callEnvironment({
          method: 'session.tabs.move',
          params: {
            worktree: toRuntimeWorktreeSelector(args.worktreeId),
            tabId: createdTabId,
            targetGroupId: args.targetGroupId,
            kind: 'move-to-group'
          },
          timeoutMs: 15_000
        })
      }
    } else {
      const response = await callEnvironment({
        method: 'session.tabs.createTerminal',
        params: {
          worktree: toRuntimeWorktreeSelector(args.worktreeId),
          afterTabId: args.afterTabId ? toHostSessionTabId(args.afterTabId) : undefined,
          targetGroupId: args.targetGroupId,
          command: args.command,
          cwd: args.cwd,
          ...(args.env ? { env: args.env } : {}),
          ...(args.envToDelete ? { envToDelete: args.envToDelete } : {}),
          startupCommandDelivery: args.startupCommandDelivery,
          ...(args.launchConfig ? { launchConfig: args.launchConfig } : {}),
          ...(args.launchToken ? { launchToken: args.launchToken } : {}),
          ...(args.viewMode ? { viewMode: args.viewMode } : {}),
          // Why: old hosts understand activate:false; new hosts use select/navigation for caller-local focus.
          activate: false,
          select: args.activate !== false,
          navigation: 'caller'
        },
        timeoutMs: 15_000
      })
      const created = unwrapRuntimeRpcResult(
        response as RuntimeRpcResponse<RuntimeMobileSessionCreateTerminalResult>
      )
      hostCreated = true
      createdTabId = created.tab.id
      createdLeafId = created.tab.leafId
    }
    if (args.activate !== false && createdTabId && matchesWebSessionIntentOwner(intentOwner)) {
      // Why: record focus intent so the reconcile follows the snapshot's active
      // tab to THIS new terminal, instead of sticky-keeping the prior tab.
      recordWebSessionFocusIntent(intentOwner, args.worktreeId, createdTabId, createdLeafId)
    }
    await refreshWebRuntimeSessionTabsSnapshot(environmentId, args.worktreeId, {
      expectedEnvironmentPairingRevision: intentOwner.pairingRevision,
      // Why: the publication can beat the RPC response; replay it once after caller focus intent exists.
      acceptCurrentSnapshot: args.activate !== false && Boolean(createdTabId)
    })
    return {
      outcome: { status: 'created' },
      ...(createdTabId ? { hostTabId: createdTabId } : {})
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      hostCreated
        ? '[web-runtime-session] terminal created but reconciliation failed:'
        : '[web-runtime-session] failed to create terminal:',
      message
    )
    // Why: once the host accepted creation, reporting failure invites the user
    // to retry with a new operation ID and can duplicate a fresh agent.
    return {
      outcome: hostCreated ? { status: 'created' } : { status: 'failed', message },
      ...(createdTabId ? { hostTabId: createdTabId } : {})
    }
  }
}
