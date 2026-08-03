// Why: worktree create helpers (local + remote) split out of worktrees.ts; the cohesive create flow runs this file just over the per-file line limit.

import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Store } from '../persistence'
import type {
  CreateWorktreeResult,
  GitPushTarget,
  Repo,
  Worktree,
  WorktreeCreateBaseFallback,
  WorktreeMeta
} from '../../shared/types'
import { listWorktrees, addWorktree, addSparseWorktree } from '../git/worktree'
import { getSshGitUsername } from '../git/git-username'
import { getProjectHostSetupWorktreeMeta } from '../../shared/project-host-setup-projection'
import {
  getDefaultTabsLaunch,
  getEffectiveHooksFromConfig,
  shouldRunSetupForCreate
} from '../hooks'
import { requireSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { registerRequiredSshWorktreeCreateRoots } from './ssh-worktree-create-root-registration'

import type { CreateWorktreeArgsWithSystemProvenance } from './worktree-remote-context'
import { validateWorkspaceLineageParentBeforeCreate, recordWorkspaceLineageForCreatedWorktree, refreshRemoteTrackingBaseForWorktreeCreate, fetchRemoteForWorktreeCreate } from './worktree-remote-base'
import { resolveCreateBranchNameSsh, hasRemoteWorktreeBaseRef, hasRemoteTrackingRefSsh, canCheckoutExistingLocalBranchSsh, getSshBranchConflictKind, isAllowedPushTargetRemoteConflict, getSelectedHostedReviewForBranch, remotePathExists } from './worktree-remote-branch'
import { configureCreatedWorktreePushTargetSsh } from './worktree-remote-push'
import { readRemoteEffectiveHooks, readRemoteOrcaYaml, createRemoteSetupRunnerScript, getOrStartRemoteWorktreeCreateBasePlan, refreshLocalBaseRefForRemoteWorktreeCreate, getRemoteLocalBaseRefUpdateSuggestionForWorktreeCreate } from './worktree-remote-refresh'
import { notifyWorktreesChanged } from './worktree-remote-events'
import { createWorktreeCreateTimingRecorder } from '../worktree-create-timing'
import {
  computeRemoteWorktreePath,
  getWorktreeCreationLayout,
  getWorktreePathSettings,
  hasRepoWorktreeBasePath,
  mergeWorktree,
  sanitizeWorktreeDisplayName,
  sanitizeWorktreeName,
  shouldSetDisplayName
} from './worktree-logic'
import { worktreeWorkspaceKey } from '../../shared/workspace-scope'
import { normalizeSparseDirectories } from './sparse-checkout-directories'
import {
  getBranchNameOverrideCandidate,
  getWorktreeCreateCandidate,
  WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS
} from '../worktree-create-candidates'
import { prepareWorktreePushTargetSsh } from './worktree-remote-push'
import { unsetRemoteWorktreeCreationBase } from './worktree-remote-base'

export async function createRemoteWorktree(
  args: CreateWorktreeArgsWithSystemProvenance,
  repo: Repo,
  store: Store,
  mainWindow: BrowserWindow
): Promise<CreateWorktreeResult> {
  const timing = createWorktreeCreateTimingRecorder()
  const provider = requireSshGitProvider(repo.connectionId!)
  const fsProvider = getSshFilesystemProvider(repo.connectionId!)

  const settings = store.getSettings()
  const worktreePathSettings = getWorktreePathSettings(repo, settings)
  let effectiveRequestedName = args.name
  const sanitizedName = sanitizeWorktreeName(args.name)
  let effectiveSanitizedName = sanitizedName
  const requestedDisplayName = args.displayName
    ? sanitizeWorktreeDisplayName(args.displayName)
    : undefined

  // Why: base resolution probes refs via generic git.exec; register the repo root first so relays don't report a valid base as stale.
  await registerRequiredSshWorktreeCreateRoots(repo.connectionId!, [repo.path])

  // Why: explicit branches and non-username prefix modes never consume this; skipping the remote probe preserves the exact branch name.
  const username =
    !args.branchNameOverride && settings.branchPrefix === 'git-username'
      ? await getSshGitUsername(provider, repo.path)
      : ''

  const branchConflictSubject = args.branchNameOverride ? 'branch name' : 'worktree name'
  // Why: don't fall back to hardcoded 'origin/main'; it may not exist (master/develop) and yields an opaque git error, so fail clearly and let the UI prompt.
  const basePlan = await getOrStartRemoteWorktreeCreateBasePlan(provider, repo, args.baseBranch)
  if (!basePlan) {
    throw new Error(
      'Could not resolve a default base ref for this repo. Pick a base branch explicitly and try again.'
    )
  }
  let { baseBranch } = basePlan
  let { remoteTrackingBase } = basePlan
  let baseFallback: WorktreeCreateBaseFallback | undefined

  if (remoteTrackingBase) {
    const hasRemoteTrackingBaseRef = await hasRemoteTrackingRefSsh(
      provider,
      repo.path,
      remoteTrackingBase.ref
    )
    const hasNamedLocalBaseRef = await hasRemoteWorktreeBaseRef(provider, repo.path, baseBranch)
    const hasFallbackLocalBaseRef =
      !hasNamedLocalBaseRef &&
      (await hasRemoteWorktreeBaseRef(provider, repo.path, remoteTrackingBase.branch))
    if (!hasRemoteTrackingBaseRef && (hasNamedLocalBaseRef || hasFallbackLocalBaseRef)) {
      // Why: branch reuse and conflict checks must see the local fallback too.
      if (hasFallbackLocalBaseRef) {
        baseBranch = remoteTrackingBase.branch
      }
      baseFallback = {
        requestedRef: remoteTrackingBase.base,
        localRef: baseBranch
      }
      remoteTrackingBase = null
    }
  }

  let branchName = ''
  let checkoutExistingBranch = false
  let remotePath = ''
  let selectedExistingLocalBranchName: string | null = null
  let lastBranchConflictKind: 'local' | 'remote' | null = null
  let remotePathResolved = false
  // Why: duplicate PR/MR checkouts still need a workspace; suffix branch/path while preserving review metadata and push target.
  for (let suffix = 1; suffix <= WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS; suffix += 1) {
    effectiveSanitizedName = getWorktreeCreateCandidate(sanitizedName, suffix)
    effectiveRequestedName = args.name.trim()
      ? getWorktreeCreateCandidate(args.name, suffix)
      : effectiveSanitizedName
    branchName = await resolveCreateBranchNameSsh(
      provider,
      repo.path,
      selectedExistingLocalBranchName ??
        getBranchNameOverrideCandidate(args.branchNameOverride, suffix),
      effectiveSanitizedName,
      settings,
      username
    )
    checkoutExistingBranch = await canCheckoutExistingLocalBranchSsh(
      provider,
      repo.path,
      branchName,
      baseBranch
    )
    if (checkoutExistingBranch && !selectedExistingLocalBranchName) {
      // Why: once a user-selected branch is safe to reuse, path retries keep it exact instead of creating a sibling.
      selectedExistingLocalBranchName = branchName
    }
    lastBranchConflictKind = checkoutExistingBranch
      ? null
      : await getSshBranchConflictKind(provider, repo.path, branchName, baseBranch)
    if (lastBranchConflictKind) {
      const selectedReview = isAllowedPushTargetRemoteConflict(
        lastBranchConflictKind,
        branchName,
        args
      )
        ? await getSelectedHostedReviewForBranch(repo, branchName, args).catch(() => null)
        : null
      if (!selectedReview?.matchesSelected) {
        continue
      }
      lastBranchConflictKind = null
    }
    remotePath = computeRemoteWorktreePath(
      effectiveSanitizedName,
      repo.path,
      worktreePathSettings,
      {
        useConfiguredAbsolutePath: hasRepoWorktreeBasePath(repo)
      }
    )
    if (!(await remotePathExists(fsProvider, remotePath))) {
      remotePathResolved = true
      break
    }
  }
  if (!remotePathResolved) {
    if (lastBranchConflictKind) {
      throw new Error(
        `Branch "${branchName}" already exists ${lastBranchConflictKind === 'local' ? 'locally' : 'on a remote'}. Pick a different ${branchConflictSubject}.`
      )
    }
    throw new Error(
      `Could not find an available remote worktree path for "${sanitizedName}". Pick a different worktree name.`
    )
  }

  validateWorkspaceLineageParentBeforeCreate(
    store,
    args.parentWorkspace,
    worktreeWorkspaceKey(`${repo.id}::${remotePath}`)
  )

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

  // Why: addWorktree/setup probes run inside the new path; older relays need that root registered before accepting git/fs ops there.
  await registerRequiredSshWorktreeCreateRoots(repo.connectionId!, [remotePath])

  if (remoteTrackingBase) {
    try {
      await refreshRemoteTrackingBaseForWorktreeCreate(provider, repo, remoteTrackingBase)
    } catch {
      // Why: a refresh failure shouldn't block create if a usable (stale) local base ref exists; probe after registerRoot and hard-fail only when none does.
      if (!(await hasRemoteTrackingRefSsh(provider, repo.path, remoteTrackingBase.ref))) {
        throw new Error(
          `Could not refresh base ref "${baseBranch}" from "${remoteTrackingBase.remote}". Check your network and try again.`
        )
      }
    }
  } else if (!(await hasRemoteWorktreeBaseRef(provider, repo.path, baseBranch))) {
    // Why: non-remote-tracking bases keep the legacy best-effort fetch; verified PR/MR SHA bases already have the object, so a broad fetch is wasted.
    try {
      await fetchRemoteForWorktreeCreate(provider, repo, 'origin')
    } catch {
      /* best-effort */
    }
  }

  const localBaseRefRefresh =
    settings.refreshLocalBaseRefOnWorktreeCreate && !checkoutExistingBranch && remoteTrackingBase
      ? await refreshLocalBaseRefForRemoteWorktreeCreate(provider, repo.path, remoteTrackingBase)
      : undefined
  const localBaseRefUpdateSuggestion =
    !settings.refreshLocalBaseRefOnWorktreeCreate &&
    !settings.localBaseRefSuggestionDismissed &&
    !checkoutExistingBranch &&
    remoteTrackingBase
      ? await getRemoteLocalBaseRefUpdateSuggestionForWorktreeCreate(
          provider,
          repo.path,
          remoteTrackingBase
        )
      : undefined

  if (fsProvider) {
    const primaryHooks = await readRemoteEffectiveHooks(repo, fsProvider, repo.path)
    if (primaryHooks?.scripts.setup) {
      shouldRunSetupForCreate(repo, args.setupDecision)
    }
  }

  let preparedPushTarget: GitPushTarget | undefined
  if (args.pushTarget) {
    // Why: fork-PR SSH worktrees need contributor-remote setup before create, else Push/Sync target origin.
    preparedPushTarget = await prepareWorktreePushTargetSsh(
      provider,
      repo.path,
      args.pushTarget,
      store,
      repo.id
    )
  }

  try {
    await timing.time('git_worktree_add', async () =>
      provider.addWorktree(
        repo.path,
        branchName,
        remotePath,
        checkoutExistingBranch
          ? { checkoutExistingBranch }
          : { base: baseBranch, ...(sparseDirectories.length > 0 ? { noCheckout: true } : {}) }
      )
    )
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('No workspace roots registered yet') ||
        err.message.includes('Path outside authorized workspace'))
    ) {
      // Why: only OLD relays (pre-allowlist-removal) throw these; surface an upgrade message. Remove after version floor moves (docs/relay-fs-allowlist-removal.md).
      throw new Error(
        `Older relay reported an authorization error; please reconnect to deploy the latest relay. (${err.message})`
      )
    }
    throw err
  }
  if (sparseDirectories.length > 0) {
    try {
      // Why: SSH providers expose generic git exec, so remote sparse mirrors local addSparseWorktree without a new relay method.
      await provider.exec(['sparse-checkout', 'init', '--cone'], remotePath)
      await provider.exec(['sparse-checkout', 'set', '--', ...sparseDirectories], remotePath)
      await provider.exec(['checkout', branchName], remotePath)
    } catch (err) {
      if (!checkoutExistingBranch) {
        await unsetRemoteWorktreeCreationBase(provider, remotePath, branchName)
      }
      await provider
        .removeWorktree(remotePath, true, {
          deleteBranch: !checkoutExistingBranch,
          // Why: sparse setup failed before any work happened, so rollback removes the just-created remote branch.
          forceBranchDelete: !checkoutExistingBranch
        })
        .catch(() => undefined)
      throw err
    }
  }

  // Re-list to get the created worktree info
  const gitWorktrees = await timing.time('list_created_worktree', async () =>
    provider.listWorktrees(repo.path)
  )
  const created = gitWorktrees.find(
    (gw) => gw.branch?.endsWith(branchName) || gw.path.endsWith(effectiveSanitizedName)
  )
  if (!created) {
    throw new Error('Worktree created but not found in listing')
  }

  const worktreeId = `${repo.id}::${created.path}`
  const now = Date.now()
  // Why: PR/MR worktrees start from a head ref/SHA but Source Control must compare against the review target branch.
  const metadataBaseRef = args.compareBaseRef ?? remoteTrackingBase?.ref ?? baseBranch
  let configuredPushTarget: GitPushTarget | undefined
  if (preparedPushTarget) {
    configuredPushTarget = await configureCreatedWorktreePushTargetSsh(
      provider,
      created.path,
      branchName,
      preparedPushTarget
    )
  }
  const metaUpdates: Partial<WorktreeMeta> = {
    // Why: path-derived IDs get reused after external deletion; rotate instance identity so stale lineage can't attach to the new occupant.
    instanceId: randomUUID(),
    ...(store.getProjectHostSetups
      ? getProjectHostSetupWorktreeMeta(store.getProjectHostSetups(), repo)
      : {}),
    lastActivityAt: now,
    // Why: grace window atop Recent so ambient PTY bumps on others during create don't bury the new worktree. See smart-sort.ts `CREATE_GRACE_MS`.
    createdAt: now,
    orcaCreatedAt: now,
    orcaCreationSource: 'ssh',
    orcaCreationWorkspaceLayout: getWorktreeCreationLayout(repo, settings),
    ...(args.automationProvenance ? { automationProvenance: args.automationProvenance } : {}),
    ...(args.cliProvenance ? { cliProvenance: args.cliProvenance } : {}),
    baseRef: metadataBaseRef,
    ...(checkoutExistingBranch ? { preserveBranchOnDelete: true } : {}),
    ...(configuredPushTarget ? { pushTarget: configuredPushTarget } : {}),
    ...(requestedDisplayName
      ? { displayName: requestedDisplayName }
      : shouldSetDisplayName(effectiveRequestedName, branchName, effectiveSanitizedName)
        ? { displayName: effectiveRequestedName }
        : {}),
    ...(isTuiAgent(args.createdWithAgent) ? { createdWithAgent: args.createdWithAgent } : {}),
    ...(args.pendingFirstAgentMessageRename === true && isTuiAgent(args.createdWithAgent)
      ? { pendingFirstAgentMessageRename: true }
      : {}),
    ...(sparseDirectories.length > 0
      ? {
          sparseDirectories,
          sparseBaseRef: metadataBaseRef,
          sparsePresetId
        }
      : {}),
    ...(args.linkedIssue !== undefined ? { linkedIssue: args.linkedIssue } : {}),
    ...(args.linkedPR !== undefined ? { linkedPR: args.linkedPR } : {}),
    ...(args.linkedLinearIssue !== undefined ? { linkedLinearIssue: args.linkedLinearIssue } : {}),
    ...(args.linkedLinearIssueWorkspaceId !== undefined
      ? { linkedLinearIssueWorkspaceId: args.linkedLinearIssueWorkspaceId }
      : {}),
    ...(args.linkedLinearIssueOrganizationUrlKey !== undefined
      ? { linkedLinearIssueOrganizationUrlKey: args.linkedLinearIssueOrganizationUrlKey }
      : {}),
    ...(args.manualOrder !== undefined ? { manualOrder: args.manualOrder } : {}),
    ...(args.linkedGitLabIssue !== undefined ? { linkedGitLabIssue: args.linkedGitLabIssue } : {}),
    ...(args.linkedGitLabMR !== undefined ? { linkedGitLabMR: args.linkedGitLabMR } : {}),
    ...(args.linkedBitbucketPR !== undefined ? { linkedBitbucketPR: args.linkedBitbucketPR } : {}),
    ...(args.linkedAzureDevOpsPR !== undefined
      ? { linkedAzureDevOpsPR: args.linkedAzureDevOpsPR }
      : {}),
    ...(args.linkedGiteaPR !== undefined ? { linkedGiteaPR: args.linkedGiteaPR } : {}),
    ...(args.linkedWorkItem !== undefined ? { linkedWorkItem: args.linkedWorkItem } : {}),
    ...(args.linkedTaskSourceContext !== undefined
      ? { linkedTaskSourceContext: args.linkedTaskSourceContext }
      : {}),
    ...(args.workspaceStatus !== undefined ? { workspaceStatus: args.workspaceStatus } : {})
  }
  const { worktree } = timing.timeSync('persist_metadata', () => {
    const meta = store.setWorktreeMeta(worktreeId, metaUpdates)
    return { worktree: mergeWorktree(repo.id, created, meta) }
  })
  const workspaceLineage = recordWorkspaceLineageForCreatedWorktree(store, args, worktree, now)

  // Why: shared/symlink paths, `orca.yaml` shared directories, and `.worktreeinclude` copies are local-only; remote (SSH) support needs a new relay method + auth surface, so all are skipped here.

  let setup: CreateWorktreeResult['setup']
  let defaultTabs: CreateWorktreeResult['defaultTabs']
  if (fsProvider) {
    await timing.time('prepare_setup', async () => {
      const yamlHooks = await readRemoteOrcaYaml(fsProvider, created.path)
      const hooks = getEffectiveHooksFromConfig(repo, yamlHooks)
      try {
        defaultTabs = getDefaultTabsLaunch(yamlHooks, repo, args.setupDecision)
      } catch (error) {
        // Why: default tab commands share setup's run policy; without a renderer decision, create the tabs but don't run them.
        console.warn(`[hooks] default tab commands skipped for ${created.path}:`, error)
        defaultTabs = yamlHooks?.defaultTabs
          ? { tabs: yamlHooks.defaultTabs, runCommands: false }
          : undefined
      }
      const setupScript = hooks?.scripts.setup
      let shouldLaunchSetup = false
      if (setupScript) {
        try {
          shouldLaunchSetup = shouldRunSetupForCreate(repo, args.setupDecision)
        } catch (error) {
          // Why: worktree already exists; skip setup rather than fail a successful git create when the branch adds a hook without a renderer decision.
          console.warn(`[hooks] setup hook skipped for ${created.path}:`, error)
        }
      }
      if (setupScript && shouldLaunchSetup) {
        try {
          setup = await createRemoteSetupRunnerScript(
            repo,
            created.path,
            setupScript,
            provider,
            fsProvider
          )
        } catch (error) {
          console.error(`[hooks] Failed to prepare setup runner for ${created.path}:`, error)
        }
      }
    })
  }

  notifyWorktreesChanged(mainWindow, repo.id)
  return {
    worktree: { ...worktree, workspaceLineage },
    ...(workspaceLineage ? { workspaceLineage } : {}),
    ...(setup ? { setup } : {}),
    ...(defaultTabs ? { defaultTabs } : {}),
    ...(localBaseRefRefresh ? { localBaseRefRefresh } : {}),
    ...(localBaseRefUpdateSuggestion ? { localBaseRefUpdateSuggestion } : {}),
    ...(baseFallback ? { baseFallback } : {}),
    timing: timing.finish()
  }
}
