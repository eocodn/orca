// Why: worktree create helpers (local + remote) split out of worktrees.ts; the cohesive create flow runs this file just over the per-file line limit.

import type { BrowserWindow } from 'electron'
import type {
  Repo,
  WorktreeCreateBaseFallback
} from '../../shared/types'
import { resolveLocalGitUsername } from '../git/git-username'
import {
  resolveDefaultBaseRefWithLocalGit
} from '../git/repo'
import { gitExecFileAsync } from '../git/runner'
import type { AddWorktreeOptions } from '../git/worktree'
import {
  getEffectiveHooks,
  shouldRunSetupForCreate
} from '../hooks'
import type { Store } from '../persistence'
import type {
  OrcaRuntimeService,
  RemoteFetchResult,
  RemoteTrackingBase
} from '../runtime/orca-runtime'
import { resolveWorktreeCreateBase } from '../worktree-create-base'

import {
  getLocalProjectGitExecOptions,
  getLocalProjectWorktreeGitOptions
} from '../project-runtime-git-options'
import { createWorktreeCreateTimingRecorder } from '../worktree-create-timing'
import { normalizeSparseDirectories } from './sparse-checkout-directories'
import {
  computeWorkspaceRoot,
  getWorktreePathSettings,
  sanitizeWorktreeDisplayName,
  sanitizeWorktreeName
} from './worktree-logic'
import { hasLocalWorktreeBaseRefWithOptions } from './worktree-remote-branch'
import {
  type CreateWorktreeArgsWithSystemProvenance,
  CREATE_BASE_FALLBACK_FETCH_TIMEOUT_MS
} from './worktree-remote-context'
import { emitCreateWorktreeProgress } from './worktree-remote-events'

