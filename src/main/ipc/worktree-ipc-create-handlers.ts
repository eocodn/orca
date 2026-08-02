import { ipcMain } from 'electron'
import type { CreateWorktreeArgs, CreateWorktreeResult, GitHubPrStartPoint, GitPushTarget } from '../../shared/types'
import { isFolderRepo } from '../../shared/repo-kind'
import { workspaceSourceSchema, type WorkspaceSource } from '../../shared/telemetry-events'
import { getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import { classifyWorkspaceCreateError } from './workspace-create-error-classifier'
import { prefetchWorktreeCreateBase } from '../worktree-create-base-prefetch'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import {
  createLocalWorktree,
  createRemoteWorktree,
  notifyWorktreesChanged
} from './worktree-remote'
import { gitExecFileAsync } from '../git/runner'
import { withWorktreeSpan } from '../observability/instrumentation'
import { resolveGitHubPrStartPoint } from '../github/pr-start-point'
import { fetchGitHubPullRequestHeadRef, fetchPrHeadTrackingRef } from '../github/pr-head-tracking-ref'
import { resolveGitHubReviewHeadRemote } from '../github/review-head-remote'
import {
  finishAutomationWorkspaceProvenanceRequest,
  releaseAutomationWorkspaceProvenanceRequest,
  resolveAutomationWorkspaceProvenance
} from '../automations/workspace-provenance'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import { track } from '../telemetry/client'
import type { CreateWorktreeArgsWithSystemProvenance } from './worktree-ipc-foundation'
import { createFolderWorkspace } from './worktree-ipc-local'
import { normalizeLinkedWorkItemFields } from './worktree-ipc-foundation'
import type { WorktreeIpcRegistrationContext } from './worktree-ipc-registration-context'

export function registerWorktreeCreationHandlers({
  mainWindow,
  store,
  runtime,
  options
}: Pick<WorktreeIpcRegistrationContext, 'mainWindow' | 'store' | 'runtime' | 'options'>): void {
  ipcMain.handle(
    'worktrees:prefetchCreateBase',
    async (_event, args: { repoId: string; baseBranch?: string }): Promise<void> => {
      const repo = store.getRepo(args.repoId)
      if (!repo) {
        return
      }
      try {
        await prefetchWorktreeCreateBase({ repo, baseBranch: args.baseBranch, runtime })
      } catch {
        // Why: optimistic warm-up; the real create path awaits the same refresh and reports failures there.
      }
    }
  )

  ipcMain.handle(
    'worktrees:create',
    async (_event, rawArgs: CreateWorktreeArgs): Promise<CreateWorktreeResult> => {
      const args = normalizeLinkedWorkItemFields(rawArgs)
      // Why span here: parent the child git spans for the trace tree; don't attach branch name/remote URL (user content) — repo ID is the safer correlator.
      return withWorktreeSpan({ stage: 'create' }, async () => {
        const repo = store.getRepo(args.repoId)
        if (!repo) {
          throw new Error(`Repo not found: ${args.repoId}`)
        }

        const sourceParse = workspaceSourceSchema.safeParse(args.telemetrySource)
        const source: WorkspaceSource = sourceParse.success ? sourceParse.data : 'unknown'

        const automationProvenance = resolveAutomationWorkspaceProvenance({
          authority: runtime,
          repoSelector: args.repoId,
          repo,
          request: args.automationProvenanceRequest
        })
        const createArgs: CreateWorktreeArgsWithSystemProvenance = {
          ...args,
          automationProvenance
        }

        let result: CreateWorktreeResult
        try {
          // Why: wrap only the helpers; the pre-validation throws above are IPC-shape bugs, not the git/filesystem failures the funnel tracks.
          result = isFolderRepo(repo)
            ? createFolderWorkspace(createArgs, repo, store)
            : repo.connectionId
              ? await createRemoteWorktree(createArgs, repo, store, mainWindow)
              : await createLocalWorktree(createArgs, repo, store, mainWindow, runtime)
        } catch (error) {
          releaseAutomationWorkspaceProvenanceRequest(args.automationProvenanceRequest)
          track('workspace_create_failed', {
            source,
            error_class: classifyWorkspaceCreateError(error),
            ...getCohortAtEmit()
          })
          throw error
        }
        finishAutomationWorkspaceProvenanceRequest(args.automationProvenanceRequest)

        // Why: reaching here means create succeeded (helpers throw); skip a separate workspace_initialized (telemetry-plan.md§Deferred); never send the branch name.
        track('workspace_created', {
          source,
          from_existing_branch:
            !isFolderRepo(repo) &&
            typeof args.baseBranch === 'string' &&

            args.baseBranch.length > 0,
          ...getCohortAtEmit()
        })

        if (isFolderRepo(repo)) {
          notifyWorktreesChanged(mainWindow, repo.id)
        }

        options?.onWorktreeLifecycle?.({
          kind: 'created',
          worktreeId: result.worktree.id,
          path: result.worktree.path,
          branch: result.worktree.branch
        })

        return result
      })
    }
  )

  ipcMain.handle(
    'worktrees:resolvePrBase',
    async (
      _event,
      args: {
        repoId: string
        prNumber: number
        headRefName?: string
        baseRefName?: string
        isCrossRepository?: boolean
      }
    ): Promise<GitHubPrStartPoint | { error: string }> => {
      const repo = store.getRepo(args.repoId)
      if (!repo) {
        return { error: 'Repo not found' }
      }
      if (isFolderRepo(repo)) {
        return { error: 'Folder mode does not support creating worktrees.' }
      }
      const gitExec = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
        if (!repo.connectionId) {
          return gitExecFileAsync(args, getLocalProjectGitExecOptions(store, repo))
        }
        const provider = getSshGitProvider(repo.connectionId)
        if (!provider) {
          throw new Error(
            'SSH Git provider is not available. Reconnect to this target and try again.'
          )
        }
        return provider.exec(args, repo.path)
      }
      // Why: SSH review-head fetches require narrow write-capable RPCs.
      const fetchRemoteTrackingRef = (remote: string, branch: string): Promise<void> =>
        fetchPrHeadTrackingRef(
          repo,
          repo.connectionId ? getSshGitProvider(repo.connectionId) : undefined,
          remote,
          branch,
          { localGitExecOptions: getLocalProjectGitExecOptions(store, repo) }
        )
      const fetchPullRequestHeadRef = (remote: string, prNumber: number): Promise<string> =>
        fetchGitHubPullRequestHeadRef(
          repo,
          repo.connectionId ? getSshGitProvider(repo.connectionId) : undefined,
          remote,
          prNumber,
          { localGitExecOptions: getLocalProjectGitExecOptions(store, repo) }
        )

      return resolveGitHubPrStartPoint({
        repoPath: repo.path,
        prNumber: args.prNumber,
        headRefName: args.headRefName,
        baseRefName: args.baseRefName,
        isCrossRepository: args.isCrossRepository,
        issueSourcePreference: repo.issueSourcePreference,
        connectionId: repo.connectionId ?? null,
        localGitOptions: getLocalProjectWorktreeGitOptions(store, repo),
        gitExec,
        fetchRemoteTrackingRef,
        fetchPullRequestHeadRef,
        // Why: one resolver keeps source preference and hosting identity aligned
        // across local, WSL, and SSH worktree creation.
        resolveRemote: () =>
          resolveGitHubReviewHeadRemote({
            repoPath: repo.path,
            issueSourcePreference: repo.issueSourcePreference,
            connectionId: repo.connectionId ?? null,
            localGitOptions: getLocalProjectWorktreeGitOptions(store, repo),
            gitExec
          })
      })
    }
  )

  // Why: keep desktop IPC and mobile/runtime RPC on the same MR-base path so SSH repos don't regress differently per surface.
  ipcMain.handle(
    'worktrees:resolveMrBase',
    async (
      _event,
      args: {
        repoId: string
        mrIid: number
        sourceBranch?: string
        targetBranch?: string
        isCrossRepository?: boolean
      }
    ): Promise<
      | { baseBranch: string; compareBaseRef?: string; pushTarget?: GitPushTarget }
      | { error: string }
    > => {
      return runtime.resolveManagedMrBase({
        repoSelector: `id:${args.repoId}`,
        mrIid: args.mrIid,
        sourceBranch: args.sourceBranch,
        targetBranch: args.targetBranch,
        isCrossRepository: args.isCrossRepository
      })
    }
  )

}
