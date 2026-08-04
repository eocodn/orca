// Why: worktree create helpers (local + remote) split out of worktrees.ts; the cohesive create flow runs this file just over the per-file line limit.

import { posix, win32 } from 'node:path'
import type {
  CreateWorktreeResult,
  LocalBaseRefRefreshResult,
  LocalBaseRefUpdateSuggestion,
  Repo,
} from '../../shared/types'
import {
  buildPosixRunnerScript,
  buildWindowsRunnerScript,
  getEffectiveHooksFromConfig,
  getSetupRunnerEnvVars,
  parseOrcaYaml
} from '../hooks'
import type { SshGitProvider } from '../providers/ssh-git-provider'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { registerOptionalSshWorktreeCreateRoots } from './ssh-worktree-create-root-registration'

import {
  type RemoteLocalBaseRefRefreshability,
  type RemoteWorktreeCreateBasePlan,
  sshWorktreeCreateBasePlanInflight
} from './worktree-remote-context'
import { countNonEmptyGitOutputLines, getSshWorktreeCreateBasePlanKey, refreshRemoteTrackingBaseForWorktreeCreate, fetchRemoteForWorktreeCreate } from './worktree-remote-base'
import { hasRemoteWorktreeBaseRef, hasRemoteTrackingRefSsh } from './worktree-remote-branch'
import type { IFilesystemProvider } from '../providers/types'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'
import { shouldWaitForSetupBeforeAgentStartup } from '../../shared/setup-agent-startup-policy'
import type { RemoteTrackingBase } from '../runtime/orca-runtime'
import { resolveWorktreeCreateBase } from '../worktree-create-base'
import { resolveDefaultBaseRefViaExec } from '../git/repo'


export async function readRemoteEffectiveHooks(
  repo: Repo,
  fsProvider: IFilesystemProvider,
  hooksRootPath: string
): Promise<ReturnType<typeof getEffectiveHooksFromConfig>> {
  return getEffectiveHooksFromConfig(repo, await readRemoteOrcaYaml(fsProvider, hooksRootPath))
}

export async function readRemoteOrcaYaml(
  fsProvider: IFilesystemProvider,
  hooksRootPath: string
): Promise<ReturnType<typeof parseOrcaYaml>> {
  try {
    const result = await fsProvider.readFile(joinWorktreeRelativePath(hooksRootPath, 'orca.yaml'))
    return result.isBinary ? null : parseOrcaYaml(result.content)
  } catch {
    return null
  }
}

export async function createRemoteSetupRunnerScript(
  repo: Repo,
  worktreePath: string,
  script: string,
  gitProvider: SshGitProvider,
  fsProvider: IFilesystemProvider
): Promise<CreateWorktreeResult['setup']> {
  const useWindowsFormat = isWindowsAbsolutePathLike(worktreePath)
  const runnerRelativePath = useWindowsFormat ? 'orca/setup-runner.cmd' : 'orca/setup-runner.sh'
  const { stdout } = await gitProvider.exec(
    ['rev-parse', '--git-path', runnerRelativePath],
    worktreePath
  )
  const runnerScriptPath = stdout.trim()
  const runnerDir = useWindowsFormat
    ? win32.dirname(runnerScriptPath)
    : posix.dirname(runnerScriptPath)
  await fsProvider.createDir(runnerDir)
  await fsProvider.writeFile(
    runnerScriptPath,
    useWindowsFormat ? buildWindowsRunnerScript(script) : buildPosixRunnerScript(script)
  )
  return {
    runnerScriptPath,
    envVars: getSetupRunnerEnvVars(repo, worktreePath),
    ...(shouldWaitForSetupBeforeAgentStartup(repo.hookSettings?.setupAgentStartupPolicy)
      ? { waitForAgentStartup: true }
      : {})
  }
}

async function resolveRemoteTrackingBaseSsh(
  provider: SshGitProvider,
  repoPath: string,
  baseBranch: string
): Promise<RemoteTrackingBase | null> {
  let remotes: string[]
  try {
    const { stdout } = await provider.exec(['remote'], repoPath)
    remotes = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return null
  }

  const remoteRefPrefix = 'refs/remotes/'
  const shortBaseBranch = baseBranch.startsWith(remoteRefPrefix)
    ? baseBranch.slice(remoteRefPrefix.length)
    : baseBranch
  const remote = remotes
    .filter((candidate) => shortBaseBranch.startsWith(`${candidate}/`))
    .sort((a, b) => b.length - a.length)[0]
  if (!remote) {
    return null
  }
  const branch = shortBaseBranch.slice(remote.length + 1)
  if (!branch) {
    return null
  }
  return {
    remote,
    branch,
    ref: `refs/remotes/${remote}/${branch}`,
    base: `${remote}/${branch}`
  }
}

