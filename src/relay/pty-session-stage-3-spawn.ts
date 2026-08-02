import { randomUUID } from 'node:crypto'
import type { IPty } from 'node-pty'
import type { RequestContext } from './dispatcher'
import { PtyHandlerStage2 } from './pty-session-stage-2'
import {
  AGENT_SESSION_CREATE_OPERATION_ID_PATTERN,
  AGENT_SESSION_CREATE_OPERATION_LIMIT,
  AGENT_SESSION_CREATE_OPERATION_RETENTION_MS,
  REPLAY_BUFFER_MAX,
  STARTUP_COMMAND_SHELL_READY_FALLBACK_MS,
  STARTUP_COMMAND_WRITE_DELAY_MS,
  formatNodePtyUnavailableMessage,
  isMissingNodePtyNativeBinding,
  resolvePtyShellOverride,
  sanitizeEnvToDelete
} from './pty-session-stage-contracts'
import type { ManagedPty, RelayAgentSessionCreateResult } from './pty-session-stage-contracts'
import { resolveDefaultCwd, resolveDefaultShell, isProcessAlive } from './pty-shell-utils'
import { getRelayShellLaunchConfig } from './pty-shell-launch'
import { shouldUseShellReadyStartupDelivery } from '../shared/codex-startup-delivery'
import { resolveSetupAgentSequenceLaunchCommand } from '../shared/setup-agent-sequencing'
import { splitWorktreeId } from '../shared/worktree-id'
import { applyTerminalGitCredentialPromptGuard } from '../shared/terminal-git-credential-guard'
import { isTuiAgent } from '../shared/tui-agent-config'
import { PTY_STARTUP_INGRESS_VERSION, parsePtyStartupIngressIntent } from '../shared/pty-startup-ingress'
import { createShellReadyScanState } from '../main/shell-ready-marker-scanner'
import { resolvePtyOwnerBackend } from '../shared/pty-owner-backend'
import { agentSessionOwnerBindingsEqual } from '../shared/claimed-agent-pty-owner'
import type { PtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'

export class PtyHandlerStage3 extends PtyHandlerStage2 {
  protected async spawn(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<RelayAgentSessionCreateResult> {
    const operationId = params.agentSessionCreateOperationId
    if (operationId === undefined) {
      return await this.spawnOnce(params, context)
    }
    if (
      typeof operationId !== 'string' ||
      !AGENT_SESSION_CREATE_OPERATION_ID_PATTERN.test(operationId)
    ) {
      throw new Error('agent_session_operation_invalid')
    }
    const existing = this.agentSessionCreateOperations.get(operationId)
    if (existing) {
      const result = await existing
      this.sourcePublication?.activate(result.id, result.incarnationId, context)
      const sourceActivation =
        context && this.sourcePublication?.receivingActivation?.(result.id, context.clientId)
      const { sourceActivation: _staleActivation, ...stableResult } = result
      return { ...stableResult, ...(sourceActivation ? { sourceActivation } : {}) }
    }
    if (this.agentSessionCreateOperations.size >= AGENT_SESSION_CREATE_OPERATION_LIMIT) {
      throw new Error('agent_session_operation_capacity')
    }
    const operation = this.spawnOnce(params, context)
    this.agentSessionCreateOperations.set(operationId, operation)
    try {
      const result = await operation
      this.expireAgentSessionCreateOperation(operationId, operation)
      return result
    } catch (error) {
      const outcomeUnknown =
        typeof error === 'object' &&
        error !== null &&
        'agentSessionOperationOutcome' in error &&
        error.agentSessionOperationOutcome === 'unknown'
      if (outcomeUnknown) {
        // Why: the native PTY may be live; replay the same failure instead of spawning again.
        this.expireAgentSessionCreateOperation(operationId, operation)
      } else if (this.agentSessionCreateOperations.get(operationId) === operation) {
        this.agentSessionCreateOperations.delete(operationId)
      }
      throw error
    }
  }

  protected expireAgentSessionCreateOperation(
    operationId: string,
    operation: Promise<RelayAgentSessionCreateResult>
  ): void {
    const timer = setTimeout(() => {
      if (this.agentSessionCreateOperations.get(operationId) === operation) {
        this.agentSessionCreateOperations.delete(operationId)
      }
    }, AGENT_SESSION_CREATE_OPERATION_RETENTION_MS)
    timer.unref?.()
  }

  protected async spawnOnce(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<RelayAgentSessionCreateResult> {
    const env = params.env as Record<string, string> | undefined
    const worktreeId = env?.ORCA_WORKTREE_ID
    const worktreePath = worktreeId ? splitWorktreeId(worktreeId)?.worktreePath : undefined
    const cwd = typeof params.cwd === 'string' ? params.cwd : resolveDefaultCwd()
    const finishCreation = this.beginPtyCreation([worktreePath, cwd])
    let physicalSpawnCommitted = false
    const markPhysicalSpawnCommitted = (): void => {
      physicalSpawnCommitted = true
    }
    try {
      const ensure = params.agentSessionEnsure as { claim?: unknown; surface?: unknown } | undefined
      if (!ensure) {
        return await this.spawnAfterAdmission(params, context, markPhysicalSpawnCommitted)
      }
      if (
        !isAgentSessionExecutionClaim(ensure.claim) ||
        !isAgentSessionSurfaceBinding(ensure.surface)
      ) {
        throw new Error('agent_session_identity_required')
      }
      const claim = ensure.claim
      const surface = ensure.surface
      const result = await this.agentSessionOwners.ensure({
        claim,
        surface,
        spawn: async ({ generation }) => {
          const created = await this.spawnAfterAdmission(
            params,
            context,
            markPhysicalSpawnCommitted
          )
          const managed = this.ptys.get(created.id)
          if (managed) {
            managed.agentSessionOwners = [
              {
                claim,
                generation,
                phase: 'live',
                ptyId: created.id,
                surface
              }
            ]
          }
          return { ptyId: created.id }
        },
        isLive: (owner) => {
          const managed = this.ptys.get(owner.ptyId)
          return Boolean(
            managed &&
            !managed.disposed &&
            (!managed.pty.pid || isProcessAlive(managed.pty.pid)) &&
            managed.agentSessionOwners?.some((candidate) =>
              agentSessionOwnerBindingsEqual(candidate, owner)
            )
          )
        }
      })
      const managed = this.ptys.get(result.owner.ptyId)
      if (!managed || managed.disposed) {
        this.agentSessionOwners.release(result.owner.ptyId, result.owner.generation)
        throw new Error('agent_session_exited_during_start')
      }
      managed.agentSessionOwners = this.agentSessionOwners.listForPty(managed.id)
      const adoptedReplay = result.disposition === 'adopted' ? managed.buffered.read() : ''
      this.sourcePublication?.activate(managed.id, managed.incarnationId, context)
      const sourceActivation =
        context && this.sourcePublication?.receivingActivation?.(managed.id, context.clientId)
      return {
        id: managed.id,
        incarnationId: managed.incarnationId,
        agentSessionEnsure: result,
        ...(sourceActivation ? { sourceActivation } : {}),
        ...(adoptedReplay ? { replay: adoptedReplay } : {})
      }
    } catch (error) {
      if (!physicalSpawnCommitted) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw Object.assign(new Error(message), {
        agentSessionOperationOutcome: 'unknown' as const
      })
    } finally {
      finishCreation()
    }
  }

  protected async spawnAfterAdmission(
    params: Record<string, unknown>,
    context?: RequestContext,
    onPhysicalSpawnCommitted?: () => void
  ): Promise<{
    id: string
    incarnationId: string
    sourceActivation?: PtySourceReceivingActivation
  }> {
    const pty = await this.loadPty()
    if (!pty) {
      throw new Error(formatNodePtyUnavailableMessage(process.platform))
    }

    const cols = (params.cols as number) || 80
    const rows = (params.rows as number) || 24
    const cwd = (params.cwd as string) || resolveDefaultCwd()
    const env = params.env as Record<string, string> | undefined
    const envToDelete = sanitizeEnvToDelete(params.envToDelete)
    const explicitTerm =
      !envToDelete.includes('TERM') &&
      env &&
      Object.prototype.hasOwnProperty.call(env, 'TERM') &&
      typeof env.TERM === 'string' &&
      env.TERM.length > 0
        ? env.TERM
        : undefined
    const shellOverride =
      typeof params.shellOverride === 'string' ? params.shellOverride.trim() : ''
    const resolvedShellOverride = resolvePtyShellOverride(shellOverride)
    const shell = resolvedShellOverride || resolveDefaultShell()
    let id: string
    do {
      id = `pty-${this.nextId++}`
    } while (this.ptys.has(id) || this.pendingReviveIds.has(id))

    // Why: augmenter values override renderer env so remote paths and hook coords win over local userData.
    const paneKey = typeof env?.ORCA_PANE_KEY === 'string' ? env.ORCA_PANE_KEY : undefined
    // Why: kept so a restarted runtime can re-adopt this PTY under its original handle (survives revive).
    const terminalHandle =
      typeof env?.ORCA_TERMINAL_HANDLE === 'string' ? env.ORCA_TERMINAL_HANDLE : undefined
    const command = typeof params.command === 'string' ? params.command : undefined
    const launchAgent = isTuiAgent(params.launchAgent) ? params.launchAgent : undefined
    const terminalWindowsWslDistro =
      typeof params.terminalWindowsWslDistro === 'string' ? params.terminalWindowsWslDistro : null
    const commandDelivery = params.commandDelivery === 'provider' ? 'provider' : 'renderer'
    const shouldProviderDeliverCommand = commandDelivery === 'provider' && command !== undefined
    const spawnEnv = this.buildSpawnEnv(
      env,
      { id, paneKey, shell, command, launchAgent },
      envToDelete
    )
    const launchCommandHint = resolveSetupAgentSequenceLaunchCommand(spawnEnv, command)
    // Why: SSH PTYs bypass main's host-env builder, so apply the guard after the relay merges its authoritative env.
    const gitCredentialPromptGuarded = applyTerminalGitCredentialPromptGuard(spawnEnv, {
      launchCommand: launchCommandHint,
      isUnattended: launchAgent !== undefined,
      platform: process.platform
    })
    const shouldEmitShellReadyMarker =
      launchCommandHint !== undefined &&
      shouldUseShellReadyStartupDelivery({
        command: launchCommandHint,
        startupCommandDelivery:
          params.startupCommandDelivery === 'shell-ready' ? 'shell-ready' : undefined
      })
    // Why: both renderer- and provider-delivered startup commands use this marker; the delivering side strips it from output.
    const shellLaunch = getRelayShellLaunchConfig(shell, spawnEnv, process.platform, {
      terminalWindowsWslDistro,
      emitReadyMarker: shouldEmitShellReadyMarker
    })

    if (context?.signal?.aborted || context?.isStale()) {
      // Why: cancellation remains side-effect-free until the exact native spawn seam.
      throw new Error('client_disconnected')
    }

    // Why: SSH exec channels give the relay a minimal environment without
    // .zprofile/.bash_profile sourced. Spawning a login shell ensures PATH
    // includes Homebrew, nvm, and user-installed CLIs (claude, codex, gh).
    // When overlays are injected, the launch wrapper keeps those paths after
    // user startup files re-export their defaults.
    let term: IPty
    try {
      term = pty.spawn(shell, shellLaunch.args, {
        // Why: node-pty overwrites env.TERM with `name`; pass caller-selected TERM so it isn't lost.
        name: spawnEnv.TERM ?? 'xterm-256color',
        cols,
        rows,
        cwd,
        // Why: relay shells inherit process.env; don't let an ambient Orca marker enable shell-ready unless requested.
        env: { ...spawnEnv, ORCA_SHELL_READY_MARKER: '0', ...shellLaunch.env }
      })
    } catch (error) {
      // Why: Windows loads conpty.node only on first spawn, so handle that late binding failure here.
      if (isMissingNodePtyNativeBinding(error)) {
        this.invalidatePtyModuleAfterBindingFailure()
        throw new Error(formatNodePtyUnavailableMessage(process.platform))
      }
      throw error
    }
    onPhysicalSpawnCommitted?.()

    // Why: capture paneKey so the exit listener can evict per-pane caches without a separate ptyId→paneKey map.
    const tabId = typeof env?.ORCA_TAB_ID === 'string' ? env.ORCA_TAB_ID : undefined
    const attachIdentity = {
      paneKey: typeof params.paneKey === 'string' ? params.paneKey : paneKey,
      tabId: typeof params.tabId === 'string' ? params.tabId : tabId
    }
    const worktreeId = typeof env?.ORCA_WORKTREE_ID === 'string' ? env.ORCA_WORKTREE_ID : undefined
    const startupIngressIntent =
      params.startupIngressVersion === PTY_STARTUP_INGRESS_VERSION
        ? parsePtyStartupIngressIntent(params.startupIngress)
        : undefined
    const managed: ManagedPty = {
      id,
      incarnationId: randomUUID(),
      pty: term,
      initialCwd: cwd,
      buffered: new RecentPtyOutputBuffer({
        preserveChunkBoundaries: false,
        limit: REPLAY_BUFFER_MAX
      }),
      paneKey,
      tabId,
      ...(attachIdentity.paneKey || attachIdentity.tabId ? { attachIdentity } : {}),
      worktreeId,
      ...(explicitTerm !== undefined ? { explicitTerm } : {}),
      envToDelete,
      gitCredentialPromptGuarded,
      ownerBackend: resolvePtyOwnerBackend({
        platform: process.platform,
        shellPath: shell,
        wslDistro: terminalWindowsWslDistro
      }),
      ...(startupIngressIntent ? { startupIngressIntent } : {}),
      ...(terminalHandle ? { terminalHandle } : {}),
      ...(shouldProviderDeliverCommand
        ? {
            startupCommand: {
              command,
              delivered: false,
              waitForShellReady: shellLaunch.env.ORCA_SHELL_READY_MARKER === '1',
              scanState:
                shellLaunch.env.ORCA_SHELL_READY_MARKER === '1'
                  ? createShellReadyScanState()
                  : null,
              timer: null
            }
          }
        : {})
    }
    this.sourcePublication?.activate(id, managed.incarnationId, context)
    const sourceActivation =
      context && this.sourcePublication?.receivingActivation?.(id, context.clientId)
    this.wireAndStore(managed)
    if (context?.isStale() && !params.agentSessionEnsure && !params.agentSessionCreateOperationId) {
      // Why: if the client reconnected while pty.spawn was in flight, the
      // response is discarded and no renderer can own this PTY. Shut it down
      // immediately so it does not linger as an unreachable remote shell.
      this.releaseStartupCommand(managed)
      this.requestGracefulKill(managed, 'terminate stale')
    } else if (managed.startupCommand) {
      this.scheduleStartupCommandDelivery(
        managed,
        managed.startupCommand.waitForShellReady
          ? STARTUP_COMMAND_SHELL_READY_FALLBACK_MS
          : STARTUP_COMMAND_WRITE_DELAY_MS
      )
    }
    return {
      id,
      incarnationId: managed.incarnationId,
      ...(sourceActivation ? { sourceActivation } : {})
    }
  }

}
