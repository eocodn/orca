// Hosted source-control IPC handlers.
import { ipcMain } from 'electron'
import { resolve } from 'node:path'
import type {
  Repo,
  GitHubCreateIssueFields,
  GitHubIssueUpdate,
  GitHubOwnerRepo,
  GitHubPRRefreshCandidate,
  GitHubPRRefreshEnqueueResult,
  GitHubPRRefreshReason,
  PRRefreshOutcome,
  GitHubPRFile
} from '../../shared/types'
import type { TaskSourceContext } from '../../shared/task-source-context'
import type { Store } from '../persistence'
import type { StatsCollector } from '../stats/collector'
import {
  getPRForBranch,
  getIssue,
  listIssues,
  listWorkItems,
  countWorkItems,
  getWorkItem,
  getWorkItemByOwnerRepo,
  createIssue,
  updateIssue,
  addIssueComment,
  listLabels,
  listAssignableUsers
} from '../github/client'
import type { GitHubPRBranchLookupOptions } from '../github/client'
import {
  clearVisiblePRRefreshWindow,
  enqueuePRRefresh,
  refreshPRNow,
  reportVisiblePRRefreshCandidates,
  setPRRefreshOutcomeObserver
} from '../github/pr-refresh-coordinator'
import { getWorkItemDetails, getPRFileContents } from '../github/work-item-details'
import { dispatchWorkItem, type WorkItemArgs } from './github-work-item-args'
import { prRefreshVisibilityCleanupRegistered, broadcastWorkItemMutated, assertRegisteredRepo, repoConnectionId, localGitOptionArgs, applyRepoToPRRefreshCandidate, validateAutomaticPRRefreshCandidate, type RepoScopedArgs } from './github-ipc-foundation'

