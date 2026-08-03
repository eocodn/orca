import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { buildTaskSourceContextFromRepo, type TaskSourceContext } from '../../../shared/task-source-context'
import { isGitRepoKind } from '../../../shared/repo-kind'
import type { GitHubWorkItem, GitPushTarget } from '../../../shared/types'
import { getLinkedWorkItemProvider, type LinkedWorkItemSummary } from '@/lib/new-workspace'
import { getSmartGitHubSubmitIntent, getSmartGitHubSubmitResolution, lookupSmartGitHubSubmitItem } from '@/lib/smart-github-submit'
import { lookupGitHubWorkItemByOwnerRepoForSource, lookupGitHubWorkItemForSource } from '@/lib/github-work-item-source-lookup'
import { resolveGitHubWorkItemIdentity } from '@/lib/github-work-item-identity'
import { resolveGitHubPrStartPointForRepo } from '@/lib/github-pr-start-point'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { getForkPushWarning } from './fork-push-warning'
import {
  getGitHubLinkedWorkItemIdentity,
  type PendingSmartGitHubSubmitResolution,
  type SmartGitHubPrStartPointSelection
} from './composer-state-contracts'
import type { useAppStore } from '@/store'

type Repo = ReturnType<typeof useAppStore.getState>['repos'][number]
type Settings = ReturnType<typeof useAppStore.getState>['settings']
type StateSetter<T> = Dispatch<SetStateAction<T>>

type PendingSmartGitHubSubmitContext = {
  folderSourceRepos: Repo[]
  isProjectGroupTarget: boolean
  linkedWorkItem: LinkedWorkItemSummary | null
  name: string
  selectedRepo: Repo | undefined
  selectedRepoGitHubSourceContext: TaskSourceContext | null
  selectedRepoIsGit: boolean
  settings: Settings
  smartGitHubPrStartPointSelectionRef: MutableRefObject<SmartGitHubPrStartPointSelection | null>
  lastAutoNameRef: MutableRefObject<string>
  branchAutoNameRef: MutableRefObject<string>
  setBaseBranch: StateSetter<string | undefined>
  setCompareBaseRef: StateSetter<string | undefined>
  setPushTarget: StateSetter<GitPushTarget | undefined>
  setBranchNameOverride: StateSetter<string | undefined>
  setBranchNameOverridePreservesNameEdits: StateSetter<boolean>
  setForkPushWarning: StateSetter<string | null>
  setLinkedIssue: StateSetter<string>
  setLinkedPR: StateSetter<number | null>
  setLinkedGitLabIssue: StateSetter<number | null>
  setLinkedGitLabMR: StateSetter<number | null>
  setLinkedWorkItem: StateSetter<LinkedWorkItemSummary | null>
  setLinkedTaskSourceContext: StateSetter<TaskSourceContext | null>
  setName: StateSetter<string>
  setStartFromResetHint: StateSetter<string | null>
}

