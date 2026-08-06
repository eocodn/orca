import { useEffect, useMemo, useState } from 'react'

import {
  isNewIssueDraftContentful,
  resolveVanishedNewIssueRepoReset
} from '@/components/task-page-new-issue-draft'
import { useRepoAssignees, useRepoLabels } from '@/hooks/useIssueMetadata'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { getTaskSourceRuntimeSettings } from '../../../shared/task-source-context'
import type { GlobalSettings, GitHubAssignableUser, Repo } from '../../../shared/types'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { getTaskPageRepoSourceContext } from './task-page-source-context'

type TaskPageGitHubNewIssueStateProps = {
  selectedRepos: Repo[]
  repos: Repo[]
  settings: GlobalSettings | null
}

export function useTaskPageGitHubNewIssueState({
  selectedRepos,
  repos,
  settings
}: TaskPageGitHubNewIssueStateProps) {
  const [newIssueOpen, setNewIssueOpen] = useState(false)
  const [newIssueTitle, setNewIssueTitle] = useState('')
  const [newIssueBody, setNewIssueBody] = useState('')
  const [newIssueLabels, setNewIssueLabels] = useState<string[]>([])
  const [newIssueAssignees, setNewIssueAssignees] = useState<GitHubAssignableUser[]>([])
  const [newIssueSubmitting, setNewIssueSubmitting] = useState(false)
  const [newIssueRepoId, setNewIssueRepoId] = useState<string | null>(null)
  const setNewIssueDraft = useAppStore((state) => state.setNewIssueDraft)
  const clearNewIssueDraft = useAppStore((state) => state.clearNewIssueDraft)

  const newIssueTargetRepo = useMemo(
    () => selectedRepos.find((repo) => repo.id === newIssueRepoId) ?? selectedRepos[0] ?? null,
    [selectedRepos, newIssueRepoId]
  )
  const newIssueSourceContext = useMemo(
    () => getTaskPageRepoSourceContext(newIssueTargetRepo, 'github'),
    [newIssueTargetRepo]
  )
  const newIssueRuntimeTarget = useMemo(() => {
    if (!newIssueTargetRepo?.id) {
      return null
    }
    const repoOwnerSettings = getSettingsForRepoRuntimeOwner(
      { repos: [newIssueTargetRepo], settings },
      newIssueTargetRepo.id
    )
    const targetSettings =
      newIssueSourceContext?.provider === 'github'
        ? {
            ...repoOwnerSettings,
            ...getTaskSourceRuntimeSettings(newIssueSourceContext)
          }
        : repoOwnerSettings
    const target = getActiveRuntimeTarget(targetSettings)
    if (target.kind !== 'environment') {
      return null
    }
    return repos.some((repo) => repo.id === newIssueTargetRepo.id) ? target : null
  }, [newIssueSourceContext, newIssueTargetRepo, repos, settings])
  const newIssueRepoLabels = useRepoLabels(
    newIssueOpen ? (newIssueTargetRepo?.path ?? null) : null,
    newIssueOpen ? (newIssueTargetRepo?.id ?? null) : null,
    { runtimeEnvironmentId: newIssueOpen ? (newIssueRuntimeTarget?.environmentId ?? null) : null }
  )
  const newIssueRepoAssignees = useRepoAssignees(
    newIssueOpen ? (newIssueTargetRepo?.path ?? null) : null,
    newIssueOpen ? (newIssueTargetRepo?.id ?? null) : null,
    { runtimeEnvironmentId: newIssueOpen ? (newIssueRuntimeTarget?.environmentId ?? null) : null }
  )

  useEffect(() => {
    const reset = resolveVanishedNewIssueRepoReset(
      newIssueRepoId,
      selectedRepos.map((repo) => repo.id)
    )
    if (!reset) {
      return
    }
    setNewIssueLabels([])
    setNewIssueAssignees([])
    setNewIssueRepoId(reset.repoId)
  }, [newIssueRepoId, selectedRepos])

  useEffect(() => {
    if (!newIssueOpen) {
      return
    }
    if (
      isNewIssueDraftContentful({
        title: newIssueTitle,
        body: newIssueBody,
        labels: newIssueLabels,
        assignees: newIssueAssignees
      })
    ) {
      setNewIssueDraft({
        title: newIssueTitle,
        body: newIssueBody,
        labels: newIssueLabels,
        assignees: newIssueAssignees,
        repoId: newIssueRepoId
      })
    } else {
      clearNewIssueDraft()
    }
  }, [
    newIssueOpen,
    newIssueTitle,
    newIssueBody,
    newIssueLabels,
    newIssueAssignees,
    newIssueRepoId,
    setNewIssueDraft,
    clearNewIssueDraft
  ])

  return {
    newIssueOpen,
    setNewIssueOpen,
    newIssueTitle,
    setNewIssueTitle,
    newIssueBody,
    setNewIssueBody,
    newIssueLabels,
    setNewIssueLabels,
    newIssueAssignees,
    setNewIssueAssignees,
    newIssueSubmitting,
    setNewIssueSubmitting,
    newIssueRepoId,
    setNewIssueRepoId,
    setNewIssueDraft,
    clearNewIssueDraft,
    newIssueTargetRepo,
    newIssueSourceContext,
    newIssueRuntimeTarget,
    newIssueRepoLabels,
    newIssueRepoAssignees
  }
}
