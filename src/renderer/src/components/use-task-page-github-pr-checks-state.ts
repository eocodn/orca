import { useCallback, useEffect } from 'react'

import type { AppState } from '@/store'
import { sameGitHubOwnerRepo } from '@/components/github/IssueSourceIndicator'
import { deriveTaskPagePRCheckSummary } from '@/components/task-page-pr-check-summary'
import { getTaskPageRepoSourceContext } from './task-page-source-context'
import type { GitHubWorkItem, Repo } from '../../../shared/types'

const PR_CHECKS_EAGER_PREFETCH_LIMIT = 20

type PatchTaskPageWorkItemRows = (
  itemKey: { id: string; repoId: string },
  patch: Partial<GitHubWorkItem>,
  shouldPatch?: (item: GitHubWorkItem) => boolean
) => void

type TaskPageGitHubPRChecksStateProps = {
  fetchPRChecks: AppState['fetchPRChecks']
  filteredWorkItems: readonly GitHubWorkItem[]
  githubMode: string
  patchTaskPageWorkItemRows: PatchTaskPageWorkItemRows
  repoMap: ReadonlyMap<string, Repo>
  showPRManagementColumns: boolean
  taskSource: string
}

export function useTaskPageGitHubPRChecksState({
  fetchPRChecks,
  filteredWorkItems,
  githubMode,
  patchTaskPageWorkItemRows,
  repoMap,
  showPRManagementColumns,
  taskSource
}: TaskPageGitHubPRChecksStateProps) {
  const ensurePRChecksLoaded = useCallback(
    (item: GitHubWorkItem): void => {
      if (item.type !== 'pr' || item.checksSummary) {
        return
      }
      const repo = repoMap.get(item.repoId)
      if (!repo) {
        return
      }
      const requestedHeadSha = item.headSha
      const requestedPRRepo = item.prRepo ?? null
      void fetchPRChecks(
        repo.path,
        item.number,
        item.branchName,
        item.headSha,
        item.prRepo ?? null,
        { repoId: repo.id, sourceContext: getTaskPageRepoSourceContext(repo, 'github') }
      ).then((checks) => {
        patchTaskPageWorkItemRows(
          { id: item.id, repoId: item.repoId },
          { checksSummary: deriveTaskPagePRCheckSummary(checks) },
          (currentItem) =>
            currentItem.type === 'pr' &&
            currentItem.headSha === requestedHeadSha &&
            sameGitHubOwnerRepo(currentItem.prRepo ?? null, requestedPRRepo)
        )
      })
    },
    [fetchPRChecks, patchTaskPageWorkItemRows, repoMap]
  )

  useEffect(() => {
    if (taskSource !== 'github' || githubMode !== 'items' || !showPRManagementColumns) {
      return
    }

    for (const item of filteredWorkItems.slice(0, PR_CHECKS_EAGER_PREFETCH_LIMIT)) {
      ensurePRChecksLoaded(item)
    }
  }, [ensurePRChecksLoaded, filteredWorkItems, githubMode, showPRManagementColumns, taskSource])

  return { ensurePRChecksLoaded }
}
