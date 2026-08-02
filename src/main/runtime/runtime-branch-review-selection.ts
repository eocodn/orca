import { getPRForBranch } from '../github/client'
import { gitExecFileAsync } from '../git/runner'
import { listWorktrees } from '../git/worktree'
import { computeValidatedBranchName } from '../ipc/worktree-logic'
import { getHostedReviewForBranch as getHostedReviewForBranchFromRepo } from '../source-control/hosted-review'
import type { ForgeProviderId } from '../source-control/forge-provider'
import type { BranchPrefixStrategy, GitPushTarget, Repo } from '../../shared/types'
import type { HostedReviewInfo } from '../../shared/hosted-review'

export async function resolveCreateBranchName(
  repoPath: string,
  branchNameOverride: string | undefined,
  sanitizedName: string,
  settings: { branchPrefix: string; branchPrefixCustom?: string },
  username: string | null,
  gitOptions: { wslDistro?: string } = {}
): Promise<string> {
  if (!branchNameOverride) {
    return computeValidatedBranchName(
      sanitizedName,
      { ...settings, branchPrefix: settings.branchPrefix as BranchPrefixStrategy },
      username
    )
  }
  if (branchNameOverride.startsWith('-')) {
    throw new Error('Branch name must not start with "-"')
  }
  await gitExecFileAsync(['check-ref-format', '--branch', branchNameOverride], {
    cwd: repoPath,
    ...gitOptions
  })
  return branchNameOverride
}

export function normalizeLocalBranchName(branchName: string | undefined): string {
  return branchName?.replace(/^refs\/heads\//, '') ?? ''
}

export function clampTerminalViewport(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Math.max(20, Math.min(240, Math.round(cols))),
    rows: Math.max(8, Math.min(120, Math.round(rows)))
  }
}

export function addListenerToMap<T>(
  map: Map<string, Set<T>>,
  key: string,
  listener: T
): () => void {
  let listeners = map.get(key)
  if (!listeners) {
    listeners = new Set<T>()
    map.set(key, listeners)
  }
  const set = listeners
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) {
      map.delete(key)
    }
  }
}

export async function canCheckoutExistingLocalBranch(
  repoPath: string,
  branchName: string,
  baseBranch: string,
  gitOptions: { wslDistro?: string } = {}
): Promise<boolean> {
  let localHead = ''
  try {
    const { stdout } = await gitExecFileAsync(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}^{commit}`],
      { cwd: repoPath, ...gitOptions }
    )
    localHead = stdout.trim()
  } catch {
    return false
  }
  if (normalizeLocalBranchName(baseBranch) !== branchName) {
    if (!localHead) {
      return false
    }
    try {
      const { stdout } = await gitExecFileAsync(
        ['rev-parse', '--verify', '--quiet', `${baseBranch}^{commit}`],
        { cwd: repoPath, ...gitOptions }
      )
      if (stdout.trim() !== localHead) {
        return false
      }
    } catch {
      return false
    }
  }
  const worktrees = await listWorktrees(repoPath, gitOptions)
  return !worktrees.some((worktree) => normalizeLocalBranchName(worktree.branch) === branchName)
}

export function hasLocalGitOptions(gitOptions: { wslDistro?: string }): boolean {
  return Object.keys(gitOptions).length > 0
}

export function getLocalGitHubPrForBranch(
  repoPath: string,
  branchName: string,
  gitOptions: { wslDistro?: string }
): ReturnType<typeof getPRForBranch> {
  return hasLocalGitOptions(gitOptions)
    ? getPRForBranch(repoPath, branchName, null, null, null, { localGitExecOptions: gitOptions })
    : getPRForBranch(repoPath, branchName)
}

export type SelectedReviewBranchInput = {
  branchNameOverride?: string
  linkedPR?: number | null
  linkedGitLabMR?: number | null
  linkedBitbucketPR?: number | null
  linkedAzureDevOpsPR?: number | null
  linkedGiteaPR?: number | null
  pushTarget?: GitPushTarget
}

export type SelectedReviewBranch = { provider: ForgeProviderId; number: number }

export function getSelectedReviewBranch(
  args: SelectedReviewBranchInput
): SelectedReviewBranch | null {
  if (typeof args.linkedPR === 'number') {
    return { provider: 'github', number: args.linkedPR }
  }
  if (typeof args.linkedGitLabMR === 'number') {
    return { provider: 'gitlab', number: args.linkedGitLabMR }
  }
  if (typeof args.linkedBitbucketPR === 'number') {
    return { provider: 'bitbucket', number: args.linkedBitbucketPR }
  }
  if (typeof args.linkedAzureDevOpsPR === 'number') {
    return { provider: 'azure-devops', number: args.linkedAzureDevOpsPR }
  }
  if (typeof args.linkedGiteaPR === 'number') {
    return { provider: 'gitea', number: args.linkedGiteaPR }
  }
  return null
}

export function isSelectedGitHubPrBranchOverride(
  args: SelectedReviewBranchInput,
  branchName: string
): boolean {
  return typeof args.linkedPR === 'number' && args.branchNameOverride === branchName
}

export function isSelectedReviewBranchOverride(
  args: SelectedReviewBranchInput,
  branchName: string
): boolean {
  return getSelectedReviewBranch(args) !== null && args.branchNameOverride === branchName
}

export function isMatchingSelectedGitHubPr(
  existingPR: Awaited<ReturnType<typeof getPRForBranch>>,
  args: SelectedReviewBranchInput,
  branchName: string
): boolean {
  return Boolean(
    existingPR &&
    isSelectedGitHubPrBranchOverride(args, branchName) &&
    existingPR.number === args.linkedPR
  )
}

export function isAllowedPushTargetRemoteConflict(
  conflictKind: 'local' | 'remote' | null,
  branchName: string,
  args: SelectedReviewBranchInput
): boolean {
  return (
    conflictKind === 'remote' &&
    isSelectedReviewBranchOverride(args, branchName) &&
    args.pushTarget?.branchName === branchName
  )
}

export function getSelectedReviewLookupHints(args: SelectedReviewBranchInput): {
  linkedGitHubPR?: number | null
  linkedGitLabMR?: number | null
  linkedBitbucketPR?: number | null
  linkedAzureDevOpsPR?: number | null
  linkedGiteaPR?: number | null
} {
  return {
    linkedGitHubPR: args.linkedPR ?? null,
    linkedGitLabMR: args.linkedGitLabMR ?? null,
    linkedBitbucketPR: args.linkedBitbucketPR ?? null,
    linkedAzureDevOpsPR: args.linkedAzureDevOpsPR ?? null,
    linkedGiteaPR: args.linkedGiteaPR ?? null
  }
}

export async function getSelectedHostedReviewForBranch(
  repo: Pick<Repo, 'path' | 'connectionId'>,
  branchName: string,
  args: SelectedReviewBranchInput,
  executionOptions: { localGitExecOptions?: { wslDistro?: string } } = {}
): Promise<{ matchesSelected: boolean; number: number } | null> {
  const selectedReview = getSelectedReviewBranch(args)
  if (!selectedReview) {
    return null
  }
  const review: HostedReviewInfo | null = await getHostedReviewForBranchFromRepo({
    repoPath: repo.path,
    connectionId: repo.connectionId ?? null,
    branch: branchName,
    ...executionOptions,
    ...getSelectedReviewLookupHints(args)
  })
  if (!review) {
    return null
  }
  return {
    matchesSelected:
      review.provider === selectedReview.provider && review.number === selectedReview.number,
    number: review.number
  }
}
