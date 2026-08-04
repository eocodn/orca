// Filesystem, search, and source-control IPC handlers.
import { ipcMain } from 'electron'
import { gitExecFileAsync } from '../git/runner'
import type { Store } from '../persistence'
import type {
  GlobalSettings,
  TuiAgent
} from '../../shared/types'
import {
  getStagedCommitContext
} from '../git/status'
import {
  cancelGenerateCommitMessageLocal,
  cancelGeneratePullRequestFieldsLocal,
  discoverCommitMessageModelsLocal,
  discoverCommitMessageModelsRemote,
  generateCommitMessageFromContext,
  generatePullRequestFieldsFromContext,
  resolveCommitMessageSettings,
  type DiscoverCommitMessageModelsResult,
  type GenerateCommitMessageResult,
  type GeneratePullRequestFieldsResult
} from '../text-generation/commit-message-text-generation'
import { getPullRequestDraftContext } from '../text-generation/pull-request-context'
import { getCommitMessageModelDiscoveryHostKey } from '../../shared/commit-message-host-key'
import type { HostedReviewProvider } from '../../shared/hosted-review'
import type { ResolvedSourceControlAiGenerationParams } from '../../shared/source-control-ai'
import { withLinkedIssueDraftContext } from '../../shared/source-control-ai-action-variables'
import { resolveRegisteredWorktreePath } from './filesystem-auth'
import { getLocalGitOptionsForRegisteredWorktree } from './local-worktree-runtime-options'
import { resolveSourceControlAiLinkedIssue } from './source-control-ai-linked-issue'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-git-dispatch'
import { resolveHostedReviewBodyForGeneration } from '../source-control/pull-request-template'
import {
  prepareLocalCommitMessageAgentEnv,
  type CommitMessageAgentRuntimeTarget,
  type CommitMessageAgentEnvironmentResolvers
} from '../text-generation/commit-message-agent-environment'

import { getRepoForSourceControlAi, getLocalAgentRuntimeTarget, getLocalTextGenerationTarget } from './filesystem-ipc-foundation'

export function registerFilesystemGitGenerationHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {
  ipcMain.handle(
      'git:generateCommitMessage',
      async (
        _event,
        args: {
          worktreePath: string
          // Raw (unstripped) meta key; validated against worktreePath before any meta read.
          worktreeId?: string
          repoId?: string
          connectionId?: string
          sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
          sourceControlAi?: GlobalSettings['sourceControlAi']
          agentCmdOverrides?: GlobalSettings['agentCmdOverrides']
        }
      ): Promise<GenerateCommitMessageResult> => {
        const discoveryHostKey = getCommitMessageModelDiscoveryHostKey(args.connectionId ?? null)
        const baseSettings = store.getSettings()
        const requestSettings = {
          ...baseSettings,
          ...(args.sourceControlAi !== undefined ? { sourceControlAi: args.sourceControlAi } : {}),
          ...(args.agentCmdOverrides !== undefined
            ? { agentCmdOverrides: args.agentCmdOverrides }
            : {})
        }
        const resolvedSettings = args.sourceControlAiResolvedParams
          ? { ok: true as const, params: args.sourceControlAiResolvedParams }
          : resolveCommitMessageSettings(
              requestSettings,
              discoveryHostKey,
              'commitMessage',
              await getRepoForSourceControlAi(store, args)
            )
        if (!resolvedSettings.ok) {
          return { success: false, error: resolvedSettings.error }
        }
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return {
              success: false,
              error: SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
            }
          }
          let context
          try {
            context = await provider.getStagedCommitContext(args.worktreePath)
          } catch (error) {
            console.error('[filesystem] Failed to read remote staged commit context:', error)
            return {
              success: false,
              error: 'Failed to read staged changes.'
            }
          }
          if (!context) {
            return { success: false, error: 'No staged changes to summarize.' }
          }
          context = withLinkedIssueDraftContext(
            context,
            resolveSourceControlAiLinkedIssue(store, args)
          )
          return generateCommitMessageFromContext(context, resolvedSettings.params, {
            kind: 'remote',
            cwd: args.worktreePath,
            execute: (plan, cwd, timeoutMs, operation) =>
              provider.executeCommitMessagePlan(plan, cwd, timeoutMs, operation),
            missingBinaryLocation: 'remote PATH'
          })
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        let context
        try {
          context = await getStagedCommitContext(worktreePath, gitOptions)
        } catch (error) {
          console.error('[filesystem] Failed to read staged commit context:', error)
          return {
            success: false,
            error: 'Failed to read staged changes.'
          }
        }
        if (!context) {
          return { success: false, error: 'No staged changes to summarize.' }
        }
        context = withLinkedIssueDraftContext(
          context,
          resolveSourceControlAiLinkedIssue(store, args, worktreePath)
        )
        const localEnv = await prepareLocalCommitMessageAgentEnv(
          resolvedSettings.params.agentId,
          commitMessageAgentEnv,
          getLocalAgentRuntimeTarget(gitOptions)
        )
        if (!localEnv.ok) {
          return { success: false, error: localEnv.error }
        }
        return generateCommitMessageFromContext(
          context,
          resolvedSettings.params,
          getLocalTextGenerationTarget(worktreePath, gitOptions, localEnv.env)
        )
      }
    )

  ipcMain.handle(
      'git:cancelGenerateCommitMessage',
      async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return
          }
          await provider.cancelGenerateCommitMessage(args.worktreePath, 'commit-message')
          return
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        cancelGenerateCommitMessageLocal(worktreePath)
      }
    )

  ipcMain.handle(
      'git:discoverCommitMessageModels',
      async (
        _event,
        args: { agentId: string; worktreePath?: string; connectionId?: string }
      ): Promise<DiscoverCommitMessageModelsResult> => {
        const agentId = args.agentId
        const agentCommandOverride = store.getSettings().agentCmdOverrides?.[agentId as TuiAgent]
        if (args.connectionId) {
          if (!args.worktreePath) {
            return { success: false, error: 'Missing worktree path for remote model discovery.' }
          }
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return {
              success: false,
              error: `No git provider for connection "${args.connectionId}"`
            }
          }
          return discoverCommitMessageModelsRemote(
            agentId as TuiAgent,
            args.worktreePath,
            (plan, cwd, timeoutMs) => provider.executeCommitMessagePlan(plan, cwd, timeoutMs),
            agentCommandOverride
          )
        }
        let localRuntimeTarget: CommitMessageAgentRuntimeTarget = { runtime: 'host' }
        let localDiscoveryOptions: Parameters<typeof discoverCommitMessageModelsLocal>[3]
        if (args.worktreePath) {
          const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
          const gitOptions = getLocalGitOptionsForRegisteredWorktree(
            store,
            args.worktreePath,
            worktreePath
          )
          localRuntimeTarget = getLocalAgentRuntimeTarget(gitOptions)
          localDiscoveryOptions = gitOptions.wslDistro
            ? { cwd: worktreePath, wslDistro: gitOptions.wslDistro }
            : { cwd: worktreePath }
        }
        const localEnv = await prepareLocalCommitMessageAgentEnv(
          agentId,
          commitMessageAgentEnv,
          localRuntimeTarget
        )
        if (!localEnv.ok) {
          return { success: false, error: localEnv.error }
        }
        return localDiscoveryOptions
          ? discoverCommitMessageModelsLocal(
              agentId as TuiAgent,
              localEnv.env,
              agentCommandOverride,
              localDiscoveryOptions
            )
          : discoverCommitMessageModelsLocal(agentId as TuiAgent, localEnv.env, agentCommandOverride)
      }
    )

  ipcMain.handle(
      'git:generatePullRequestFields',
      async (
        _event,
        args: {
          worktreePath: string
          // Raw (unstripped) meta key; validated against worktreePath before any meta read.
          worktreeId?: string
          repoId?: string
          base: string
          title: string
          body: string
          draft: boolean
          provider?: HostedReviewProvider
          useTemplate?: boolean
          connectionId?: string
          sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
          sourceControlAi?: GlobalSettings['sourceControlAi']
          agentCmdOverrides?: GlobalSettings['agentCmdOverrides']
        }
      ): Promise<GeneratePullRequestFieldsResult> => {
        const discoveryHostKey = getCommitMessageModelDiscoveryHostKey(args.connectionId ?? null)
        const baseSettings = store.getSettings()
        const requestSettings = {
          ...baseSettings,
          ...(args.sourceControlAi !== undefined ? { sourceControlAi: args.sourceControlAi } : {}),
          ...(args.agentCmdOverrides !== undefined
            ? { agentCmdOverrides: args.agentCmdOverrides }
            : {})
        }
        const resolvedSettings = args.sourceControlAiResolvedParams
          ? { ok: true as const, params: args.sourceControlAiResolvedParams }
          : resolveCommitMessageSettings(
              requestSettings,
              discoveryHostKey,
              'pullRequest',
              await getRepoForSourceControlAi(store, args)
            )
        if (!resolvedSettings.ok) {
          return { success: false, error: resolvedSettings.error }
        }
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return {
              success: false,
              error: SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
            }
          }
          let context: Awaited<ReturnType<typeof getPullRequestDraftContext>>
          try {
            const currentBody = await resolveHostedReviewBodyForGeneration({
              body: args.body,
              repoPath: args.worktreePath,
              connectionId: args.connectionId,
              provider: args.provider,
              useTemplate: args.useTemplate
            })
            context = await getPullRequestDraftContext(
              (argv) => provider.exec(argv, args.worktreePath),
              {
                base: args.base,
                currentTitle: args.title,
                currentBody,
                currentDraft: args.draft
              }
            )
          } catch (error) {
            return {
              success: false,
              error:
                error instanceof Error ? error.message : 'Failed to prepare branch for PR details.'
            }
          }
          if (!context) {
            return { success: false, error: 'No branch changes to summarize.' }
          }
          context = withLinkedIssueDraftContext(
            context,
            resolveSourceControlAiLinkedIssue(store, args)
          )
          return generatePullRequestFieldsFromContext(context, resolvedSettings.params, {
            kind: 'remote',
            cwd: args.worktreePath,
            execute: (plan, cwd, timeoutMs, operation) =>
              provider.executeCommitMessagePlan(plan, cwd, timeoutMs, operation),
            missingBinaryLocation: 'remote PATH'
          })
        }
  
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        const gitOptions = getLocalGitOptionsForRegisteredWorktree(
          store,
          args.worktreePath,
          worktreePath
        )
        let context: Awaited<ReturnType<typeof getPullRequestDraftContext>>
        try {
          const currentBody = await resolveHostedReviewBodyForGeneration({
            body: args.body,
            repoPath: worktreePath,
            connectionId: args.connectionId,
            provider: args.provider,
            useTemplate: args.useTemplate
          })
          context = await getPullRequestDraftContext(
            (argv, options) =>
              gitExecFileAsync(argv, { cwd: worktreePath, ...gitOptions, ...options }),
            {
              base: args.base,
              currentTitle: args.title,
              currentBody,
              currentDraft: args.draft
            }
          )
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to prepare branch for PR details.'
          }
        }
        if (!context) {
          return { success: false, error: 'No branch changes to summarize.' }
        }
        context = withLinkedIssueDraftContext(
          context,
          resolveSourceControlAiLinkedIssue(store, args, worktreePath)
        )
        const localEnv = await prepareLocalCommitMessageAgentEnv(
          resolvedSettings.params.agentId,
          commitMessageAgentEnv,
          getLocalAgentRuntimeTarget(gitOptions)
        )
        if (!localEnv.ok) {
          return { success: false, error: localEnv.error }
        }
        return generatePullRequestFieldsFromContext(
          context,
          resolvedSettings.params,
          getLocalTextGenerationTarget(worktreePath, gitOptions, localEnv.env)
        )
      }
    )

  ipcMain.handle(
      'git:cancelGeneratePullRequestFields',
      async (_event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
        if (args.connectionId) {
          const provider = getSshGitProvider(args.connectionId)
          if (!provider) {
            return
          }
          await provider.cancelGenerateCommitMessage(args.worktreePath, 'pull-request-fields')
          return
        }
        const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
        cancelGeneratePullRequestFieldsLocal(worktreePath)
      }
    )
}
