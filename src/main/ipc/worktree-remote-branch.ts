// Why: worktree create helpers (local + remote) split out of worktrees.ts; the cohesive create flow runs this file just over the per-file line limit.

import type { BrowserWindow } from 'electron'
import { posix, win32 } from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Store } from '../persistence'
import type {
  AutomationWorkspaceProvenance,
  CliWorkspaceProvenance,
  CreateWorktreeArgs,
  CreateWorktreeResult,
  GitPushTarget,
  GlobalSettings,
  LocalBaseRefRefreshResult,
  LocalBaseRefUpdateSuggestion,
  Repo,
  Worktree,
  WorktreeCreateBaseFallback,
  WorktreeHeadIdentity,
  WorktreeMeta
} from '../../shared/types'
import { getPRForBranch } from '../github/client'
import { listWorktrees, addWorktree, addSparseWorktree } from '../git/worktree'
import type { AddWorktreeOptions, AddWorktreeResult } from '../git/worktree'
import {
  getBranchConflictKind,
  resolveDefaultBaseRefViaExec,
  resolveDefaultBaseRefWithLocalGit
} from '../git/repo'
import { resolveLocalGitUsername, getSshGitUsername } from '../git/git-username'
import { hasCommitObjectViaGitExec } from '../git/commit-object-ref'
import { resolveWorktreeCreateBase } from '../worktree-create-base'
import { resolveWorktreeAddBaseRef } from '../../shared/worktree-base-ref'
import { getHostedReviewForBranch } from '../source-control/hosted-review'
import type { ForgeProviderId } from '../source-control/forge-provider'
import { validateGitPushTarget } from '../git/push-target-validation'
import { assertGitPushTargetShape } from '../../shared/git-push-target-validation'
import { gitExecFileAsync } from '../git/runner'
import { parseGitHubOwnerRepo } from '../github/gh-utils'
import type {
  OrcaRuntimeService,
  RemoteFetchResult,
  RemoteTrackingBase
} from '../runtime/orca-runtime'
import { getProjectHostSetupWorktreeMeta } from '../../shared/project-host-setup-projection'
import {
  buildPosixRunnerScript,
  buildWindowsRunnerScript,
  createSetupRunnerScript,
  getDefaultTabsLaunch,
  getEffectiveHooks,
  getEffectiveHooksFromConfig,
  getSetupRunnerEnvVars,
  loadHooks,
  parseOrcaYaml,
  shouldRunSetupForCreate
} from '../hooks'
import { requireSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import type { SshGitProvider } from '../providers/ssh-git-provider'
import { TUI_AGENT_CONFIG, isTuiAgent } from '../../shared/tui-agent-config'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { runWorktreeChangeInvalidators } from './worktree-change-invalidators'
import {
  registerOptionalSshWorktreeCreateRoots,
  registerRequiredSshWorktreeCreateRoots
} from './ssh-worktree-create-root-registration'
import type { IFilesystemProvider } from '../providers/types'
import { isENOENT } from './filesystem-auth'

import * as context from './worktree-remote-context'


export function normalizeLocalBranchName(branchName: string | undefined): string {
  return branchName?.replace(/^refs\/heads\//, '') ?? ''
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
      {
        cwd: repoPath,
        ...gitOptions
      }
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

export function hasLocalCommitObjectWithOptions(
  repoPath: string,
  ref: string,
  gitOptions: { wslDistro?: string }
): Promise<boolean> {
  return hasCommitObjectViaGitExec(
    (gitArgs) => gitExecFileAsync(gitArgs, { cwd: repoPath, ...gitOptions }),
    ref
  )
}

export async function hasLocalWorktreeBaseRefWithOptions(
  repoPath: string,
  baseRef: string,
  gitOptions: { wslDistro?: string }
): Promise<boolean> {
  const refExists = async (qualifiedRef: string) => {
    try {
      const { stdout } = await gitExecFileAsync(
        ['rev-parse', '--verify', '--quiet', `${qualifiedRef}^{commit}`],
        {
          cwd: repoPath,
          ...gitOptions
        }
      )
      return stdout.trim().length > 0
    } catch {
      return false
    }
  }
  const resolvedBaseRef = await resolveWorktreeAddBaseRef(baseRef, refExists)
  if (resolvedBaseRef !== baseRef) {
    return true
  }
  if (baseRef.startsWith('refs/')) {
    return refExists(baseRef)
  }
  return hasLocalCommitObjectWithOptions(repoPath, baseRef, gitOptions)
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

export function hasRemoteCommitObject(
  provider: SshGitProvider,
  repoPath: string,
  ref: string
): Promise<boolean> {
  return hasCommitObjectViaGitExec((gitArgs) => provider.exec(gitArgs, repoPath), ref)
}

export async function hasRemoteWorktreeBaseRef(
  provider: SshGitProvider,
  repoPath: string,
  baseRef: string
): Promise<boolean> {
  const refExists = (qualifiedRef: string) =>
    hasRemoteTrackingRefSsh(provider, repoPath, qualifiedRef)
  const resolvedBaseRef = await resolveWorktreeAddBaseRef(baseRef, refExists)
  if (resolvedBaseRef !== baseRef) {
    return true
  }
  if (baseRef.startsWith('refs/')) {
    return refExists(baseRef)
  }
  return hasRemoteCommitObject(provider, repoPath, baseRef)
}

// Why: hasRemoteCommitObject resolves only SHAs, not symbolic remote-tracking refs; detect those directly for the fetch-failed local fallback.
export async function hasRemoteTrackingRefSsh(
  provider: SshGitProvider,
  repoPath: string,
  ref: string
): Promise<boolean> {
  try {
    const { stdout } = await provider.exec(
      ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      repoPath
    )
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

export async function canCheckoutExistingLocalBranchSsh(
  provider: SshGitProvider,
  repoPath: string,
  branchName: string,
  baseBranch: string
): Promise<boolean> {
  let localHead = ''
  try {
    const { stdout } = await provider.exec(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}^{commit}`],
      repoPath
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
      const { stdout } = await provider.exec(
        ['rev-parse', '--verify', '--quiet', `${baseBranch}^{commit}`],
        repoPath
      )
      if (stdout.trim() !== localHead) {
        return false
      }
    } catch {
      return false
    }
  }
  const worktrees = await provider.listWorktrees(repoPath)
  return !worktrees.some((worktree) => normalizeLocalBranchName(worktree.branch) === branchName)
}

async function listSshRemoteNames(provider: SshGitProvider, repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await provider.exec(['remote'], repoPath)
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
  } catch {
    return []
  }
}

export function isAllowedSshRemoteBaseRef(refName: string, allowedBaseRef: string): boolean {
  if (!allowedBaseRef) {
    return false
  }
  const normalizedAllowedRef = allowedBaseRef.startsWith('refs/remotes/')
    ? allowedBaseRef
    : `refs/remotes/${allowedBaseRef}`
  return refName === normalizedAllowedRef
}

export function resolveSshRemoteBranchName(refName: string, remoteNames: string[]): string {
  const remotePrefix = 'refs/remotes/'
  if (!refName.startsWith(remotePrefix)) {
    return refName
  }
  const remoteAndBranch = refName.slice(remotePrefix.length)
  const remote = remoteNames.find((candidate) => remoteAndBranch.startsWith(`${candidate}/`))
  if (remote) {
    return remoteAndBranch.slice(remote.length + 1)
  }
  return remoteAndBranch.split('/').slice(1).join('/') || remoteAndBranch
}

async function hasSshRemoteBranchConflict(
  provider: SshGitProvider,
  repoPath: string,
  branchName: string,
  allowedBaseRef: string
): Promise<boolean> {
  const remoteNames = await listSshRemoteNames(provider, repoPath)
  try {
    const { stdout } = await provider.exec(
      ['for-each-ref', '--format=%(refname)', 'refs/remotes'],
      repoPath
    )
    return stdout.split(/\r?\n/).some((line) => {
      const refName = line.trim()
      if (!refName || /^refs\/remotes\/.+\/HEAD$/.test(refName)) {
        return false
      }
      if (isAllowedSshRemoteBaseRef(refName, allowedBaseRef)) {
        return false
      }
      // Why: `git branch --all --list feature/x` doesn't match `remotes/origin/feature/x`; parse remote refs directly.
      return resolveSshRemoteBranchName(refName, remoteNames) === branchName
    })
  } catch {
    return false
  }
}

async function hasSshLocalBranchConflict(
  provider: SshGitProvider,
  repoPath: string,
  branchName: string
): Promise<boolean> {
  try {
    const { stdout } = await provider.exec(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}^{commit}`],
      repoPath
    )
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

export async function getSshBranchConflictKind(
  provider: SshGitProvider,
  repoPath: string,
  branchName: string,
  allowedBaseRef: string
): Promise<'local' | 'remote' | null> {
  if (await hasSshLocalBranchConflict(provider, repoPath, branchName)) {
    return 'local'
  }
  return (await hasSshRemoteBranchConflict(provider, repoPath, branchName, allowedBaseRef))
    ? 'remote'
    : null
}

type SelectedReviewBranchInput = Pick<
  CreateWorktreeArgs,
  | 'branchNameOverride'
  | 'linkedPR'
  | 'linkedGitLabMR'
  | 'linkedBitbucketPR'
  | 'linkedAzureDevOpsPR'
  | 'linkedGiteaPR'
  | 'pushTarget'
>

type SelectedReviewBranch = {
  provider: ForgeProviderId
  number: number
}

export function getSelectedReviewBranch(args: SelectedReviewBranchInput): SelectedReviewBranch | null {
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
  args: SelectedReviewBranchInput
): Promise<{ matchesSelected: boolean; number: number } | null> {
  const selectedReview = getSelectedReviewBranch(args)
  if (!selectedReview) {
    return null
  }
  const review = await getHostedReviewForBranch({
    repoPath: repo.path,
    connectionId: repo.connectionId ?? null,
    branch: branchName,
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

export async function remotePathExists(
  fsProvider: IFilesystemProvider | null | undefined,
  pathValue: string
): Promise<boolean> {
  if (!fsProvider?.stat) {
    return false
  }
  try {
    await fsProvider.stat(pathValue)
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    throw error
  }
}
