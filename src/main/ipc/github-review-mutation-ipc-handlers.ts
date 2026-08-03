// Hosted source-control IPC handlers.
import { ipcMain } from 'electron'
import type {
  GitHubOwnerRepo,
  GitHubPullRequestStateUpdate
} from '../../shared/types'
import type { TaskSourceContext } from '../../shared/task-source-context'
import type { Store } from '../persistence'
import type { StatsCollector } from '../stats/collector'
import {
  setPRFileViewed,
  addPRReviewComment,
  addPRReviewCommentReply,
  updatePRTitle,
  mergePR,
  setPRAutoMerge,
  updatePRState,
  rerunPRChecks,
  requestPRReviewers,
  removePRReviewers
} from '../github/client'
import { broadcastWorkItemMutated, assertRegisteredRepo, repoConnectionId, localGitOptionArgs, type RepoScopedArgs } from './github-ipc-foundation'

export function registerGitHubReviewMutationHandlers(store: Store, stats: StatsCollector): void {
  ipcMain.handle(
      'gh:setPRFileViewed',
      async (
        event,
        args: {
          repoPath: string
          repoId?: string
          prNumber: number
          prRepo?: GitHubOwnerRepo | null
          pullRequestId: string
          path: string
          viewed: boolean
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        if (
          typeof args.prNumber !== 'number' ||
          !Number.isInteger(args.prNumber) ||
          args.prNumber < 1
        ) {
          return false
        }
        if (!args.pullRequestId?.trim() || !args.path?.trim()) {
          return false
        }
        const ok = await setPRFileViewed({
          repoPath: repo.path,
          connectionId: repoConnectionId(repo),
          localGitOptions: localGitOptionArgs(store, repo)[0],
          prRepo: args.prRepo ?? null,
          pullRequestId: args.pullRequestId.trim(),
          path: args.path,
          viewed: Boolean(args.viewed)
        })
        if (ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'pr', number: args.prNumber },
            event.sender.id
          )
        }
        return ok
      }
    )

  ipcMain.handle(
      'gh:addPRReviewCommentReply',
      async (
        event,
        args: {
          repoPath: string
          repoId?: string
          sourceContext?: TaskSourceContext | null
          prNumber: number
          commentId: number
          body: string
          threadId?: string
          path?: string
          line?: number
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        if (
          typeof args.prNumber !== 'number' ||
          !Number.isInteger(args.prNumber) ||
          args.prNumber < 1
        ) {
          return { ok: false, error: 'Invalid PR number' }
        }
        if (
          typeof args.commentId !== 'number' ||
          !Number.isInteger(args.commentId) ||
          args.commentId < 1
        ) {
          return { ok: false, error: 'Invalid comment ID' }
        }
        if (!args.body?.trim()) {
          return { ok: false, error: 'Comment body required' }
        }
        const result = await addPRReviewCommentReply(
          repo.path,
          args.prNumber,
          args.commentId,
          args.body.trim(),
          args.threadId,
          args.path,
          args.line,
          repoConnectionId(repo),
          args.prRepo ?? null,
          ...localGitOptionArgs(store, repo)
        )
        if (result.ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'pr', number: args.prNumber },
            event.sender.id
          )
        }
        return result
      }
    )

  ipcMain.handle(
      'gh:addPRReviewComment',
      async (
        event,
        args: {
          repoPath: string
          prNumber: number
          prRepo?: GitHubOwnerRepo | null
          commitId: string
          path: string
          line: number
          startLine?: number
          body: string
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        if (
          typeof args.prNumber !== 'number' ||
          !Number.isInteger(args.prNumber) ||
          args.prNumber < 1
        ) {
          return { ok: false, error: 'Invalid PR number' }
        }
        if (typeof args.line !== 'number' || !Number.isInteger(args.line) || args.line < 1) {
          return { ok: false, error: 'Invalid line number' }
        }
        if (
          args.startLine !== undefined &&
          (typeof args.startLine !== 'number' ||
            !Number.isInteger(args.startLine) ||
            args.startLine < 1 ||
            args.startLine > args.line)
        ) {
          return { ok: false, error: 'Invalid start line' }
        }
        if (!args.commitId?.trim()) {
          return { ok: false, error: 'Missing PR head SHA' }
        }
        if (!args.path?.trim()) {
          return { ok: false, error: 'File path required' }
        }
        if (!args.body?.trim()) {
          return { ok: false, error: 'Comment body required' }
        }
        const result = await addPRReviewComment({
          repoPath: repo.path,
          prRepo: args.prRepo ?? null,
          prNumber: args.prNumber,
          commitId: args.commitId.trim(),
          path: args.path,
          line: args.line,
          startLine: args.startLine,
          body: args.body.trim(),
          connectionId: repoConnectionId(repo),
          localGitOptions: localGitOptionArgs(store, repo)[0]
        })
        if (result.ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'pr', number: args.prNumber },
            event.sender.id
          )
        }
        return result
      }
    )

  ipcMain.handle(
      'gh:updatePRTitle',
      async (
        event,
        args: { repoPath: string; prNumber: number; title: string; prRepo?: GitHubOwnerRepo | null }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        const ok = await updatePRTitle(
          repo.path,
          args.prNumber,
          args.title,
          repoConnectionId(repo),
          args.prRepo ?? null,
          ...localGitOptionArgs(store, repo)
        )
        if (ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'pr', number: args.prNumber },
            event.sender.id
          )
        }
        return ok
      }
    )

  ipcMain.handle(
      'gh:mergePR',
      async (
        event,
        args: {
          repoPath: string
          repoId?: string | null
          sourceContext?: TaskSourceContext | null
          prNumber: number
          method?: 'merge' | 'squash' | 'rebase'
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        const result = await mergePR(
          repo.path,
          args.prNumber,
          args.method,
          repoConnectionId(repo),
          args.prRepo ?? null,
          ...localGitOptionArgs(store, repo)
        )
        if (result.ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'pr', number: args.prNumber },
            event.sender.id
          )
        }
        return result
      }
    )

  ipcMain.handle(
      'gh:setPRAutoMerge',
      async (
        event,
        args: {
          repoPath: string
          repoId?: string | null
          sourceContext?: TaskSourceContext | null
          prNumber: number
          enabled: boolean
          method?: 'merge' | 'squash' | 'rebase'
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        const result = await setPRAutoMerge(
          repo.path,
          args.prNumber,
          args.enabled,
          args.method,
          repoConnectionId(repo),
          args.prRepo ?? null,
          ...localGitOptionArgs(store, repo)
        )
        if (result.ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'pr', number: args.prNumber },
            event.sender.id
          )
        }
        return result
      }
    )

  ipcMain.handle(
      'gh:updatePRState',
      async (
        event,
        args: RepoScopedArgs & {
          prNumber: number
          updates: GitHubPullRequestStateUpdate
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        if (
          typeof args.prNumber !== 'number' ||
          !Number.isInteger(args.prNumber) ||
          args.prNumber < 1
        ) {
          return { ok: false, error: 'Invalid pull request number' }
        }
        const result = await updatePRState(
          repo.path,
          args.prNumber,
          args.updates,
          repoConnectionId(repo),
          args.prRepo ?? null,
          ...localGitOptionArgs(store, repo)
        )
        if (result.ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'pr', number: args.prNumber },
            event.sender.id
          )
        }
        return result
      }
    )

  ipcMain.handle(
      'gh:rerunPRChecks',
      async (
        _event,
        args: RepoScopedArgs & {
          prNumber: number
          headSha?: string
          failedOnly?: boolean
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        if (
          typeof args.prNumber !== 'number' ||
          !Number.isInteger(args.prNumber) ||
          args.prNumber < 1
        ) {
          return { ok: false, error: 'Invalid pull request number' }
        }
        return rerunPRChecks(
          repo.path,
          args.prNumber,
          { headSha: args.headSha, failedOnly: args.failedOnly, prRepo: args.prRepo ?? null },
          repoConnectionId(repo),
          ...localGitOptionArgs(store, repo)
        )
      }
    )

  ipcMain.handle(
      'gh:requestPRReviewers',
      async (
        event,
        args: RepoScopedArgs & {
          prNumber: number
          reviewers: string[]
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        const result = await requestPRReviewers(
          repo.path,
          args.prNumber,
          args.reviewers,
          repoConnectionId(repo),
          args.prRepo ?? null,
          ...localGitOptionArgs(store, repo)
        )
        if (result.ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'pr', number: args.prNumber },
            event.sender.id
          )
        }
        return result
      }
    )

  ipcMain.handle(
      'gh:removePRReviewers',
      async (
        event,
        args: RepoScopedArgs & {
          prNumber: number
          reviewers: string[]
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        const result = await removePRReviewers(
          repo.path,
          args.prNumber,
          args.reviewers,
          repoConnectionId(repo),
          args.prRepo ?? null,
          ...localGitOptionArgs(store, repo)
        )
        if (result.ok) {
          broadcastWorkItemMutated(
            { repoPath: repo.path, repoId: repo.id, type: 'pr', number: args.prNumber },
            event.sender.id
          )
        }
        return result
      }
    )
}
