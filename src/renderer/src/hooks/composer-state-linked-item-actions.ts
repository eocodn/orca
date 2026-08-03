import { useCallback } from 'react'
import {
  getLinkedWorkItemSuggestedName,
  getLinkedWorkItemWorkspaceName,
  type LinkedWorkItemSummary
} from '@/lib/new-workspace'
import { isLinearLinkedWorkItem, getLinearLinkedWorkItemBranchName } from '@/lib/linear-linked-work-item'
import { shouldApplyWorkspaceSourceAutoName, shouldPreserveWorkspaceSourceOnRepoChange } from '../../../shared/new-workspace/workspace-source'
import { resolveComposerManualBranchNameChange } from './composer-branch-selection'
import { usePendingSmartGitHubSubmitResolver } from './composer-state-pending-github-submit'
import type { GitHubWorkItem, GitHubRepositoryIdentity, GitLabWorkItem, GitPushTarget, TuiAgent } from '../../../shared/types'
import type { SmartGitHubPrStartPointSelection } from './composer-state-contracts'

export function useComposerLinkedItemActions(context: any) {
  const {
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
    setStartFromResetHint,
    setLinkPopoverOpen,
    setLinkQuery,
    setLinkDebouncedQuery,
    setLinkDirectItem,
    setCreateError,
    branchNameOverride,
    pushTarget,
    forkPushWarning,
    setReuseEligibleBranch,
    setReuseSelectedBranch
  } = context
  const applyLinkedWorkItem = useCallback(
    (item: GitHubWorkItem, options: { preserveBranchNameOverride?: boolean } = {}): void => {
      const identity = resolveGitHubWorkItemIdentity(item)
      const normalizedItem: GitHubWorkItem = {
        ...item,
        type: identity.type,
        number: identity.number
      }
      if (identity.type === 'issue') {
        setLinkedIssue(String(identity.number))
        setLinkedPR(null)
      } else {
        setLinkedIssue('')
        setLinkedPR(identity.number)
      }
      setLinkedGitLabIssue(null)
      setLinkedGitLabMR(null)
      setLinkedWorkItem({
        type: identity.type,
        provider: 'github',
        number: identity.number,
        title: item.title,
        url: item.url
      })
      setLinkedTaskSourceContext(selectedRepoGitHubSourceContext)
      const suggestedName =
        getLinkedWorkItemWorkspaceName(normalizedItem)?.seedName ??
        getLinkedWorkItemSuggestedName(normalizedItem)
      // Why: a pasted URL/#123 is the lookup query, not a chosen name — replace with the title-derived name or it becomes a slugified-URL workspace name.
      if (
        suggestedName &&
        shouldApplyWorkspaceSourceAutoName({
          currentName: name,
          lastAutoName: lastAutoNameRef.current
        })
      ) {
        setName(suggestedName)
        lastAutoNameRef.current = suggestedName
      }
      if (!options.preserveBranchNameOverride) {
        setBranchNameOverride(undefined)
        setBranchNameOverridePreservesNameEdits(false)
        branchAutoNameRef.current = ''
      }
    },
    [name, selectedRepoGitHubSourceContext]
  )

  const resolvePendingSmartGitHubSubmit = usePendingSmartGitHubSubmitResolver({
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
  })

  const applyLinkedGitLabWorkItem = useCallback(
    (item: GitLabWorkItem): void => {
      smartGitHubPrStartPointSelectionRef.current = null
      if (item.type === 'issue') {
        setLinkedGitLabIssue(item.number)
        setLinkedGitLabMR(null)
      } else {
        setLinkedGitLabIssue(null)
        setLinkedGitLabMR(item.number)
      }
      setLinkedIssue('')
      setLinkedPR(null)
      setLinkedTaskSourceContext(null)
      setLinkedWorkItem({
        type: item.type,
        provider: 'gitlab',
        number: item.number,
        title: item.title,
        url: item.url
      })
      // Why: GitLabWorkItem.branchName lines up structurally with GitHubWorkItem's; cast to reuse the naming heuristic without forking it.
      const suggestedName = getLinkedWorkItemSuggestedName({
        type: item.type === 'mr' ? 'pr' : 'issue',
        number: item.number,
        title: item.title,
        branchName: item.branchName
      } as unknown as GitHubWorkItem)
      const titleName = getLinkedWorkItemWorkspaceName({
        type: item.type,
        provider: 'gitlab',
        number: item.number,
        title: item.title
      })
      const nextName = titleName?.seedName ?? suggestedName
      if (
        nextName &&
        shouldApplyWorkspaceSourceAutoName({
          currentName: name,
          lastAutoName: lastAutoNameRef.current
        })
      ) {
        setName(nextName)
        lastAutoNameRef.current = nextName
      }
      setBranchNameOverride(undefined)
      setBranchNameOverridePreservesNameEdits(false)
      branchAutoNameRef.current = ''
    },
    [name]
  )

  const handleSelectLinkedItem = useCallback(
    (item: GitHubWorkItem): void => {
      smartGitHubPrStartPointSelectionRef.current = null
      applyLinkedWorkItem(item)
      setLinkPopoverOpen(false)
      setLinkQuery('')
      setLinkDebouncedQuery('')
      setLinkDirectItem(null)
    },
    [applyLinkedWorkItem]
  )

  const handleLinkPopoverChange = useCallback((open: boolean): void => {
    setLinkPopoverOpen(open)
    if (!open) {
      setLinkQuery('')
      setLinkDebouncedQuery('')
      setLinkDirectItem(null)
    }
  }, [])

  const handleRemoveLinkedWorkItem = useCallback((): void => {
    smartGitHubPrStartPointSelectionRef.current = null
    const removedLinearItem = isLinearLinkedWorkItem(linkedWorkItem)
    setLinkedWorkItem(null)
    setLinkedTaskSourceContext(null)
    setLinkedIssue('')
    setLinkedPR(null)
    setForkPushWarning(null)
    if (name === lastAutoNameRef.current) {
      lastAutoNameRef.current = ''
    }
    if (removedLinearItem) {
      // Why: a Linear branch override belongs to its issue; unlinking must not leave it driving a later worktree create.
      setBranchNameOverride(undefined)
      setBranchNameOverridePreservesNameEdits(false)
      branchAutoNameRef.current = ''
    }
  }, [linkedWorkItem, name])

  const handleNameValueChange = useCallback(
    (nextName: string): void => {
      // Why: linked items keep refreshing the suggested name only while it's auto-managed; a manual edit stops later picks from clobbering it until cleared.
      if (!nextName.trim()) {
        lastAutoNameRef.current = ''
      } else if (name !== lastAutoNameRef.current) {
        lastAutoNameRef.current = ''
      }
      if (
        branchNameOverride &&
        !branchNameOverridePreservesNameEdits &&
        nextName !== branchAutoNameRef.current
      ) {
        setBranchNameOverride(undefined)
        branchAutoNameRef.current = ''
      }
      setName(nextName)
      setCreateError(null)
    },
    [branchNameOverride, branchNameOverridePreservesNameEdits, name]
  )
  const handleBranchNameOverrideChange = useCallback(
    (value: string | undefined): void => {
      const next = resolveComposerManualBranchNameChange({
        value,
        pushTarget,
        forkPushWarning
      })
      setBranchNameOverride(next.branchNameOverride)
      setBranchNameOverridePreservesNameEdits(Boolean(next.branchNameOverride))
      setPushTarget(next.pushTarget)
      setForkPushWarning(next.forkPushWarning)
      setReuseEligibleBranch(null)
      setReuseSelectedBranch(false)
      branchAutoNameRef.current = ''
    },
    [forkPushWarning, pushTarget]
  )

  return {
    applyLinkedWorkItem,
    resolvePendingSmartGitHubSubmit,
    applyLinkedGitLabWorkItem,
    handleSelectLinkedItem,
    handleLinkPopoverChange,
    handleRemoveLinkedWorkItem,
    handleNameValueChange,
    handleBranchNameOverrideChange
  }
}