export function usePendingSmartGitHubSubmitResolver({
  folderSourceRepos,
  isProjectGroupTarget,
  linkedWorkItem,
  name,
  selectedRepo,
  selectedRepoGitHubSourceContext,
  selectedRepoIsGit,
  settings,
  smartGitHubPrStartPointSelectionRef,
  lastAutoNameRef,
  branchAutoNameRef,
  setBaseBranch,
  setCompareBaseRef,
  setPushTarget,
  setBranchNameOverride,
  setBranchNameOverridePreservesNameEdits,
  setForkPushWarning,
  setLinkedIssue,
  setLinkedPR,
  setLinkedGitLabIssue,
  setLinkedGitLabMR,
  setLinkedWorkItem,
  setLinkedTaskSourceContext,
  setName,
  setStartFromResetHint
}: PendingSmartGitHubSubmitContext): () => Promise<PendingSmartGitHubSubmitResolution> {
  const resolvePendingSmartGitHubSubmit =
    useCallback(async (): Promise<PendingSmartGitHubSubmitResolution> => {
      if (linkedWorkItem) {
        const startPointSelection = smartGitHubPrStartPointSelectionRef.current
        const linkedWorkItemIdentity = getGitHubLinkedWorkItemIdentity(linkedWorkItem)
        const startPointIdentity = startPointSelection
          ? resolveGitHubWorkItemIdentity(startPointSelection.item)
          : null
        if (
          !isProjectGroupTarget &&
          linkedWorkItemIdentity?.type === 'pr' &&
          startPointIdentity?.type === 'pr' &&
          getLinkedWorkItemProvider(linkedWorkItem) === 'github' &&
          selectedRepo &&
          selectedRepoIsGit &&
          startPointSelection?.repoId === selectedRepo.id &&
          startPointIdentity.number === linkedWorkItemIdentity.number
        ) {
          const selectedPrStartPoint =
            startPointSelection.resolved ??
            (await resolveGitHubPrStartPointForRepo({
              repoId: selectedRepo.id,
              prNumber: startPointIdentity.number,
              settings: getSettingsForRepoRuntimeOwner(
                { repos: [selectedRepo], settings },
                selectedRepo.id
              ),
              ...(startPointSelection.item.branchName
                ? { headRefName: startPointSelection.item.branchName }
                : {}),
              ...(startPointSelection.item.baseRefName
                ? { baseRefName: startPointSelection.item.baseRefName }
                : {}),
              ...(startPointSelection.item.isCrossRepository !== undefined
                ? { isCrossRepository: startPointSelection.item.isCrossRepository }
                : {})
            }))
          startPointSelection.resolved = selectedPrStartPoint
          const smartGitHubMetadata = getSmartGitHubSubmitResolution(startPointSelection.item)
          const resolution: Exclude<PendingSmartGitHubSubmitResolution, { kind: 'none' }> = {
            ...smartGitHubMetadata,
            kind: 'pr-start-point',
            baseBranch: selectedPrStartPoint.baseBranch,
            ...(selectedPrStartPoint.compareBaseRef
              ? { compareBaseRef: selectedPrStartPoint.compareBaseRef }
              : {}),
            ...(selectedPrStartPoint.pushTarget
              ? { pushTarget: selectedPrStartPoint.pushTarget }
              : {}),
            ...(selectedPrStartPoint.branchNameOverride
              ? { branchNameOverride: selectedPrStartPoint.branchNameOverride }
              : {})
          }
          setBaseBranch(selectedPrStartPoint.baseBranch)
          setCompareBaseRef(selectedPrStartPoint.compareBaseRef)
          setPushTarget(selectedPrStartPoint.pushTarget)
          if (selectedPrStartPoint.branchNameOverride) {
            setBranchNameOverride(selectedPrStartPoint.branchNameOverride)
            setBranchNameOverridePreservesNameEdits(true)
          } else {
            setBranchNameOverride(undefined)
            setBranchNameOverridePreservesNameEdits(false)
          }
          setForkPushWarning(getForkPushWarning(selectedPrStartPoint))
          return resolution
        }
        return { kind: 'none' }
      }

      const intent = getSmartGitHubSubmitIntent(name)
      if (!intent) {
        return { kind: 'none' }
      }

      const item = isProjectGroupTarget
        ? (
            await Promise.all(
              folderSourceRepos.filter(isGitRepoKind).map((repo) =>
                lookupSmartGitHubSubmitItem({
                  repoPath: repo.path,
                  repoId: repo.id,
                  sourceContext: buildTaskSourceContextFromRepo({
                    provider: 'github',
                    projectId: repo.id,
                    repo
                  }),
                  intent,
                  workItem: lookupGitHubWorkItemForSource,
                  workItemByOwnerRepo: lookupGitHubWorkItemByOwnerRepoForSource
                }).catch(() => null)
              )
            )
          )
            .filter((candidate): candidate is GitHubWorkItem => candidate !== null)
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
        : selectedRepo && selectedRepoIsGit
          ? await lookupSmartGitHubSubmitItem({
              repoPath: selectedRepo.path,
              repoId: selectedRepo.id,
              sourceContext: selectedRepoGitHubSourceContext,
              intent,
              workItem: lookupGitHubWorkItemForSource,
              workItemByOwnerRepo: lookupGitHubWorkItemByOwnerRepoForSource
            })
          : null
      if (!item) {
        throw new Error('Could not resolve the GitHub item before creating the workspace.')
      }

      const itemIdentity = resolveGitHubWorkItemIdentity(item)
      const prStartPoint =
        !isProjectGroupTarget && itemIdentity.type === 'pr' && selectedRepo && selectedRepoIsGit
          ? await resolveGitHubPrStartPointForRepo({
              repoId: selectedRepo.id,
              prNumber: itemIdentity.number,
              settings: getSettingsForRepoRuntimeOwner(
                { repos: [selectedRepo], settings },
                selectedRepo.id
              ),
              ...(item.branchName ? { headRefName: item.branchName } : {}),
              ...(item.baseRefName ? { baseRefName: item.baseRefName } : {}),
              ...(item.isCrossRepository !== undefined
                ? { isCrossRepository: item.isCrossRepository }
                : {})
            })
          : null
      const smartGitHubMetadata = getSmartGitHubSubmitResolution(item)
      const resolution: Exclude<PendingSmartGitHubSubmitResolution, { kind: 'none' }> = prStartPoint
        ? {
            ...smartGitHubMetadata,
            kind: 'pr-start-point',
            baseBranch: prStartPoint.baseBranch,
            ...(prStartPoint.compareBaseRef ? { compareBaseRef: prStartPoint.compareBaseRef } : {}),
            ...(prStartPoint.pushTarget ? { pushTarget: prStartPoint.pushTarget } : {}),
            ...(prStartPoint.branchNameOverride
              ? { branchNameOverride: prStartPoint.branchNameOverride }
              : {})
          }
        : {
            ...smartGitHubMetadata,
            kind: 'metadata-only'
          }
      // Why: Create can fire before the debounced smart field commits; commit the resolved item here so the form shows the title, not the raw URL.
      setLinkedIssue(
        resolution.linkedIssueNumber !== null ? String(resolution.linkedIssueNumber) : ''
      )
      setLinkedPR(resolution.linkedPR)
      setLinkedGitLabIssue(null)
      setLinkedGitLabMR(null)
      setLinkedWorkItem(resolution.linkedWorkItem)
      setLinkedTaskSourceContext(selectedRepoGitHubSourceContext)
      setName(resolution.workspaceName)
      lastAutoNameRef.current = resolution.workspaceName
      if (prStartPoint) {
        setBaseBranch(prStartPoint.baseBranch)
        setCompareBaseRef(prStartPoint.compareBaseRef)
        setPushTarget(prStartPoint.pushTarget)
        if (prStartPoint.branchNameOverride) {
          setBranchNameOverride(prStartPoint.branchNameOverride)
          setBranchNameOverridePreservesNameEdits(true)
        } else {
          setBranchNameOverride(undefined)
          setBranchNameOverridePreservesNameEdits(false)
        }
        setForkPushWarning(getForkPushWarning(prStartPoint))
      } else {
        setBranchNameOverride(undefined)
        setBranchNameOverridePreservesNameEdits(false)
      }
      branchAutoNameRef.current = ''
      setStartFromResetHint(null)
      return resolution
    }, [
      folderSourceRepos,
      isProjectGroupTarget,
      linkedWorkItem,
      name,
      selectedRepo,
      selectedRepoGitHubSourceContext,
      selectedRepoIsGit,
      settings
    ])

  return resolvePendingSmartGitHubSubmit
}