export async function prepareLocalWorktreeCreation(
  args: CreateWorktreeArgsWithSystemProvenance,
  repo: Repo,
  store: Store,
  mainWindow: BrowserWindow,
  runtime?: OrcaRuntimeService
) {
  const timing = createWorktreeCreateTimingRecorder()
  const settings = store.getSettings()
  const worktreePathSettings = getWorktreePathSettings(repo, settings)
  const localGitExecOptions = getLocalProjectGitExecOptions(store, repo)
  const localWorktreeGitOptions = getLocalProjectWorktreeGitOptions(store, repo)
  const hasLocalWorktreeGitOptions = Object.keys(localWorktreeGitOptions).length > 0
  const localWorktreeGitOptionArgs: [] | [{ wslDistro?: string }] = hasLocalWorktreeGitOptions
    ? [localWorktreeGitOptions]
    : []
  const addProjectGitOptions = (options?: AddWorktreeOptions): AddWorktreeOptions | undefined => {
    if (!hasLocalWorktreeGitOptions) {
      return options
    }
    return { ...options, ...localWorktreeGitOptions }
  }

  const requestedName = args.name
  const sanitizedName = sanitizeWorktreeName(args.name)
  const requestedDisplayName = args.displayName
    ? sanitizeWorktreeDisplayName(args.displayName)
    : undefined
  // Why: explicit branches and non-username prefix modes never consume this; skipping the probe preserves the exact generated branch name.
  const username =
    !args.branchNameOverride && settings.branchPrefix === 'git-username'
      ? await resolveLocalGitUsername(repo.path)
      : ''

  let baseBranch = await resolveWorktreeCreateBase({
    requestedBaseBranch: args.baseBranch,
    repoWorktreeBaseRef: repo.worktreeBaseRef,
    resolveDefaultBaseRef: () => resolveDefaultBaseRefWithLocalGit(localGitExecOptions),
    isBaseUsable: async (baseBranchCandidate) => {
      if (runtime) {
        const remoteTrackingBase = await runtime.resolveRemoteTrackingBase(
          repo.path,
          baseBranchCandidate,
          ...localWorktreeGitOptionArgs
        )
        if (remoteTrackingBase) {
          if (
            await runtime.hasRemoteTrackingRef(
              repo.path,
              remoteTrackingBase,
              ...localWorktreeGitOptionArgs
            )
          ) {
            return true
          }
          return hasLocalWorktreeBaseRefWithOptions(
            repo.path,
            baseBranchCandidate,
            localGitExecOptions
          )
        }
      }
      return hasLocalWorktreeBaseRefWithOptions(repo.path, baseBranchCandidate, localGitExecOptions)
    }
  })
  if (!baseBranch) {
    // Why: no default base resolved; fail clearly rather than pass a hardcoded non-existent ref to git worktree add (opaque error) so the UI can prompt.
    throw new Error(
      'Could not resolve a default base ref for this repo. Pick a base branch explicitly and try again.'
    )
  }

  let remoteTrackingBase: RemoteTrackingBase | null = null
  let baseFallback: WorktreeCreateBaseFallback | undefined
  let remoteTrackingRefresh: {
    base: RemoteTrackingBase
    hadLocalBaseRef: boolean
    promise: Promise<RemoteFetchResult>
  } | null = null
  let legacyFetchPromise: Promise<void> | null = null

  if (runtime) {
    remoteTrackingBase = await runtime.resolveRemoteTrackingBase(
      repo.path,
      baseBranch,
      ...localWorktreeGitOptionArgs
    )
    if (remoteTrackingBase) {
      const hasRemoteTrackingBaseRef = await runtime.hasRemoteTrackingRef(
        repo.path,
        remoteTrackingBase,
        ...localWorktreeGitOptionArgs
      )
      const hasNamedLocalBaseRef = await hasLocalWorktreeBaseRefWithOptions(
        repo.path,
        baseBranch,
        localGitExecOptions
      )
      const hasFallbackLocalBaseRef =
        !hasNamedLocalBaseRef &&
        (await hasLocalWorktreeBaseRefWithOptions(
          repo.path,
          remoteTrackingBase.branch,
          localGitExecOptions
        ))
      const hasLocalBaseRef =
        hasRemoteTrackingBaseRef || hasNamedLocalBaseRef || hasFallbackLocalBaseRef
      if (!hasRemoteTrackingBaseRef && hasLocalBaseRef) {
        // Why: use the usable local branch when offline refresh cannot create its tracking ref.
        if (hasFallbackLocalBaseRef) {
          baseBranch = remoteTrackingBase.branch
        }
        baseFallback = {
          requestedRef: remoteTrackingBase.base,
          localRef: baseBranch
        }
        remoteTrackingBase = null
      } else {
        emitCreateWorktreeProgress(mainWindow, 'fetching', args.creationId)
        remoteTrackingRefresh = {
          base: remoteTrackingBase,
          hadLocalBaseRef: hasRemoteTrackingBaseRef,
          promise: runtime.getOrStartRemoteTrackingBaseRefresh(
            repo.path,
            remoteTrackingBase,
            ...localWorktreeGitOptionArgs
          )
        }
      }
    } else if (
      !(await hasLocalWorktreeBaseRefWithOptions(repo.path, baseBranch, localWorktreeGitOptions))
    ) {
      // Why: non-remote-prefix bases (plain main/master/local) keep the legacy best-effort fetch; verified PR SHA bases already have the object.
      legacyFetchPromise = runtime
        .fetchRemoteWithCache(repo.path, 'origin', ...localWorktreeGitOptionArgs)
        .then(() => undefined)
        .catch(() => undefined)
      emitCreateWorktreeProgress(mainWindow, 'fetching', args.creationId)
    }
  } else {
    if (
      !(await hasLocalWorktreeBaseRefWithOptions(repo.path, baseBranch, localWorktreeGitOptions))
    ) {
      legacyFetchPromise = gitExecFileAsync(['fetch', 'origin'], {
        ...localGitExecOptions,
        timeout: CREATE_BASE_FALLBACK_FETCH_TIMEOUT_MS
      })
        .then(() => undefined)
        .catch(() => undefined)
      emitCreateWorktreeProgress(mainWindow, 'fetching', args.creationId)
    }
  }
  const workspaceRoot = computeWorkspaceRoot(repo.path, worktreePathSettings)

  // Why: this validation doesn't depend on remote refs, so it can overlap a required remote-tracking base refresh.
  const primarySetupScript = getEffectiveHooks(repo)?.scripts.setup
  if (primarySetupScript) {
    shouldRunSetupForCreate(repo, args.setupDecision)
  }
  const sparseDirectories = args.sparseCheckout
    ? normalizeSparseDirectories(args.sparseCheckout.directories)
    : []
  if (args.sparseCheckout && sparseDirectories.length === 0) {
    throw new Error('Sparse checkout requires at least one repo-relative directory.')
  }
  let sparsePresetId: string | undefined
  if (args.sparseCheckout?.presetId) {
    const preset = store
      .getSparsePresets(repo.id)
      .find((entry) => entry.id === args.sparseCheckout?.presetId)
    if (preset?.repoId === repo.id) {
      try {
        const presetDirectories = normalizeSparseDirectories(preset.directories)
        // Why: Set-based compare so directory order doesn't affect attribution — matches renderer's sparseDirectoriesMatch.
        const presetSet = new Set(presetDirectories)
        const directoriesMatch =
          presetDirectories.length === sparseDirectories.length &&
          sparseDirectories.every((entry) => presetSet.has(entry))
        sparsePresetId = directoriesMatch ? preset.id : undefined
      } catch {
        // Why: corrupt preset data should not block creation or falsely label the new worktree.
      }
    }
  }
  return {
    timing,
    settings,
    worktreePathSettings,
    localGitExecOptions,
    localWorktreeGitOptions,
    hasLocalWorktreeGitOptions,
    localWorktreeGitOptionArgs,
    addProjectGitOptions,
    requestedName,
    sanitizedName,
    requestedDisplayName,
    baseBranch,
    remoteTrackingBase,
    baseFallback,
    remoteTrackingRefresh,
    legacyFetchPromise,
    workspaceRoot,
    sparseDirectories,
    sparsePresetId,
    username
  }
}
