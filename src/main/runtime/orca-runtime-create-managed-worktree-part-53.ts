import { randomUUID, type AutomationWorkspaceProvenance, type CliWorkspaceProvenance, type CreateWorktreeResult, type GitPushTarget, type WorktreeStartupLaunch, type TuiAgent, type WorkspaceCreateTelemetrySource, type WorkspaceLinkedItem, type TaskSourceContext, getProjectHostSetupWorktreeMeta, isFolderRepo, isTuiAgentEnabled, getRuntimeFolderWorkspaceInstanceId, mergeRuntimeFolderWorkspace, type WorktreeStartupDraftPaste, ownerSurfacing, type WorktreeLineageInput } from './orca-runtime-symbols'
import { prepareLocalManagedWorktreeCreation } from './orca-runtime-create-managed-worktree-local'
import { completeManagedWorktreeCreation } from './orca-runtime-create-managed-worktree-finalization'
import { OrcaRuntimePasteStartupDraftWhenReadyPart52 } from './orca-runtime-paste-startup-draft-when-ready-part-52'

export class OrcaRuntimeCreateManagedWorktreePart53 extends OrcaRuntimePasteStartupDraftWhenReadyPart52 {
  async createManagedWorktree(args: {
    repoSelector: string
    name: string
    baseBranch?: string
    compareBaseRef?: string
    branchNameOverride?: string
    linkedIssue?: number | null
    linkedPR?: number | null
    linkedLinearIssue?: string
    linkedLinearIssueWorkspaceId?: string | null
    linkedLinearIssueOrganizationUrlKey?: string | null
    linkedGitLabMR?: number | null
    linkedGitLabIssue?: number | null
    linkedBitbucketPR?: number | null
    linkedAzureDevOpsPR?: number | null
    linkedGiteaPR?: number | null
    linkedWorkItem?: WorkspaceLinkedItem | null
    linkedTaskSourceContext?: TaskSourceContext | null
    comment?: string
    displayName?: string
    telemetrySource?: WorkspaceCreateTelemetrySource
    workspaceStatus?: string
    manualOrder?: number
    sparseCheckout?: { directories: string[]; presetId?: string }
    pushTarget?: GitPushTarget
    runHooks?: boolean
    activate?: boolean
    setupDecision?: 'run' | 'skip' | 'inherit'
    awaitTerminalProvisioning?: boolean
    observeSetupCompletion?: boolean
    createdWithAgent?: TuiAgent
    startupAgent?: TuiAgent
    startupPrompt?: string
    pendingFirstAgentMessageRename?: boolean
    automationProvenance?: AutomationWorkspaceProvenance
    cliProvenance?: CliWorkspaceProvenance
    startup?: WorktreeStartupLaunch
    startupDraft?: string
    startupDraftPaste?: WorktreeStartupDraftPaste
    lineage?: WorktreeLineageInput
  }): Promise<CreateWorktreeResult> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }

    const repo = await this.resolveRepoSelector(args.repoSelector)
    const createSettings = this.store.getSettings()
    const requestedAgent = args.startupAgent ?? args.createdWithAgent
    const requestedAgentEnabled =
      requestedAgent !== undefined
        ? isTuiAgentEnabled(requestedAgent, createSettings.disabledTuiAgents)
        : false
    if ((args.startup || args.startupAgent) && requestedAgent && !requestedAgentEnabled) {
      throw new Error('Selected agent is disabled. Choose an enabled agent before creating.')
    }
    if (
      args.startup &&
      args.startupDraftPaste &&
      !isTuiAgentEnabled(args.startupDraftPaste.agent, createSettings.disabledTuiAgents)
    ) {
      throw new Error('Selected agent is disabled. Choose an enabled agent before creating.')
    }
    const agentStartup =
      !args.startup && args.startupAgent
        ? this.buildStartupForAgent(repo, args.startupAgent, args.startupPrompt)
        : null
    const draftStartup =
      !args.startup && !agentStartup && args.startupDraft
        ? await this.buildStartupForDraft(repo, args.startupDraft, requestedAgent)
        : null
    const effectiveStartup = args.startup ?? agentStartup?.startup ?? draftStartup?.startup
    const effectiveStartupFollowup = agentStartup?.followup
    const effectiveCreatedWithAgent = args.startup
      ? args.createdWithAgent
      : (agentStartup?.agent ??
        draftStartup?.agent ??
        (requestedAgentEnabled ? requestedAgent : undefined))
    const effectiveDraftPaste = args.startupDraftPaste ?? draftStartup?.draftPaste
    if (isFolderRepo(repo)) {
      const now = Date.now()
      const settings = createSettings
      const instanceId = randomUUID()
      const worktreeId = getRuntimeFolderWorkspaceInstanceId(repo, instanceId)
      const meta = this.store.setWorktreeMeta(worktreeId, {
        instanceId,
        ...getProjectHostSetupWorktreeMeta(this.store.getProjectHostSetups?.() ?? [], repo),
        displayName: args.displayName?.trim() || args.name,
        lastActivityAt: now,
        createdAt: now,
        orcaCreatedAt: now,
        orcaCreationSource: 'runtime',
        orcaCreationWorkspaceLayout: {
          path: settings.workspaceDir,
          nestWorkspaces: settings.nestWorkspaces
        },
        ...(args.automationProvenance ? { automationProvenance: args.automationProvenance } : {}),
        ...(args.cliProvenance ? { cliProvenance: args.cliProvenance } : {}),
        ...(args.linkedIssue !== undefined ? { linkedIssue: args.linkedIssue } : {}),
        ...(args.linkedPR !== undefined ? { linkedPR: args.linkedPR } : {}),
        ...(args.linkedLinearIssue !== undefined
          ? { linkedLinearIssue: args.linkedLinearIssue }
          : {}),
        ...(args.linkedLinearIssueWorkspaceId !== undefined
          ? { linkedLinearIssueWorkspaceId: args.linkedLinearIssueWorkspaceId }
          : {}),
        ...(args.linkedLinearIssueOrganizationUrlKey !== undefined
          ? { linkedLinearIssueOrganizationUrlKey: args.linkedLinearIssueOrganizationUrlKey }
          : {}),
        ...(args.linkedGitLabIssue !== undefined
          ? { linkedGitLabIssue: args.linkedGitLabIssue }
          : {}),
        ...(args.linkedGitLabMR !== undefined ? { linkedGitLabMR: args.linkedGitLabMR } : {}),
        ...(args.linkedBitbucketPR !== undefined
          ? { linkedBitbucketPR: args.linkedBitbucketPR }
          : {}),
        ...(args.linkedAzureDevOpsPR !== undefined
          ? { linkedAzureDevOpsPR: args.linkedAzureDevOpsPR }
          : {}),
        ...(args.linkedGiteaPR !== undefined ? { linkedGiteaPR: args.linkedGiteaPR } : {}),
        ...(args.linkedWorkItem !== undefined ? { linkedWorkItem: args.linkedWorkItem } : {}),
        ...(args.linkedTaskSourceContext !== undefined
          ? { linkedTaskSourceContext: args.linkedTaskSourceContext }
          : {}),
        ...(effectiveCreatedWithAgent ? { createdWithAgent: effectiveCreatedWithAgent } : {}),
        ...(args.comment !== undefined ? { comment: args.comment } : {}),
        ...(args.manualOrder !== undefined ? { manualOrder: args.manualOrder } : {}),
        ...(args.workspaceStatus !== undefined ? { workspaceStatus: args.workspaceStatus } : {})
      })
      const worktree = mergeRuntimeFolderWorkspace(repo, worktreeId, meta)
      this.invalidateResolvedWorktreeCache()
      this.notifyWorktreesChanged(repo.id)
      this.emitWorktreeLifecycle({
        kind: 'created',
        worktreeId: worktree.id,
        path: worktree.path,
        branch: worktree.branch
      })
      const shouldActivate = args.activate === true || args.runHooks === true
      let warning: string | undefined
      let didSpawnStartup = false
      let startupTerminal: CreateWorktreeResult['startupTerminal']
      if (effectiveStartup && this.ptyController?.spawn) {
        try {
          const startupTrustAgent = effectiveDraftPaste?.agent ?? effectiveCreatedWithAgent
          if (startupTrustAgent) {
            this.markLocalWorkspaceTrustedForAgent(startupTrustAgent, worktree.path)
          }
          const terminal = await this.createTerminal(`id:${worktree.id}`, {
            command: effectiveStartup.command,
            env: effectiveStartup.env,
            ...(effectiveStartup.launchConfig
              ? { launchConfig: effectiveStartup.launchConfig }
              : {}),
            ...(effectiveCreatedWithAgent ? { launchAgent: effectiveCreatedWithAgent } : {}),
            ...(effectiveStartup.viewMode ? { viewMode: effectiveStartup.viewMode } : {}),
            startupCommandDelivery: effectiveStartup.startupCommandDelivery,
            telemetry: effectiveStartup.telemetry,
            ...ownerSurfacing(shouldActivate)
          })
          if (effectiveDraftPaste) {
            this.pasteStartupDraftWhenReady(terminal.handle, effectiveDraftPaste)
          }
          if (effectiveStartupFollowup) {
            this.sendStartupFollowupWhenReady(terminal.handle, effectiveStartupFollowup)
          }
          didSpawnStartup = true
          startupTerminal = {
            spawned: true,
            handle: terminal.handle,
            ...(terminal.tabId ? { tabId: terminal.tabId } : {}),
            ...(terminal.paneKey ? { paneKey: terminal.paneKey } : {}),
            ...(terminal.ptyId ? { ptyId: terminal.ptyId } : {}),
            surface: 'background'
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          warning = `Failed to create the startup terminal for ${worktree.path}: ${message}`
          console.warn(`[worktree-create] ${warning}`)
        }
      }
      if (shouldActivate) {
        if (effectiveStartup && !didSpawnStartup) {
          this.notifyActivateWorktree(repo.id, worktree.id, undefined, effectiveStartup)
        } else {
          this.notifyActivateWorktree(repo.id, worktree.id)
        }
      } else if (this.ptyController?.spawn && !didSpawnStartup) {
        try {
          await this.createTerminal(`id:${worktree.id}`, { surfaceOwner: false })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          warning = warning
            ? `${warning} Also failed to create the initial terminal for ${worktree.path}: ${message}`
            : `Failed to create the initial terminal for ${worktree.path}: ${message}`
          console.warn(`[worktree-create] ${warning}`)
        }
      }
      return {
        worktree: {
          ...worktree,
          parentWorktreeId: null,
          childWorktreeIds: [],
          lineage: null,
          git: {
            path: worktree.path,
            head: worktree.head,
            branch: worktree.branch,
            isBare: worktree.isBare,
            isMainWorktree: worktree.isMainWorktree
          }
        },
        ...(startupTerminal ? { startupTerminal } : {}),
        ...(warning ? { warning } : {})
      }
    }
    const lineageInput =
      args.lineage || args.comment ? { ...args.lineage, comment: args.comment } : undefined
    const lineageResolution = await this.resolveLineageForWorktreeCreate(lineageInput)
    if (repo.connectionId) {
      const result = await this.createManagedRemoteWorktree(repo, {
        ...args,
        activate: args.activate,
        ...(effectiveStartup ? { startup: effectiveStartup } : {}),
        ...(effectiveStartupFollowup ? { startupFollowup: effectiveStartupFollowup } : {}),
        ...(effectiveCreatedWithAgent ? { createdWithAgent: effectiveCreatedWithAgent } : {}),
        ...(effectiveDraftPaste ? { startupDraftPaste: effectiveDraftPaste } : {})
      })
      const recordedLineage = this.recordCreatedWorktreeLineage(result.worktree, lineageResolution)
      this.emitWorktreeLifecycle({
        kind: 'created',
        worktreeId: result.worktree.id,
        path: result.worktree.path,
        branch: result.worktree.branch
      })
      return {
        ...result,
        worktree: {
          ...result.worktree,
          parentWorktreeId: recordedLineage.lineage?.parentWorktreeId ?? null,
          childWorktreeIds: result.worktree.childWorktreeIds ?? [],
          lineage: recordedLineage.lineage,
          workspaceLineage: recordedLineage.workspaceLineage
        },
        ...(lineageInput
          ? {
              lineage: recordedLineage.lineage,
              workspaceLineage: recordedLineage.workspaceLineage,
              warnings: recordedLineage.warnings
            }
          : {})
      }
    }
    const prepared = await prepareLocalManagedWorktreeCreation(
      this,
      args,
      repo,
      createSettings
    )
    return completeManagedWorktreeCreation(this, {
      args,
      repo,
      lineageInput,
      lineageResolution,
      effectiveStartup,
      effectiveStartupFollowup,
      effectiveCreatedWithAgent,
      effectiveDraftPaste,
      ...prepared
    })

  }
}
