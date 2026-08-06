import { pickResumeWorktree } from './worktree/resume-worktree'
import type { RpcClient } from './transport/rpc-client'
import { sendSingleFlightRequest } from './transport/request-single-flight'
import { setCachedWorktrees } from './cache/worktree-cache'
import { filterAvailableTaskProviders, normalizeVisibleTaskProviders, type TaskProvider } from './tasks/mobile-task-providers'
import type { Worktree } from './worktree/workspace-list-sections'

export function endpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return endpoint
  }
}

export type WorktreeSummary = {
  worktreeId: string
  repo: string
  branch: string
  displayName: string
  liveTerminalCount: number
  status?: 'working' | 'active' | 'permission' | 'done' | 'inactive'
  // The worktree the desktop currently has focused (exactly one is true).
  isActive?: boolean
  // Last terminal-output time (ms); breaks ties when nothing is focused.
  lastOutputAt?: number
}

export type HostWorktreeInfo = {
  hostId: string
  totalWorktrees: number
  activeCount: number
  lastActiveWorktree: WorktreeSummary | null
}

export type HomeTaskSettings = {
  visibleTaskProviders?: unknown
}

export type HomePreflightStatus = {
  glab?: { installed?: boolean }
}

export type HomeLinearStatus = {
  connected?: boolean
}

export const TASK_PROVIDER_LABELS: Record<TaskProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear'
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  const minutes = totalMinutes % 60
  if (totalHours > 0) {
    return `${totalHours}h ${minutes}m`
  }
  return `${totalMinutes}m`
}

// Why: stable per-instance RpcClient identity so wireUp's dep key changes when forceReconnect swaps the client, re-attaching listeners.
const clientIdentities = new WeakMap<RpcClient, number>()
let nextClientIdentity = 1
export function clientKey(client: RpcClient): number {
  let id = clientIdentities.get(client)
  if (id == null) {
    id = nextClientIdentity++
    clientIdentities.set(client, id)
  }
  return id
}

export function fetchWorktreeInfo(
  client: RpcClient,
  hostId: string,
  setInfo: (
    updater: (prev: Record<string, HostWorktreeInfo>) => Record<string, HostWorktreeInfo>
  ) => void,
  disposed: () => boolean
) {
  // Why: only seed a zeroed entry when the host has no prior info; keep cached data on transient failure so counts don't flip to 0 during reconnects.
  const markLoadedIfMissing = () => {
    setInfo((prev) => {
      if (prev[hostId]) {
        return prev
      }
      return {
        ...prev,
        [hostId]: {
          hostId,
          totalWorktrees: 0,
          activeCount: 0,
          lastActiveWorktree: null
        }
      }
    })
  }

  // Why: worktree.ps defaults to 200 and silently truncates; request all so counts are accurate.
  sendSingleFlightRequest(client, hostId, 'worktree.ps', { limit: 10000 })
    .then((response) => {
      if (disposed()) {
        return
      }
      if (response.ok) {
        const result = response.result as { worktrees: WorktreeSummary[] }
        const worktrees = result.worktrees ?? []
        setCachedWorktrees(hostId, worktrees)
        const activeStatuses = new Set(['working', 'active', 'permission'])
        const active = worktrees.filter((w) => w.status && activeStatuses.has(w.status))
        // Mirror the desktop's focused workspace (see pickResumeWorktree).
        const lastActive = pickResumeWorktree(worktrees)
        setInfo((prev) => ({
          ...prev,
          [hostId]: {
            hostId,
            totalWorktrees: worktrees.length,
            activeCount: active.length,
            lastActiveWorktree: lastActive
          }
        }))
      } else {
        markLoadedIfMissing()
      }
    })
    .catch(() => {
      if (!disposed()) {
        markLoadedIfMissing()
      }
    })
}

export function fetchTaskProviders(
  client: RpcClient,
  hostId: string,
  setProviders: (
    updater: (prev: Record<string, TaskProvider[]>) => Record<string, TaskProvider[]>
  ) => void,
  disposed: () => boolean
) {
  Promise.all([
    sendSingleFlightRequest(client, hostId, 'settings.get'),
    sendSingleFlightRequest(client, hostId, 'preflight.check'),
    sendSingleFlightRequest(client, hostId, 'linear.status')
  ])
    .then(([settingsResponse, preflightResponse, linearResponse]) => {
      if (disposed()) {
        return
      }
      const settings = settingsResponse.ok
        ? (((settingsResponse.result as { settings?: HomeTaskSettings }).settings ??
            {}) as HomeTaskSettings)
        : {}
      const preflight = preflightResponse.ok
        ? (preflightResponse.result as HomePreflightStatus)
        : null
      const linear = linearResponse.ok ? (linearResponse.result as HomeLinearStatus) : null
      const providers = filterAvailableTaskProviders(
        normalizeVisibleTaskProviders(settings.visibleTaskProviders),
        {
          gitlabInstalled: preflight?.glab?.installed === true,
          linearConnected: linear?.connected === true
        }
      )
      setProviders((prev) => ({ ...prev, [hostId]: providers }))
    })
    .catch(() => {
      if (disposed()) {
        return
      }
      setProviders((prev) => (prev[hostId] ? prev : { ...prev, [hostId]: ['github'] }))
    })
}

// Why: hash repo name to a stable color, matching the host detail page's dots.
const REPO_COLORS = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4']
export function repoColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return REPO_COLORS[Math.abs(hash) % REPO_COLORS.length]
}