async function resolveRemoteWorktreeCreateBasePlan(
  provider: SshGitProvider,
  repo: Repo,
  requestedBaseBranch: string | undefined
): Promise<RemoteWorktreeCreateBasePlan | null> {
  const baseBranch = await resolveWorktreeCreateBase({
    requestedBaseBranch,
    repoWorktreeBaseRef: repo.worktreeBaseRef,
    resolveDefaultBaseRef: () =>
      resolveDefaultBaseRefViaExec((argv) => provider.exec(argv, repo.path)),
    isBaseUsable: async (baseBranchCandidate) => {
      const remoteTrackingBase = await resolveRemoteTrackingBaseSsh(
        provider,
        repo.path,
        baseBranchCandidate
      )
      if (remoteTrackingBase) {
        if (await hasRemoteTrackingRefSsh(provider, repo.path, remoteTrackingBase.ref)) {
          return true
        }
        return hasRemoteWorktreeBaseRef(provider, repo.path, baseBranchCandidate)
      }
      return hasRemoteWorktreeBaseRef(provider, repo.path, baseBranchCandidate)
    }
  })
  if (!baseBranch) {
    return null
  }
  return {
    baseBranch,
    remoteTrackingBase: await resolveRemoteTrackingBaseSsh(provider, repo.path, baseBranch)
  }
}

export function getOrStartRemoteWorktreeCreateBasePlan(
  provider: SshGitProvider,
  repo: Repo,
  requestedBaseBranch: string | undefined
): Promise<RemoteWorktreeCreateBasePlan | null> {
  const key = getSshWorktreeCreateBasePlanKey(repo, requestedBaseBranch)
  const existing = sshWorktreeCreateBasePlanInflight.get(key)
  if (existing) {
    return existing
  }
  const promise = resolveRemoteWorktreeCreateBasePlan(provider, repo, requestedBaseBranch).finally(
    () => {
      if (sshWorktreeCreateBasePlanInflight.get(key) === promise) {
        sshWorktreeCreateBasePlanInflight.delete(key)
      }
    }
  )
  sshWorktreeCreateBasePlanInflight.set(key, promise)
  return promise
}

export async function prefetchRemoteWorktreeCreateBase(
  provider: SshGitProvider,
  repo: Repo,
  args: { baseBranch?: string }
): Promise<void> {
  // Why: base-plan probes use generic git.exec, and some relays require the repo root registered before probes can see refs.
  await registerOptionalSshWorktreeCreateRoots(repo.connectionId!, [repo.path])
  const basePlan = await getOrStartRemoteWorktreeCreateBasePlan(provider, repo, args.baseBranch)
  if (!basePlan) {
    return
  }
  if (basePlan.remoteTrackingBase) {
    if (
      (await hasRemoteTrackingRefSsh(provider, repo.path, basePlan.remoteTrackingBase.ref)) ||
      !(await hasRemoteWorktreeBaseRef(provider, repo.path, basePlan.baseBranch))
    ) {
      await refreshRemoteTrackingBaseForWorktreeCreate(provider, repo, basePlan.remoteTrackingBase)
      return
    }
  }
  if (await hasRemoteWorktreeBaseRef(provider, repo.path, basePlan.baseBranch)) {
    // Why: PR/MR resolvers already fetched verified SHA start points; a broad fetch only updates unrelated refs.
    return
  }

  // Why: mirrors createRemoteWorktree's legacy local-base fallback so prefetch and create share one process-local SSH fetch cache.
  await fetchRemoteForWorktreeCreate(provider, repo, 'origin')
}

