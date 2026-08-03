import { resolveWorktreeCreateBase, type GitPushTarget, type getPRForBranch, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getBaseRefDefault, getBranchConflictKind, resolveDefaultBaseRefWithLocalGit, resolveLocalGitUsername, addWorktree, addSparseWorktree, type AddWorktreeOptions, type AddWorktreeResult, configureCreatedWorktreePushTarget, prepareWorktreePushTarget, getBranchNameOverrideCandidate, getWorktreeCreateCandidate, WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS, normalizeSparseDirectories, computeWorktreePath, computeWorkspaceRoot, ensurePathWithinWorkspace, getWorktreePathSettings, sanitizeWorktreeName, canCheckoutExistingLocalBranch, getLocalGitHubPrForBranch, getSelectedHostedReviewForBranch, getSelectedReviewBranch, hasLocalGitOptions, isAllowedPushTargetRemoteConflict, isMatchingSelectedGitHubPr, resolveCreateBranchName, pathExists, hasLocalWorktreeBaseRef} from './orca-runtime-symbols'
import type { OrcaRuntimeCreateManagedWorktreePart53 } from './orca-runtime-create-managed-worktree-part-53'

type ManagedWorktreeCreateArgs = Parameters<OrcaRuntimeCreateManagedWorktreePart53['createManagedWorktree']>[0]

export async function prepareLocalManagedWorktreeCreation(
  runtime: any,
  args: ManagedWorktreeCreateArgs,
  repo: any,
  createSettings: any
): Promise<Record<string, any>> {
const settings = createSettings
const worktreePathSettings = getWorktreePathSettings(repo, settings)
const localGitExecOptions = getLocalProjectGitExecOptions(runtime.requireStore(), repo)
const localWorktreeGitOptions = getLocalProjectWorktreeGitOptions(runtime.requireStore(), repo)
const hasLocalWorktreeGitOptions = hasLocalGitOptions(localWorktreeGitOptions)
const localWorktreeGitOptionArgs: [] | [{ wslDistro?: string }] = hasLocalWorktreeGitOptions
  ? [localWorktreeGitOptions]
  : []
const addProjectGitOptions = (options?: AddWorktreeOptions): AddWorktreeOptions | undefined => {
  if (!hasLocalWorktreeGitOptions) {
    return options
  }
  return { ...options, ...localWorktreeGitOptions }
}
const hostedReviewExecutionContext = runtime.getHostedReviewExecutionOptions(repo)
let effectiveRequestedName = args.name
const requestedDisplayName = args.displayName?.trim() || undefined
const sanitizedName = sanitizeWorktreeName(args.name)
let effectiveSanitizedName = sanitizedName
// Why: explicit branches and non-username prefix modes never consume this
// value; skipping the probes preserves the exact generated branch name.
const username =
  !args.branchNameOverride && settings.branchPrefix === 'git-username'
    ? await resolveLocalGitUsername(repo.path)
    : ''

const baseBranch = await resolveWorktreeCreateBase({
  requestedBaseBranch: args.baseBranch,
  repoWorktreeBaseRef: repo.worktreeBaseRef,
  resolveDefaultBaseRef: () =>
    hasLocalWorktreeGitOptions
      ? resolveDefaultBaseRefWithLocalGit(localGitExecOptions)
      : getBaseRefDefault(repo.path),
  isBaseUsable: async (baseBranchCandidate) => {
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
      return hasLocalWorktreeBaseRef(
        repo.path,
        baseBranchCandidate,
        hasLocalWorktreeGitOptions ? localWorktreeGitOptions : {}
      )
    }
    return hasLocalWorktreeBaseRef(
      repo.path,
      baseBranchCandidate,
      hasLocalWorktreeGitOptions ? localWorktreeGitOptions : {}
    )
  }
})
if (!baseBranch) {
  // Why: a null default means no suitable ref exists; fail clearly instead
  // of handing Git a fabricated origin/main ref.
  throw new Error(
    'Could not resolve a default base ref for this repo. Pass an explicit --base and try again.'
  )
}

