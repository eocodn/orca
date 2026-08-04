import {
  PROVIDER_REQUEST_ID_MAX_UTF8_BYTES,
  type DirectSshDetectedWorktreeRequest,
  type HostQualifiedDetectedWorktreeResult,
  type ListDetectedWorktreesArgs
} from '../../shared/detected-worktree-provider-contract'
import { LOCAL_EXECUTION_HOST_ID, parseExecutionHostId } from '../../shared/execution-host'
import type {
  HostLineageSnapshot,
  ListDesktopLineageForHostArgs
} from '../../shared/host-lineage-contract'
import type { Store } from '../persistence'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { isCurrentSshProviderAuthority } from '../ssh/ssh-provider-authority'

import {
  findExactRepoOwner,
  isCapturedRepoCurrent,
  listDetectedWorktreesForCapturedRepo,
  resolveRepoOwnershipEvidence
} from './worktree-ipc-local'
import {
  filterLineageForHost,
  hasValidDirectSshAuthority,
  hasValidLineageSshAuthority
} from './worktree-ipc-metadata'
export {
  findExactRepoOwner,
  isCapturedRepoCurrent,
  listDetectedWorktreesForCapturedRepo,
  resolveRepoOwnershipEvidence
} from './worktree-ipc-local'
export {
  createLineageResolutionContext,
  filterLineageForHost,
  getFolderLineageCandidateRepos,
  hasValidDirectSshAuthority,
  hasValidLineageSshAuthority,
  indexLineageEntriesById,
  resolveFolderLineageOwner,
  resolveRepoLineageOwner,
  resolveWorkspaceLineageOwner,
  resolveWorktreeLineageOwner,
  type LineageFolder,
  type LineageGroup,
  type LineageOwner,
  type LineageResolutionContext
} from './worktree-ipc-metadata'

export async function listDesktopLineageForHost(
  store: Store,
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