export async function refreshLocalBaseRefForRemoteWorktreeCreate(
  provider: SshGitProvider,
  repoPath: string,
  remoteTrackingBase: RemoteTrackingBase
): Promise<LocalBaseRefRefreshResult> {
  const evaluation = await evaluateRemoteLocalBaseRefRefreshability(
    provider,
    repoPath,
    remoteTrackingBase
  )
  if (!evaluation.refreshable) {
    return evaluation.result
  }

  const resultBase = { baseRef: evaluation.baseRef, localBranch: evaluation.localBranch }
  try {
    await provider.refreshLocalBaseRefForWorktreeCreate({
      repoPath,
      fullRef: evaluation.fullRef,
      remoteTrackingRef: evaluation.remoteTrackingRef,
      ...(evaluation.ownerWorktreePath ? { ownerWorktreePath: evaluation.ownerWorktreePath } : {})
    })
    return {
      ...resultBase,
      status: 'updated',
      ...(evaluation.ownerWorktreePath ? { ownerWorktreePath: evaluation.ownerWorktreePath } : {})
    }
  } catch {
    return { ...resultBase, status: 'skipped_error' }
  }
}

async function evaluateRemoteLocalBaseRefRefreshability(
  provider: SshGitProvider,
  repoPath: string,
  remoteTrackingBase: RemoteTrackingBase,
  shouldInspectOwner: (behind: number) => boolean = () => true
): Promise<RemoteLocalBaseRefRefreshability> {
  const resultBase = {
    baseRef: remoteTrackingBase.base,
    localBranch: remoteTrackingBase.branch
  }
  const fullRef = `refs/heads/${remoteTrackingBase.branch}`

  let behind = 0
  try {
    // Why: SSH generic git.exec is allowlisted — merge-base and log are permitted read-only probes; rev-list is intentionally not exposed.
    await provider.exec(['merge-base', '--is-ancestor', fullRef, remoteTrackingBase.ref], repoPath)
    const { stdout } = await provider.exec(
      ['log', '--format=%H', `${fullRef}..${remoteTrackingBase.ref}`],
      repoPath
    )
    behind = countNonEmptyGitOutputLines(stdout)
    if (!shouldInspectOwner(behind)) {
      // Why: no behind commits means no update to advise; skip remote worktree/status round trips.
      return {
        refreshable: true,
        ...resultBase,
        fullRef,
        remoteTrackingRef: remoteTrackingBase.ref,
        behind
      }
    }
  } catch {
    return { refreshable: false, result: { ...resultBase, status: 'skipped_not_fast_forward' } }
  }

  try {
    const worktrees = await provider.listWorktrees(repoPath)
    const ownerWorktree = worktrees.find((wt) => wt.branch === fullRef)

    if (ownerWorktree) {
      const status = await provider.worktreeIsClean(ownerWorktree.path, {
        includeUntracked: false
      })
      if (!status.clean) {
        return {
          refreshable: false,
          result: {
            ...resultBase,
            status: 'skipped_dirty_worktree',
            ownerWorktreePath: ownerWorktree.path
          }
        }
      }
      return {
        refreshable: true,
        ...resultBase,
        fullRef,
        remoteTrackingRef: remoteTrackingBase.ref,
        behind,
        ownerWorktreePath: ownerWorktree.path
      }
    }

    // Why: not checked out anywhere, so a bare-ref fast-forward is safe; omitting ownerWorktreePath tells the relay to update-ref, not reset --hard.
    return {
      refreshable: true,
      ...resultBase,
      fullRef,
      remoteTrackingRef: remoteTrackingBase.ref,
      behind
    }
  } catch {
    return { refreshable: false, result: { ...resultBase, status: 'skipped_error' } }
  }
}

export async function getRemoteLocalBaseRefUpdateSuggestionForWorktreeCreate(
  provider: SshGitProvider,
  repoPath: string,
  remoteTrackingBase: RemoteTrackingBase
): Promise<LocalBaseRefUpdateSuggestion | undefined> {
  const evaluation = await evaluateRemoteLocalBaseRefRefreshability(
    provider,
    repoPath,
    remoteTrackingBase,
    (behind) => behind > 0
  )
  if (!evaluation.refreshable || evaluation.behind <= 0) {
    return undefined
  }
  try {
    await provider.refreshLocalBaseRefForWorktreeCreate({
      repoPath,
      fullRef: evaluation.fullRef,
      remoteTrackingRef: evaluation.remoteTrackingRef,
      ...(evaluation.ownerWorktreePath ? { ownerWorktreePath: evaluation.ownerWorktreePath } : {}),
      checkOnly: true
    })
  } catch {
    return undefined
  }
  return {
    baseRef: evaluation.baseRef,
    localBranch: evaluation.localBranch,
    behind: evaluation.behind
  }
}
