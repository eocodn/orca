import { ipcMain, type BrowserWindow } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Store } from '../persistence'
import { isFolderRepo } from '../../shared/repo-kind'
import { readBranchRenameFailureOutputForDisplay } from '../agent-hooks/branch-rename-failure-output'
import {
  isWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../shared/workspace-scope'
import { inspectSetupScriptImportCandidates } from '../../shared/setup-script-imports'
import { getProjectHostSetupWorktreeMeta } from '../../shared/project-host-setup-projection'
import { TaskSourceContextSchema } from '../../shared/task-source-context-schema'
import { WorkspaceLinkedItemSchema } from '../../shared/workspace-linked-item-schema'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../shared/workspace-linked-item-source-context'
import { getProjectGroupSubtreeIds } from '../../shared/project-groups'
import { projectResolvedWorktreeLineage } from '../../shared/resolved-worktree-lineage'
import { isPathInsideOrEqual, isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { deleteWorktreeHistoryDir } from '../terminal-history-deletion'
import type {
  AutomationWorkspaceProvenance,
  CliWorkspaceProvenance,
  CreateWorktreeArgs,
  CreateWorktreeResult,
  DetectedWorktree,
  DetectedWorktreeListResult,
  ForceDeleteWorktreeBranchResult,
  GitHubPrStartPoint,
  GitPushTarget,
  GitWorktreeInfo,
  OrcaHooks,
  Repo,
  RemoveWorktreeResult,
  Worktree,
  WorktreeLineage,
  WorkspaceLineage,
  WorktreeMeta
} from '../../shared/types'
import { assertWorktreeUnlockedForRemoval } from '../../shared/worktree-removal'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import {
  PROVIDER_REQUEST_ID_MAX_UTF8_BYTES,
  type DirectSshDetectedWorktreeRequest,
  type HostQualifiedDetectedWorktreeResult,
  type ListDetectedWorktreesArgs,
  type ProviderRequestId
} from '../../shared/detected-worktree-provider-contract'
import type {
  HostLineageSnapshot,
  ListDesktopLineageForHostArgs
} from '../../shared/host-lineage-contract'
import { isAdmissibleDirectSshAuthority } from '../../shared/ssh-retained-payload-admission'
import {
  applyMetadataFallbackVisibility,
  buildKnownOrcaWorkspaceLayouts,
  isLegacyRepoForExternalWorktreeVisibility,
  toDetectedWorktree
} from '../../shared/worktree-ownership'
import { createAgentScratchWorktreePathMatcher } from '../../shared/agent-scratch-worktrees'
import {
  assertWorktreeCleanForRemoval,
  forceDeleteLocalBranch,
  listWorktreesStrict as listGitWorktreesStrict,
  removeWorktree
} from '../git/worktree'
import { gitExecFileAsync } from '../git/runner'
import { withWorktreeRemoveStageSpan, withWorktreeSpan } from '../observability/instrumentation'
import { resolveGitHubPrStartPoint } from '../github/pr-start-point'
import {
  fetchGitHubPullRequestHeadRef,
  fetchPrHeadTrackingRef
} from '../github/pr-head-tracking-ref'
import { pruneWorktreePRRefreshAliases } from '../github/pr-refresh-coordinator'
import { resolveGitHubReviewHeadRemote } from '../github/review-head-remote'
import { listRepoWorktrees } from '../repo-worktrees'
import { getSshGitProvider, requireSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import {
  createIssueCommandRunnerScript,
  getEffectiveHooks,
  getEffectiveHooksFromConfig,
  getSetupRunnerEnvVars,
  loadHooks,
  parseOrcaYaml,
  readIssueCommand,
  runHook,
  hasHooksFile,
  hasUnrecognizedOrcaYamlKeys,
  writeIssueCommand
} from '../hooks'
import {
  mergeWorktree,
  parseWorktreeId,
  areWorktreePathsEqual,
  formatWorktreeRemovalError,
  isOrphanCompatiblePreflightError,
  isOrphanedWorktreeError
} from './worktree-logic'
import { dedupeWorktreesByPath } from './worktree-path-comparison'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'
import {
  createLocalWorktree,
  createRemoteWorktree,
  cleanupUnusedWorktreePushTargetRemote,
  cleanupUnusedWorktreePushTargetRemoteSsh,
  notifyWorktreesChanged
} from './worktree-remote'
import { registerWorktreeChangeInvalidator } from './worktree-change-invalidators'
import {
  invalidateAuthorizedRootsCache,
  isENOENT,
  registerWorktreeRootsForRepo
} from './filesystem-auth'
import type { OrcaRuntimeService, RuntimeWorktreeLifecycleEvent } from '../runtime/orca-runtime'
import { killAllProcessesForWorktree } from '../runtime/worktree-teardown'
import { clearProviderPtyState, getLocalPtyProvider, getSshPtyProvider } from './pty'
import { findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths } from './worktree-symlinks'
import { getWorktreeSharedLinkPaths } from '../git/worktree-shared-directories'
import { track } from '../telemetry/client'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import { workspaceSourceSchema, type WorkspaceSource } from '../../shared/telemetry-events'
import {
  finishAutomationWorkspaceProvenanceRequest,
  releaseAutomationWorkspaceProvenanceRequest,
  resolveAutomationWorkspaceProvenance
} from '../automations/workspace-provenance'
import { shouldEmitBoundedWarning } from './bounded-warning-dedupe'
import {
  getSshProviderAuthority,
  isCurrentSshProviderAuthority,
  registerSshProviderRequestAbort
} from '../ssh/ssh-provider-authority'
import { createSenderScopedRequestCancellations } from './sender-scoped-request-cancellation'
import { LINEAGE_HYDRATION_TIMEOUT_MS } from './worktree-ipc-creation'

import { hasValidDirectSshAuthority,
  hasValidLineageSshAuthority,
  type LineageOwner,
  type LineageFolder,
  type LineageGroup,
  type LineageResolutionContext,
  indexLineageEntriesById,
  createLineageResolutionContext,
  resolveRepoLineageOwner,
  resolveWorktreeLineageOwner,
  getFolderLineageCandidateRepos,
  resolveFolderLineageOwner,
  resolveWorkspaceLineageOwner,
  filterLineageForHost } from './worktree-ipc-metadata'
import {
  findExactRepoOwner,
  isCapturedRepoCurrent,
  listDetectedWorktreesForCapturedRepo,
  resolveRepoOwnershipEvidence } from './worktree-ipc-local'
export { hasValidDirectSshAuthority,
  hasValidLineageSshAuthority,
  type LineageOwner,
  type LineageFolder,
  type LineageGroup,
  type LineageResolutionContext,
  indexLineageEntriesById,
  createLineageResolutionContext,
  resolveRepoLineageOwner,
  resolveWorktreeLineageOwner,
  getFolderLineageCandidateRepos,
  resolveFolderLineageOwner,
  resolveWorkspaceLineageOwner,
  filterLineageForHost } from './worktree-ipc-metadata'
export { findExactRepoOwner,
  isCapturedRepoCurrent,
  listDetectedWorktreesForCapturedRepo,
  resolveRepoOwnershipEvidence } from './worktree-ipc-local'

export async function hydrateLineageWithinDeadline(runtime: OrcaRuntimeService): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const hydration = Promise.resolve()
    .then(() => runtime.hydrateInferredWorktreeLineage())
    .then(
      () => true,
      () => false
    )
  const deadline = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), LINEAGE_HYDRATION_TIMEOUT_MS)
  })
  try {
    return await Promise.race([hydration, deadline])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export async function listDesktopLineageForHost(
  store: Store,
  runtime: OrcaRuntimeService,
  args: ListDesktopLineageForHostArgs
): Promise<HostLineageSnapshot> {
  const parsedHost = parseExecutionHostId(args?.executionHostId)
  const rejected = (
    reason: Extract<HostLineageSnapshot, { authoritative: false }>['reason']
  ): HostLineageSnapshot => ({
    authoritative: false,
    executionHostId: args.executionHostId,
    reason
  })
  if (!parsedHost || parsedHost.kind === 'runtime') {
    return rejected('rejected')
  }
  let provider: ReturnType<typeof getSshGitProvider> | undefined
  let authority:
    | Extract<ListDesktopLineageForHostArgs, { expectedAuthority: unknown }>['expectedAuthority']
    | null = null
  if (parsedHost.kind === 'local') {
    if ('expectedAuthority' in args) {
      return rejected('rejected')
    }
  } else {
    if (
      !hasValidLineageSshAuthority(args) ||
      args.expectedAuthority.targetId !== parsedHost.targetId
    ) {
      return rejected('rejected')
    }
    authority = { ...args.expectedAuthority }
    if (!isCurrentSshProviderAuthority(authority)) {
      return rejected('stale')
    }
    provider = getSshGitProvider(parsedHost.targetId)
    if (!provider) {
      return rejected('unavailable')
    }
  }
  if (!(await hydrateLineageWithinDeadline(runtime))) {
    return rejected('unavailable')
  }
  if (
    parsedHost.kind === 'ssh' &&
    (!authority ||
      getSshGitProvider(parsedHost.targetId) !== provider ||
      !isCurrentSshProviderAuthority(authority))
  ) {
    return rejected('stale')
  }
  const lineage = filterLineageForHost(store, parsedHost.id)
  if (!lineage) {
    return rejected('ambiguous-owner')
  }
  if (parsedHost.kind === 'local') {
    return {
      authoritative: true,
      authority: { kind: 'local', executionHostId: LOCAL_EXECUTION_HOST_ID },
      ...lineage
    }
  }
  if (!authority) {
    return rejected('authority-unknown')
  }
  return {
    authoritative: true,
    authority: {
      kind: 'direct-ssh',
      executionHostId: parsedHost.id,
      ...authority
    },
    ...lineage
  }
}

export async function listHostQualifiedDetectedWorktrees(
  store: Store,
  args: ListDetectedWorktreesArgs,
  providerAbort?: { signal: AbortSignal; status: () => 'canceled' | 'timed-out' }
): Promise<HostQualifiedDetectedWorktreeResult> {
  const parsedHost = parseExecutionHostId(args.executionHostId)
  const rejected = (status: 'rejected' | 'stale' | 'ambiguous-owner') => ({
    providerRequestId: args.providerRequestId,
    executionHostId: args.executionHostId,
    status
  })
  if (
    typeof args.providerRequestId !== 'string' ||
    args.providerRequestId.length === 0 ||
    Buffer.byteLength(args.providerRequestId, 'utf8') > PROVIDER_REQUEST_ID_MAX_UTF8_BYTES ||
    !parsedHost ||
    parsedHost.kind === 'runtime'
  ) {
    return rejected('rejected')
  }
  let capturedAuthority: DirectSshDetectedWorktreeRequest['expectedAuthority'] | null = null
  if (parsedHost.kind === 'ssh') {
    const directArgs = args as DirectSshDetectedWorktreeRequest
    if (
      !hasValidDirectSshAuthority(directArgs) ||
      directArgs.expectedAuthority.targetId !== parsedHost.targetId
    ) {
      return rejected('rejected')
    }
    capturedAuthority = { ...directArgs.expectedAuthority }
    if (!isCurrentSshProviderAuthority(capturedAuthority)) {
      return rejected('stale')
    }
  }

  const repoCandidates = store.getRepos().filter((candidate) => candidate.id === args.repoId)
  if (
    repoCandidates.some((candidate) => resolveRepoOwnershipEvidence(candidate).status !== 'owned')
  ) {
    return rejected('rejected')
  }
  const repo = findExactRepoOwner(store, args.repoId, args.executionHostId)
  if (!repo) {
    return rejected('ambiguous-owner')
  }
  if (
    (parsedHost.kind === 'local' && repo.connectionId) ||
    (parsedHost.kind === 'ssh' && repo.connectionId !== parsedHost.targetId)
  ) {
    return rejected('rejected')
  }
  const provider = parsedHost.kind === 'ssh' ? getSshGitProvider(parsedHost.targetId) : undefined
  const isCurrent = (): boolean => {
    if (!isCapturedRepoCurrent(store, repo, args.executionHostId)) {
      return false
    }
    if (
      (parsedHost.kind === 'local' && repo.connectionId) ||
      (parsedHost.kind === 'ssh' && repo.connectionId !== parsedHost.targetId)
    ) {
      return false
    }
    if (parsedHost.kind !== 'ssh') {
      return true
    }
    return (
      capturedAuthority !== null &&
      getSshGitProvider(parsedHost.targetId) === provider &&
      isCurrentSshProviderAuthority(capturedAuthority)
    )
  }
  const result = await listDetectedWorktreesForCapturedRepo(
    store,
    repo,
    isCurrent,
    provider,
    providerAbort
  )
  if (!result) {
    return rejected('stale')
  }
  if ('providerAbortStatus' in result) {
    return {
      providerRequestId: args.providerRequestId,
      executionHostId: args.executionHostId,
      status: result.providerAbortStatus
    }
  }
  const status = result.authoritative ? 'complete' : 'non-authoritative'
  if (parsedHost.kind === 'local') {
    return {
      status,
      providerRequestId: args.providerRequestId,
      repoId: repo.id,
      authority: { kind: 'local', executionHostId: LOCAL_EXECUTION_HOST_ID },
      result
    }
  }
  if (!capturedAuthority) {
    return rejected('rejected')
  }
  return {
    status,
    providerRequestId: args.providerRequestId,
    repoId: repo.id,
    authority: {
      kind: 'direct-ssh',
      executionHostId: args.executionHostId as `ssh:${string}`,
      ...capturedAuthority
    },
    result
  }
}