export function registerGitHubWorkItemHandlers(store: Store, stats: StatsCollector): void {
  function recordPRIfNeeded(repo: Repo, outcome: PRRefreshOutcome): void {
      if (outcome.kind === 'found' && !stats.hasCountedPR(outcome.pr.url)) {
        stats.record({
          type: 'pr_created',
          at: Date.now(),
          repoId: repo.id,
          meta: { prNumber: outcome.pr.number, prUrl: outcome.pr.url }
        })
      }
    }
  
    setPRRefreshOutcomeObserver((candidate, outcome) => {
      const repo =
        store.getRepos().find((r) => r.id === candidate.repoId) ??
        store.getRepos().find((r) => resolve(r.path) === resolve(candidate.repoPath))
      if (repo) {
        recordPRIfNeeded(repo, outcome)
      }
    })

  ipcMain.handle(
      'gh:prForBranch',
      async (
        _event,
        args: {
          repoPath: string
          branch: string
          linkedPRNumber?: number | null
          fallbackPRNumber?: number | null
          acceptMergedFallbackPR?: boolean
          currentHeadOid?: string | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        const localGitOptions = localGitOptionArgs(store, repo)[0]
        const hostedReviewOptionArgs: [] | [{ localGitExecOptions: { wslDistro?: string } }] =
          localGitOptions ? [{ localGitExecOptions: localGitOptions }] : []
        const currentHeadOid =
          typeof args.currentHeadOid === 'string' && args.currentHeadOid.trim().length > 0
            ? args.currentHeadOid.trim()
            : null
        const lookupOptions: GitHubPRBranchLookupOptions | undefined = hostedReviewOptionArgs[0]
          ? { ...hostedReviewOptionArgs[0] }
          : args.acceptMergedFallbackPR === true || currentHeadOid !== null
            ? {}
            : undefined
        if (lookupOptions && args.acceptMergedFallbackPR === true) {
          lookupOptions.acceptMergedFallbackPR = true
        }
        if (lookupOptions && currentHeadOid !== null) {
          lookupOptions.currentHeadOid = currentHeadOid
        }
        const lookupOptionArgs: [] | [GitHubPRBranchLookupOptions] = lookupOptions
          ? [lookupOptions]
          : []
        const pr = await getPRForBranch(
          repo.path,
          args.branch,
          args.linkedPRNumber ?? null,
          repoConnectionId(repo),
          args.linkedPRNumber == null ? (args.fallbackPRNumber ?? null) : null,
          ...lookupOptionArgs
        )
        // Emit pr_created when a PR is first detected for a branch.
        // Why here: the renderer polls gh:prForBranch to check PR status per worktree.
        // This captures PRs opened from any workflow (Orca UI, gh CLI, github.com).
        if (pr && !stats.hasCountedPR(pr.url)) {
          stats.record({
            type: 'pr_created',
            at: Date.now(),
            repoId: repo.id,
            meta: { prNumber: pr.number, prUrl: pr.url }
          })
        }
        return pr
      }
    )

  ipcMain.handle(
      'gh:refreshPRNow',
      async (_event, args: { candidate: GitHubPRRefreshCandidate }) => {
        const repo = assertRegisteredRepo(args.candidate, store)
        const outcome = await refreshPRNow(applyRepoToPRRefreshCandidate(store, repo, args.candidate))
        recordPRIfNeeded(repo, outcome)
        return outcome
      }
    )

  ipcMain.handle(
      'gh:enqueuePRRefresh',
      (
        event,
        args: {
          candidate: GitHubPRRefreshCandidate
          reason: GitHubPRRefreshReason
          priority?: number
        }
      ): GitHubPRRefreshEnqueueResult => {
        const validation = validateAutomaticPRRefreshCandidate(args.candidate, store)
        if (validation.kind === 'skipped') {
          return validation.result
        }
        const senderWindowId = event?.sender?.id
        enqueuePRRefresh(validation.candidate, args.reason, args.priority ?? 0, senderWindowId)
        return { kind: 'queued' }
      }
    )

  ipcMain.handle(
      'gh:reportVisiblePRRefreshCandidates',
      (event, args: { candidates: GitHubPRRefreshCandidate[]; generation: number }) => {
        const senderId = event.sender.id
        if (!prRefreshVisibilityCleanupRegistered.has(senderId)) {
          prRefreshVisibilityCleanupRegistered.add(senderId)
          event.sender.once('destroyed', () => {
            prRefreshVisibilityCleanupRegistered.delete(senderId)
            clearVisiblePRRefreshWindow(senderId)
          })
        }
        const candidates: GitHubPRRefreshCandidate[] = []
        const repos = store.getRepos()
        for (const candidate of args.candidates) {
          const validation = validateAutomaticPRRefreshCandidate(candidate, store, repos)
          if (validation.kind === 'ok') {
            candidates.push(validation.candidate)
          }
        }
        reportVisiblePRRefreshCandidates(candidates, args.generation, senderId)
        return true
      }
    )

  ipcMain.handle(
      'gh:issue',
      (
        _event,
        args: {
          repoPath: string
          repoId?: string | null
          sourceContext?: TaskSourceContext | null
          number: number
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        return getIssue(
          repo.path,
          args.number,
          repoConnectionId(repo),
          ...localGitOptionArgs(store, repo)
        )
      }
    )

  ipcMain.handle('gh:listIssues', (_event, args: { repoPath: string; limit?: number }) => {
      const repo = assertRegisteredRepo(args, store)
      // Why: listIssues now returns { items, error? }. The IPC handler unwraps to
      // the items array for the existing contract; feature 1's UI consumes the
      // richer envelope through `gh:listWorkItems` instead.
      return listIssues(
        repo.path,
        args.limit,
        repo.issueSourcePreference,
        repoConnectionId(repo),
        ...localGitOptionArgs(store, repo)
      ).then((r) => r.items)
    })

  ipcMain.handle(
      'gh:createIssue',
      (_event, args: RepoScopedArgs & { title: string; body: string } & GitHubCreateIssueFields) => {
        const repo = assertRegisteredRepo(args, store)
        const fields =
          args.labels !== undefined || args.assignees !== undefined
            ? { labels: args.labels, assignees: args.assignees }
            : undefined
        return createIssue(
          repo.path,
          args.title,
          args.body,
          repo.issueSourcePreference,
          repoConnectionId(repo),
          fields,
          ...localGitOptionArgs(store, repo)
        )
      }
    )

  ipcMain.handle(
      'gh:listWorkItems',
      (
        _event,
        args: {
          repoPath: string
          repoId?: string
          limit?: number
          query?: string
          page?: number
          noCache?: boolean
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        return listWorkItems(
          repo.path,
          args.limit,
          args.query,
          args.page,
          repo.issueSourcePreference,
          repoConnectionId(repo),
          args.noCache,
          ...localGitOptionArgs(store, repo)
        )
      }
    )

  ipcMain.handle('gh:countWorkItems', (_event, args: { repoPath: string; query?: string }) => {
      const repo = assertRegisteredRepo(args, store)
      return countWorkItems(
        repo.path,
        args.query,
        repo.issueSourcePreference,
        repoConnectionId(repo),
        ...localGitOptionArgs(store, repo)
      )
    })

  ipcMain.handle('gh:workItem', (_event, args: WorkItemArgs) => {
      const repo = assertRegisteredRepo(args, store)
      return dispatchWorkItem(args, repo, getWorkItem, localGitOptionArgs(store, repo)[0])
    })

  ipcMain.handle(
      'gh:workItemByOwnerRepo',
      (
        _event,
        args: {
          repoPath: string
          owner: string
          repo: string
          host?: string
          number: number
          type: 'issue' | 'pr'
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        return getWorkItemByOwnerRepo(
          repo.path,
          // Why: Enterprise host identity must survive the IPC boundary or the
          // lookup falls back to gh's default host for a same-named repo.
          { owner: args.owner, repo: args.repo, ...(args.host ? { host: args.host } : {}) },
          args.number,
          args.type,
          repoConnectionId(repo),
          ...localGitOptionArgs(store, repo)
        )
      }
    )

  ipcMain.handle('gh:workItemDetails', (_event, args: WorkItemArgs) => {
      const repo = assertRegisteredRepo(args, store)
      return dispatchWorkItem(args, repo, getWorkItemDetails, localGitOptionArgs(store, repo)[0])
    })

  ipcMain.handle(
      'gh:notifyWorkItemMutated',
      (
        event,
        args: {
          repoPath: string
          repoId?: string
          type: 'issue' | 'pr'
          number: number
        }
      ) => {
        const repo = args.repoId
          ? store.getRepos().find((candidate) => candidate.id === args.repoId)
          : assertRegisteredRepo(args, store)
        if (!repo) {
          return false
        }
        if (
          (args.type !== 'issue' && args.type !== 'pr') ||
          typeof args.number !== 'number' ||
          !Number.isInteger(args.number) ||
          args.number < 1
        ) {
          return false
        }
        broadcastWorkItemMutated(
          {
            repoPath: repo.path,
            repoId: repo.id,
            type: args.type,
            number: args.number
          },
          event.sender.id
        )
        return true
      }
    )

  ipcMain.handle(
      'gh:prFileContents',
      (
        _event,
        args: {
          repoPath: string
          prNumber: number
          prRepo?: GitHubOwnerRepo | null
          path: string
          oldPath?: string
          status: GitHubPRFile['status']
          headSha: string
          baseSha: string
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        return getPRFileContents({
          repoPath: repo.path,
          connectionId: repoConnectionId(repo),
          localGitOptions: localGitOptionArgs(store, repo)[0],
          prRepo: args.prRepo ?? null,
          prNumber: args.prNumber,
          path: args.path,
          oldPath: args.oldPath,
          status: args.status,
          headSha: args.headSha,
          baseSha: args.baseSha
        })
      }
    )

  ipcMain.handle(
      'gh:updateIssue',
      async (event, args: RepoScopedArgs & { number: number; updates: GitHubIssueUpdate }) => {
        const repo = assertRegisteredRepo(args, store)
        if (typeof args.number !== 'number' || !Number.isInteger(args.number) || args.number < 1) {
          return { ok: false, error: 'Invalid issue number' }
        }
        if (!args.updates || typeof args.updates !== 'object') {
          return { ok: false, error: 'Updates object is required' }
        }
        const result = await updateIssue(
          repo.path,
          args.number,
          args.updates,
          repoConnectionId(repo),
          ...localGitOptionArgs(store, repo)
        )
        if (result.ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'issue', number: args.number },
            event.sender.id
          )
        }
        return result
      }
    )

  ipcMain.handle(
      'gh:addIssueComment',
      async (
        event,
        args: {
          repoPath: string
          repoId?: string
          sourceContext?: TaskSourceContext | null
          number: number
          body: string
          type?: 'issue' | 'pr'
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        if (typeof args.number !== 'number' || !Number.isInteger(args.number) || args.number < 1) {
          return { ok: false, error: 'Invalid issue number' }
        }
        if (!args.body?.trim()) {
          return { ok: false, error: 'Comment body required' }
        }
        const result = await addIssueComment(
          repo.path,
          args.number,
          args.body.trim(),
          repoConnectionId(repo),
          args.prRepo ?? null,
          ...localGitOptionArgs(store, repo)
        )
        if (result.ok) {
          // Why: PR conversation comments hit `/issues/N/comments` too, but the
          // drawer's cache key uses type='pr'. The caller passes through which
          // drawer they're posting from so we only invalidate the matching key
          // — broadcasting both would evict an unrelated PR/issue that happens
          // to share the number.
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: args.type ?? 'issue', number: args.number },
            event.sender.id
          )
        }
        return result
      }
    )

  ipcMain.handle('gh:listLabels', (_event, args: RepoScopedArgs) => {
      const repo = assertRegisteredRepo(args, store)
      return listLabels(
        repo.path,
        repo.issueSourcePreference,
        repoConnectionId(repo),
        ...localGitOptionArgs(store, repo)
      )
    })

  ipcMain.handle('gh:listAssignableUsers', (_event, args: RepoScopedArgs) => {
      const repo = assertRegisteredRepo(args, store)
      return listAssignableUsers(
        repo.path,
        repo.issueSourcePreference,
        repoConnectionId(repo),
        ...localGitOptionArgs(store, repo)
      )
    })
  
    // Star operations target the Orca repo itself — no repoPath validation needed
}
