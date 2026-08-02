import type { RpcClient } from '../transport/rpc-client'
import type { TuiAgent } from '../../../src/shared/types'
import type { SetupHookTrust } from '../tasks/setup-hook-trust'


export type Repo = {
  id: string
  displayName: string
  path: string
  badgeColor?: string
  connectionId?: string | null
  kind?: 'git' | 'folder'
  upstream?: { owner: string; repo: string } | null
  gitRemoteIdentity?: { remoteUrl?: string; canonicalKey?: string } | null
}

export type SetupDecision = 'inherit' | 'run' | 'skip'
export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
export type RuntimeSettings = {
  defaultTuiAgent?: TuiAgent | 'blank' | null
  disabledTuiAgents?: TuiAgent[]
}

export type RepoHooksResponse = {
  hooks: { scripts?: { setup?: string } } | null
  source: string | null
  setupRunPolicy?: SetupRunPolicy
  setupTrust?: SetupHookTrust
}

export type SetupHookDetails = {
  repoId: string
  command: string | null
  source: string | null
  trust: SetupHookTrust | null
  runPolicy: SetupRunPolicy
}

export type DetectedAgentIdsState = {
  connectionId: string | null
  ids: Set<string>
}

export type CreateOptions = {
  setupOverride?: Exclude<SetupDecision, 'inherit'>
  approvedSetupContentHash?: string
}

export function repoColor(name: string): string {
  const palette = ['#f97316', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f59e0b', '#6366f1']
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return palette[Math.abs(hash) % palette.length]!
}

export function repoBadgeColor(repo: Repo | null): string {
  return repo?.badgeColor || repoColor(repo?.displayName ?? 'repository')
}

export type Props = {
  visible: boolean
  client: RpcClient | null
  hostId?: string
  // Why: existing worktree paths from the host so we can pick a unique
  // marine-creature default when the user leaves the name blank, matching
  // the desktop UI's behavior. The "already exists locally" collision is
  // on the on-disk directory basename, so paths (not displayNames) are
  // what the suggestion logic must dedupe against.
  existingWorktreePaths?: readonly string[]
  existingWorktrees?: readonly { repoId: string; branch: string }[]
  onCreated: (worktreeId: string, name: string) => void
  onClose: () => void
}