const workspaceRoot = computeWorkspaceRoot(repo.path, worktreePathSettings)
// Why: CLI-managed WSL worktrees live under ~/orca/workspaces inside the
// distro filesystem through computeWorkspaceRoot. If home lookup fails,
// still validate against the effective workspace dir.
let branchName = ''
let checkoutExistingBranch = false
let selectedExistingLocalBranchName: string | null = null
let branchConflictKind: 'local' | 'remote' | null = null
let worktreePath = ''
let worktreePathResolved = false
// Why: runtime/mobile create-from-review callers should get a new workspace
// even when the PR branch or review branch name is already in use.
for (let suffix = 1; suffix <= WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS; suffix += 1) {
  effectiveSanitizedName = getWorktreeCreateCandidate(sanitizedName, suffix)
  effectiveRequestedName = args.name.trim()
    ? getWorktreeCreateCandidate(args.name, suffix)
    : effectiveSanitizedName
  branchName = await resolveCreateBranchName(
    repo.path,
    selectedExistingLocalBranchName ??
      getBranchNameOverrideCandidate(args.branchNameOverride, suffix),
    effectiveSanitizedName,
    settings,
    username,
    localWorktreeGitOptions
  )
  checkoutExistingBranch = await canCheckoutExistingLocalBranch(
    repo.path,
    branchName,
    baseBranch,
    ...localWorktreeGitOptionArgs
  )
  if (checkoutExistingBranch && !selectedExistingLocalBranchName) {
    // Why: once a user-selected branch is safe to reuse, path retries should
    // keep that branch exact instead of creating a sibling branch.
    selectedExistingLocalBranchName = branchName
  }
  branchConflictKind = checkoutExistingBranch
    ? null
    : await getBranchConflictKind(
        repo.path,
        branchName,
        baseBranch,
        ...localWorktreeGitOptionArgs
      )
  const allowedPushTargetRemoteConflict =
    branchConflictKind &&
    isAllowedPushTargetRemoteConflict(branchConflictKind, branchName, args)
  let selectedReviewConflictMatched = false
  if (branchConflictKind) {
    if (allowedPushTargetRemoteConflict) {
      let existingPR: Awaited<ReturnType<typeof getPRForBranch>> | null = null
      const selectedReview = getSelectedReviewBranch(args)
      if (selectedReview?.provider === 'github') {
        try {
          existingPR = await getLocalGitHubPrForBranch(
            repo.path,
            branchName,
            localWorktreeGitOptions
          )
        } catch {
          // Retry with a suffixed branch when selected review verification is unavailable.
        }
        if (isMatchingSelectedGitHubPr(existingPR, args, branchName)) {
          branchConflictKind = null
          selectedReviewConflictMatched = true
        }
      } else if (selectedReview) {
        const hostedReview = await getSelectedHostedReviewForBranch(
          repo,
          branchName,
          args,
          hostedReviewExecutionContext
        ).catch(() => null)
        if (hostedReview?.matchesSelected) {
          branchConflictKind = null
          selectedReviewConflictMatched = true
        }
      }
    }
    if (branchConflictKind) {
      continue
    }
  }

  if (!checkoutExistingBranch && !selectedReviewConflictMatched) {
    let existingPR: Awaited<ReturnType<typeof getPRForBranch>> | null = null
    try {
      existingPR = await getLocalGitHubPrForBranch(
        repo.path,
        branchName,
        localWorktreeGitOptions
      )
    } catch {
      // Why: GitHub reachability should not block creating a suffixed
      // workspace; git conflicts still decide whether this candidate works.
    }
    if (existingPR && !isMatchingSelectedGitHubPr(existingPR, args, branchName)) {
      continue

    }
  }
  worktreePath = ensurePathWithinWorkspace(
    computeWorktreePath(effectiveSanitizedName, repo.path, worktreePathSettings),
    workspaceRoot
  )
  if (!(await pathExists(worktreePath))) {
    worktreePathResolved = true
    break
  }
}
if (!worktreePathResolved) {
  if (branchConflictKind) {
    throw new Error(
      `Branch "${branchName}" already exists ${branchConflictKind === 'local' ? 'locally' : 'on a remote'}.`
    )
  }
  throw new Error(
    `Could not find an available worktree path for "${sanitizedName}". Pick a different worktree name.`
  )
}
let remoteTrackingBase = await runtime.resolveRemoteTrackingBase(
  repo.path,
  baseBranch,
  ...localWorktreeGitOptionArgs
)
if (remoteTrackingBase) {
  const hadRemoteTrackingBaseRef = await runtime.hasRemoteTrackingRef(
    repo.path,
    remoteTrackingBase,
    ...localWorktreeGitOptionArgs
  )
  const hasLocalBaseRef =
    hadRemoteTrackingBaseRef ||
    (await hasLocalWorktreeBaseRef(
      repo.path,
      baseBranch,
      hasLocalWorktreeGitOptions ? localWorktreeGitOptions : {}
    ))
  if (!hadRemoteTrackingBaseRef && hasLocalBaseRef) {
    remoteTrackingBase = null
  } else {
    const refreshResult = await runtime.getOrStartRemoteTrackingBaseRefresh(
      repo.path,
      remoteTrackingBase,
      ...localWorktreeGitOptionArgs
    )
    if (!refreshResult.ok && !hadRemoteTrackingBaseRef) {
      // Why: only block creation when the refresh failed AND there is no
      // usable local base ref to fall back on. If a local remote-tracking ref
      // already exists, `git worktree add` can create from it — a possibly
      // stale but valid base — so a transient offline/auth failure must not
      // make the workspace uncreatable. The compare-to-base view reflects any
      // drift once the remote is reachable again.
      throw new Error(
        `Could not refresh base ref "${baseBranch}" from "${remoteTrackingBase.remote}". Check your network and try again.`
      )
    }
    if (
      !hadRemoteTrackingBaseRef &&
      !(await runtime.hasRemoteTrackingRef(
        repo.path,
        remoteTrackingBase,
        ...localWorktreeGitOptionArgs
      ))
    ) {
      throw new Error(`Base ref "${baseBranch}" was not found after fetching.`)
    }
  }
} else if (
  !(await hasLocalWorktreeBaseRef(
    repo.path,
    baseBranch,
    hasLocalWorktreeGitOptions ? localWorktreeGitOptions : {}
  ))
) {
  // Why: local bases keep legacy best-effort fetch behavior. Verified PR
  // SHA bases already have the commit object needed by `git worktree add`.
  try {
    await runtime.fetchRemoteWithCache(repo.path, 'origin', ...localWorktreeGitOptionArgs)
  } catch {
    // Why: belt-and-suspenders. fetchRemoteWithCache already logs and does
    // not throw; the outer try/catch guarantees create-path tolerance even
    // if future refactors change that contract.
  }
}

