// Why: worktree create helpers (local + remote) split out of worktrees.ts; the cohesive create flow runs this file just over the per-file line limit.

import type {
  AutomationWorkspaceProvenance,
  CliWorkspaceProvenance,
  CreateWorktreeArgs,
  CreateWorktreeResult,
  LocalBaseRefRefreshResult
} from '../../shared/types'
import type { RemoteTrackingBase } from '../runtime/orca-runtime'

export type CreateWorktreeArgsWithSystemProvenance = CreateWorktreeArgs & {
  automationProvenance?: AutomationWorkspaceProvenance
  cliProvenance?: CliWorkspaceProvenance
}

export const SSH_WORKTREE_CREATE_FETCH_FRESHNESS_MS = 30_000
export const SSH_WORKTREE_CREATE_FETCH_CACHE_MAX = 512
// Why: bound the fallback `git fetch origin` so a Windows credential-manager GUI hang (STA-1292) can't wedge worktree creation forever.
export const CREATE_BASE_FALLBACK_FETCH_TIMEOUT_MS = 60_000
export const sshWorktreeCreateFetchInflight = new Map<string, Promise<void>>()
export const sshWorktreeCreateFetchCompletedAt = new Map<string, number>()
export const sshWorktreeCreateFetchQueueTail = new Map<string, Promise<void>>()
export const sshWorktreeCreateBasePlanInflight = new Map<
  string,
  Promise<RemoteWorktreeCreateBasePlan | null>
>()

export type RemoteWorktreeCreateBasePlan = {
  baseBranch: string
  remoteTrackingBase: RemoteTrackingBase | null
}

export type StagedStartupResult = {
  startupTerminal?: CreateWorktreeResult['startupTerminal']
  activationSetup?: CreateWorktreeResult['setup']
  didSpawnSetup: boolean
  warning?: string
}

export type RemoteLocalBaseRefRefreshability =
  | {
      refreshable: true
      baseRef: string
      localBranch: string
      fullRef: string
      remoteTrackingRef: string
      behind: number
      ownerWorktreePath?: string
    }
  | {
      refreshable: false
      result: LocalBaseRefRefreshResult
    }
