import type {
  AgentStatusEntry,
  MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import type { Repo, TerminalTab, Worktree } from '../../../../shared/types'
import type { WorkspaceSpaceWorktree } from '../../../../shared/workspace-space-types'
import { getHostedReviewCacheKey } from '../../store/slices/hosted-review'
import { issueCacheKey as getIssueCacheKey } from '../../store/slices/github'
import { branchDisplayName } from '../sidebar/WorktreeCardHelpers'
import { getWorkspaceSpaceBranchLabel } from './workspace-space-format'
import { countWorkspaceSpaceActiveAgents } from './workspace-space-presentation'
export type WorkspaceDecisionDetails = {
  isActive: boolean
  canOpenWorkspace: boolean
  terminalTabCount: number
  liveTerminalCount: number
  activeAgentCount: number
  completedAgentCount: number
  openEditorFileCount: number
  dirtyEditorBufferCount: number
  browserTabCount: number
  changedFileCount: number | null
  branchStatus: string | null
  reviewLabel: string | null
  issueLabel: string | null
  linearIssueLabel: string | null
}

type WorkspaceDecisionInputs = {
  repoMap: Map<string, Repo>
  worktreeMap: Map<string, Worktree>
  tabsByWorktree: Record<string, TerminalTab[]>
  ptyIdsByTabId: Record<string, string[]>
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  migrationUnsupportedByPtyId: Record<string, MigrationUnsupportedPtyEntry>
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>
  retainedAgentsByPaneKey: Record<string, { worktreeId: string; entry: AgentStatusEntry }>
  openFiles: { id: string; worktreeId: string; isDirty: boolean }[]
  editorDrafts: Record<string, string>
  browserTabsByWorktree: Record<string, unknown[]>
  gitStatusByWorktree: Record<string, unknown[]>
  remoteStatusesByWorktree: Record<string, { hasUpstream: boolean; ahead: number; behind: number }>
  hostedReviewCache: Record<
    string,
    { data?: { number: number; state: string; status: string; title: string } | null }
  >
  issueCache: Record<string, { data?: { number: number; title: string; state: string } | null }>
  linearIssueCache: Record<
    string,
    { data?: { identifier: string; title: string; state?: { name: string } } | null }
  >
  settings: Parameters<typeof getHostedReviewCacheKey>[2]
  activeWorktreeId: string | null
  now: number
}

function formatReviewState(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1)
}

function countLiveTerminals(
  tabs: readonly TerminalTab[],
  ptyIdsByTabId: Record<string, string[]>
): number {
  return tabs.filter((tab) => (ptyIdsByTabId[tab.id]?.length ?? 0) > 0).length
}

function getBranchStatus(
  status: { hasUpstream: boolean; ahead: number; behind: number } | undefined
): string | null {
  if (!status?.hasUpstream) {
    return null
  }
  if (status.ahead === 0 && status.behind === 0) {
    return 'Synced with upstream'
  }
  const parts: string[] = []
  if (status.ahead > 0) {
    parts.push(`${status.ahead} ahead`)
  }
  if (status.behind > 0) {
    parts.push(`${status.behind} behind`)
  }
  return parts.join(', ')
}

export function getWorkspaceDecisionDetails(
  worktree: WorkspaceSpaceWorktree,
  inputs: WorkspaceDecisionInputs
): WorkspaceDecisionDetails {
  const workspaceRecord = inputs.worktreeMap.get(worktree.worktreeId)
  const tabs = inputs.tabsByWorktree[worktree.worktreeId] ?? []
  const openFiles = inputs.openFiles.filter((file) => file.worktreeId === worktree.worktreeId)
  const dirtyEditorBufferCount = openFiles.filter(
    (file) => file.isDirty || inputs.editorDrafts[file.id] !== undefined
  ).length
  const gitEntries = inputs.gitStatusByWorktree[worktree.worktreeId]
  const branch = workspaceRecord
    ? branchDisplayName(workspaceRecord.branch)
    : getWorkspaceSpaceBranchLabel(worktree)
  const repo = inputs.repoMap.get(worktree.repoId)
  const reviewCacheKey = getHostedReviewCacheKey(
    worktree.repoPath,
    branch,
    inputs.settings,
    worktree.repoId,
    repo?.connectionId,
    repo?.executionHostId,
    repo !== undefined
  )
  const hostedReview = inputs.hostedReviewCache[reviewCacheKey]?.data
  const linkedPR = workspaceRecord?.linkedPR ?? null
  const reviewLabel =
    hostedReview !== undefined && hostedReview !== null
      ? `PR #${hostedReview.number} ${formatReviewState(hostedReview.state)}${
          hostedReview.status && hostedReview.status !== 'none' ? `, ${hostedReview.status}` : ''
        }`
      : linkedPR
        ? `PR #${linkedPR}`
        : null
  const linkedIssue = workspaceRecord?.linkedIssue ?? null
  const issue =
    linkedIssue && repo
      ? inputs.issueCache[
          getIssueCacheKey(
            repo.path,
            repo.id,
            linkedIssue,
            inputs.settings,
            repo.connectionId,
            repo.executionHostId,
            true
          )
        ]?.data
      : null
  const issueLabel = linkedIssue
    ? issue
      ? `#${issue.number} ${issue.state}: ${issue.title}`
      : `#${linkedIssue}`
    : null
  const linkedLinearIssue = workspaceRecord?.linkedLinearIssue ?? null
  const linearIssue = linkedLinearIssue
    ? (inputs.linearIssueCache[`selected::${linkedLinearIssue}`]?.data ??
      inputs.linearIssueCache[linkedLinearIssue]?.data)
    : null
  const linearIssueLabel = linkedLinearIssue
    ? linearIssue
      ? `${linearIssue.identifier}${
          linearIssue.state?.name ? ` ${linearIssue.state.name}` : ''
        }: ${linearIssue.title}`
      : linkedLinearIssue
    : null

  return {
    isActive: inputs.activeWorktreeId === worktree.worktreeId,
    canOpenWorkspace: workspaceRecord !== undefined,
    terminalTabCount: tabs.length,
    liveTerminalCount: countLiveTerminals(tabs, inputs.ptyIdsByTabId),
    activeAgentCount: countWorkspaceSpaceActiveAgents({
      worktreeId: worktree.worktreeId,
      tabs,
      agentStatusByPaneKey: inputs.agentStatusByPaneKey,
      migrationUnsupportedByPtyId: inputs.migrationUnsupportedByPtyId,
      runtimePaneTitlesByTabId: inputs.runtimePaneTitlesByTabId,
      ptyIdsByTabId: inputs.ptyIdsByTabId,
      now: inputs.now
    }),
    completedAgentCount: Object.values(inputs.retainedAgentsByPaneKey).filter(
      (entry) => entry.worktreeId === worktree.worktreeId && entry.entry.state === 'done'
    ).length,
    openEditorFileCount: openFiles.length,
    dirtyEditorBufferCount,
    browserTabCount: inputs.browserTabsByWorktree[worktree.worktreeId]?.length ?? 0,
    changedFileCount: gitEntries ? gitEntries.length : null,
    branchStatus: getBranchStatus(inputs.remoteStatusesByWorktree[worktree.worktreeId]),
    reviewLabel,
    issueLabel,
    linearIssueLabel
  }
}