const sparseDirectories = args.sparseCheckout
  ? normalizeSparseDirectories(args.sparseCheckout.directories)
  : []
if (args.sparseCheckout && sparseDirectories.length === 0) {
  throw new Error('Sparse checkout requires at least one repo-relative directory.')
}

let preparedPushTarget: GitPushTarget | undefined
if (args.pushTarget) {
  // Why: fork-PR worktrees created through a remote runtime need the same
  // upstream target setup as local desktop creates, or Push would publish
  // to the wrong remote after the client/server split.
  preparedPushTarget = await prepareWorktreePushTarget(
    repo.path,
    args.pushTarget,
    runtime.store,
    repo.id,
    localWorktreeGitOptions
  )
}

const suggestLocalBaseRefUpdate =
  !settings.refreshLocalBaseRefOnWorktreeCreate &&
  !settings.localBaseRefSuggestionDismissed &&
  Boolean(remoteTrackingBase)
const remoteTrackingBaseOption = remoteTrackingBase ? { remoteTrackingBase } : undefined
const existingBranchOption = {
  checkoutExistingBranch,
  ...remoteTrackingBaseOption,
  ...(suggestLocalBaseRefUpdate ? { suggestLocalBaseRefUpdate } : {})
}
const defaultAddWorktreeOption = addProjectGitOptions()
const addResult: AddWorktreeResult =
  (await (sparseDirectories.length > 0
    ? checkoutExistingBranch
      ? addSparseWorktree(
          repo.path,
          worktreePath,
          branchName,
          sparseDirectories,
          baseBranch,
          settings.refreshLocalBaseRefOnWorktreeCreate,
          addProjectGitOptions(existingBranchOption)
        )
      : suggestLocalBaseRefUpdate
        ? addSparseWorktree(
            repo.path,
            worktreePath,
            branchName,
            sparseDirectories,
            baseBranch,
            settings.refreshLocalBaseRefOnWorktreeCreate,
            addProjectGitOptions({ ...remoteTrackingBaseOption, suggestLocalBaseRefUpdate })
          )
        : remoteTrackingBaseOption
          ? addSparseWorktree(
              repo.path,
              worktreePath,
              branchName,
              sparseDirectories,
              baseBranch,
              settings.refreshLocalBaseRefOnWorktreeCreate,
              addProjectGitOptions(remoteTrackingBaseOption)
            )
          : defaultAddWorktreeOption
            ? addSparseWorktree(
                repo.path,
                worktreePath,
                branchName,
                sparseDirectories,
                baseBranch,
                settings.refreshLocalBaseRefOnWorktreeCreate,
                defaultAddWorktreeOption
              )
            : addSparseWorktree(
                repo.path,
                worktreePath,
                branchName,
                sparseDirectories,
                baseBranch,
                settings.refreshLocalBaseRefOnWorktreeCreate
              )
    : checkoutExistingBranch
      ? addWorktree(
          repo.path,
          worktreePath,
          branchName,
          baseBranch,
          settings.refreshLocalBaseRefOnWorktreeCreate,
          false,
          addProjectGitOptions(existingBranchOption)
        )
      : suggestLocalBaseRefUpdate
        ? addWorktree(
            repo.path,
            worktreePath,
            branchName,
            baseBranch,
            settings.refreshLocalBaseRefOnWorktreeCreate,
            false,
            addProjectGitOptions({ ...remoteTrackingBaseOption, suggestLocalBaseRefUpdate })
          )
        : remoteTrackingBaseOption
          ? addWorktree(
              repo.path,
              worktreePath,
              branchName,
              baseBranch,
              settings.refreshLocalBaseRefOnWorktreeCreate,
              false,
              addProjectGitOptions(remoteTrackingBaseOption)
            )
          : defaultAddWorktreeOption
            ? addWorktree(
                repo.path,
                worktreePath,
                branchName,
                baseBranch,
                settings.refreshLocalBaseRefOnWorktreeCreate,
                false,
                defaultAddWorktreeOption
              )
            : addWorktree(
                repo.path,
                worktreePath,
                branchName,
                baseBranch,
                settings.refreshLocalBaseRefOnWorktreeCreate
              ))) ?? {}

let configuredPushTarget: GitPushTarget | undefined
if (preparedPushTarget) {
  configuredPushTarget = await configureCreatedWorktreePushTarget(
    worktreePath,
    branchName,
    preparedPushTarget,
    localWorktreeGitOptions
  )
}


  return {
    settings,
    worktreePathSettings,
    localWorktreeGitOptions,
    hasLocalWorktreeGitOptions,
    effectiveRequestedName,
    requestedDisplayName,
    effectiveSanitizedName,
    baseBranch,
    branchName,
    checkoutExistingBranch,
    worktreePath,
    remoteTrackingBase,
    sparseDirectories,
    preparedPushTarget,
    configuredPushTarget,
    addResult
  }
}
