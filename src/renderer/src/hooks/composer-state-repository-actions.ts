import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getFolderSourceRepos } from '@/components/sidebar/folder-workspace-composer-helpers'
import { getProjectGroupIdFromNewWorkspaceOptionId } from '@/lib/new-workspace-project-options'
import {
  resolveWorkspaceCreationRepoId
} from '@/lib/project-host-workspace-target'
import { shouldPreserveWorkspaceSourceOnRepoChange } from '../../../shared/new-workspace/workspace-source'
import { getLinearLinkedWorkItemBranchName, isLinearLinkedWorkItem } from '@/lib/linear-linked-work-item'
import { resolveGitHubWorkItemIdentity } from '@/lib/github-work-item-identity'
import { getForkPushWarning } from './fork-push-warning'
import type { GitHubWorkItem, GitLabWorkItem, GitPushTarget, SparsePreset, TuiAgent } from '../../../shared/types'

export function useComposerRepositoryActions(context: any) {
  const {
    baseBranch,
    linkedWorkItem,
    repoId,
    setRepoId,
    folderSourceRepos,
    projectHostSetupOptions,
    projectGroups,
    repos,
    eligibleRepos,
    projectHostSetups,
    projects,
    selectedWorkspaceTarget,
    isProjectGroupTarget,
    workspaceHostScope,
    selectedProjectGroup,
    initialProjectGroupAppliedRef,
    setSelectedProjectGroupId,
    setProjectError,
    setLinkedIssue,
    setLinkedPR,
    setLinkedGitLabIssue,
    setLinkedGitLabMR,
    setLinkedWorkItem,
    setLinkedTaskSourceContext,
    setSparseEnabled,
    setSparseDirectories,
    setSparseSelectedPresetId,
    setBaseBranch,
    setCompareBaseRef,
    setPushTarget,
    setBranchNameOverride,
    setBranchNameOverridePreservesNameEdits,
    setReuseEligibleBranch,
    setReuseSelectedBranch,
    setForkPushWarning,
    setStartFromResetHint,
    smartGitHubPrStartPointSelectionRef,
    branchAutoNameRef,
    name,
    noteRef,
    lastAutoNoteRef,
    setNote,
    worktreesByRepo,
    setName,
    setCreateError,
    setTuiAgent,
    sparsePresets,
    setAdvancedOpen,
    selectedRepo
  } = context
  const handleRepoChange = useCallback(
    (
      value: string,
      options: { preserveStartFrom?: boolean; forceResetStartFrom?: boolean } = {}
    ): void => {
      setProjectError(null)
      if (value === repoId && !options.forceResetStartFrom) {
        setRepoId(value)
        return
      }
      // Why: capture a descriptor of the prior Start-from selection so the field can show an inline reset (e.g. "was PR #8778") after it's wiped.
      let hint: string | null = null
      if (!options.preserveStartFrom) {
        if (linkedWorkItem?.type === 'pr' && baseBranch) {
          hint = `was PR #${linkedWorkItem.number}`
        } else if (linkedWorkItem?.type === 'mr' && baseBranch) {
          // Why: GitLab MR convention is `!N`, not `#N` — match the upstream UI so the hint is recognizable.
          hint = `was MR !${linkedWorkItem.number}`
        } else if (baseBranch) {
          hint = `was ${baseBranch}`
        }
      }
      const preserveLinearLinkedWorkItem = isLinearLinkedWorkItem(linkedWorkItem)
      const preservedLinearBranchName = preserveLinearLinkedWorkItem
        ? getLinearLinkedWorkItemBranchName(linkedWorkItem)
        : undefined
      setRepoId(value)
      if (!options.preserveStartFrom) {
        smartGitHubPrStartPointSelectionRef.current = null
        setLinkedIssue('')
        setLinkedPR(null)
        setLinkedGitLabIssue(null)
        setLinkedGitLabMR(null)
        // Why: a repo change invalidates repo-scoped sources, but Linear and
        // Jira issues are workspace-scoped and must survive choosing the
        // implementation project — not just Linear.
        if (linkedWorkItem && !shouldPreserveWorkspaceSourceOnRepoChange(linkedWorkItem)) {
          setLinkedWorkItem(null)
          setLinkedTaskSourceContext(null)
        }
      }
      setSparseEnabled(false)
      setSparseDirectories('')
      // Why: presets are repo-scoped, so a prior-repo selection is meaningless after a switch.
      setSparseSelectedPresetId(null)
      // Why: Start-from is repo-scoped; reset to undefined so the field falls back to the new repo's effective base ref.
      if (!options.preserveStartFrom) {
        setBaseBranch(undefined)
        setCompareBaseRef(undefined)
        setPushTarget(undefined)
        // Why: Linear sources are workspace-scoped, so their canonical branch survives choosing a different implementation repo.
        setBranchNameOverride(preservedLinearBranchName)
        setBranchNameOverridePreservesNameEdits(Boolean(preservedLinearBranchName))
        branchAutoNameRef.current = preservedLinearBranchName ?? ''
        // Why (#5181): reuse state is branch-scoped, so a repo switch clears it even when a workspace-scoped Linear override is restored.
        setReuseEligibleBranch(null)
        setReuseSelectedBranch(false)
        setForkPushWarning(null)
        setStartFromResetHint(hint)
      }
    },
    [baseBranch, linkedWorkItem, repoId, setRepoId]
  )
  const handleFolderSourceRepoChange = useCallback(
    (value: string): void => {
      if (!folderSourceRepos.some((repo) => repo.id === value)) {
        return
      }
      setRepoId(value)
      smartGitHubPrStartPointSelectionRef.current = null
      setLinkedWorkItem((current) =>
        current && !shouldPreserveWorkspaceSourceOnRepoChange(current) ? null : current
      )
      if (linkedWorkItem && !shouldPreserveWorkspaceSourceOnRepoChange(linkedWorkItem)) {
        setLinkedTaskSourceContext(null)
      }
      setLinkedIssue('')
      setLinkedPR(null)
      setLinkedGitLabIssue(null)
      setLinkedGitLabMR(null)
    },
    [folderSourceRepos, linkedWorkItem, setRepoId]
  )
  const handleProjectHostSetupChange = useCallback(
    (setupId: string): void => {
      const option = projectHostSetupOptions.find((candidate) => candidate.id === setupId)
      if (!option || option.kind !== 'ready') {
        return
      }
      // Why: switching run host for the same project must not erase the task/PR source the user is starting from.
      handleRepoChange(option.repoId, { preserveStartFrom: true })
    },
    [handleRepoChange, projectHostSetupOptions]
  )
  const handleProjectChange = useCallback(
    (projectId: string): void => {
      initialProjectGroupAppliedRef.current = true
      const projectGroupId = getProjectGroupIdFromNewWorkspaceOptionId(projectId)
      if (projectGroupId) {
        const nextProjectGroup = projectGroups.find(
          (group) => group.id === projectGroupId && Boolean(group.parentPath?.trim())
        )
        if (!nextProjectGroup) {
          setSelectedProjectGroupId(null)
          setProjectError(
            translate(
              'auto.hooks.useComposerState.chooseOrAddProjectBeforeWorkspace',
              'Choose or add a project before creating a workspace.'
            )
          )
          return
        }
        const nextSourceRepo = getFolderSourceRepos(repos, projectGroups, nextProjectGroup)[0]
        setSelectedProjectGroupId(nextProjectGroup.id)
        setProjectError(null)
        setRepoId(nextSourceRepo?.id ?? '')
        setLinkedIssue('')
        setLinkedPR(null)
        setLinkedGitLabIssue(null)
        setLinkedGitLabMR(null)
        if (linkedWorkItem && !shouldPreserveWorkspaceSourceOnRepoChange(linkedWorkItem)) {
          setLinkedWorkItem(null)
          setLinkedTaskSourceContext(null)
        }
        setSparseEnabled(false)
        setSparseDirectories('')
        setSparseSelectedPresetId(null)
        setBaseBranch(undefined)
        setPushTarget(undefined)
        setBranchNameOverride(undefined)
        // Why (#5181): clear branch-scoped reuse state on a project switch too.
        setBranchNameOverridePreservesNameEdits(false)
        setReuseEligibleBranch(null)
        setReuseSelectedBranch(false)
        setForkPushWarning(null)
        setStartFromResetHint(null)
        return
      }

      setSelectedProjectGroupId(null)
      const preferredHostId =
        selectedWorkspaceTarget.status === 'ready' ? selectedWorkspaceTarget.target.hostId : null
      // Why: pass the current host as a preference (focusedHostScope), not a hard hostId — pinning made selecting a project set up only on another host a silent no-op.
      const nextRepoId = resolveWorkspaceCreationRepoId({
        eligibleRepos,
        projects,
        projectHostSetups,
        projectId,
        focusedHostScope: preferredHostId ?? workspaceHostScope
      })
      if (!nextRepoId) {
        return
      }
      handleRepoChange(nextRepoId, { forceResetStartFrom: isProjectGroupTarget })
    },
    [
      eligibleRepos,
      handleRepoChange,
      isProjectGroupTarget,
      linkedWorkItem,
      projectGroups,
      projectHostSetups,
      projects,
      repos,
      setRepoId,
      selectedWorkspaceTarget,
      workspaceHostScope
    ]
  )
  const selectAddedProjectRepo = useCallback(
    (nextRepoId: string): void => {
      // Why: clear the folder-group target when selecting the Add-Project repo, since the group's onRepoChange only accepts repos inside the group.
      initialProjectGroupAppliedRef.current = true
      setSelectedProjectGroupId(null)
      setProjectError(null)
      handleRepoChange(nextRepoId)
    },
    [handleRepoChange]
  )

  const showProjectRequiredError = useCallback((): void => {
    setProjectError('Choose or add a project before creating a workspace.')
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          '[data-contextual-tour-target="workspace-creation-project"] [data-project-combobox-root="true"][role="combobox"]'
        )
        ?.focus()
    })
  }, [])

  const handleSparseSelectPreset = useCallback((preset: SparsePreset | null): void => {
    if (preset) {
      setSparseEnabled(true)
      setSparseDirectories(preset.directories.join('\n'))
      setSparseSelectedPresetId(preset.id)
    } else {
      setSparseEnabled(false)
      setSparseDirectories('')
      setSparseSelectedPresetId(null)
    }
  }, [])

  const handleBaseBranchChange = useCallback((next: string | undefined): void => {
    smartGitHubPrStartPointSelectionRef.current = null
    setBaseBranch(next)
    setCompareBaseRef(undefined)
    setPushTarget(undefined)
    setBranchNameOverride(undefined)
    // Why (#5181): Start-from means "new branch from this base", so it never reuses — clear reuse state from a prior smart-field branch pick.
    setBranchNameOverridePreservesNameEdits(false)
    setReuseEligibleBranch(null)
    setReuseSelectedBranch(false)
    setForkPushWarning(null)
    branchAutoNameRef.current = ''
    setStartFromResetHint(null)
  }, [])

  const handleBaseBranchPrSelect = useCallback(
    (
      nextBaseBranch: string,
      item: GitHubWorkItem,
      nextPushTarget?: GitPushTarget,
      nextBranchNameOverride?: string,
      nextCompareBaseRef?: string
    ): void => {
      setBaseBranch(nextBaseBranch)
      setCompareBaseRef(nextCompareBaseRef)
      setPushTarget(nextPushTarget)
      setBranchNameOverride(nextBranchNameOverride)
      setBranchNameOverridePreservesNameEdits(Boolean(nextBranchNameOverride))
      branchAutoNameRef.current = ''
      setStartFromResetHint(null)
      // Why: a Start-from PR pick is also a linkedWorkItem assignment; reuse applyLinkedWorkItem so auto-name and linkedPR stay one code path.
      applyLinkedWorkItem(item, { preserveBranchNameOverride: Boolean(nextBranchNameOverride) })
      // Why: prefill the note from the PR (only when empty or still an auto-fill) so the sidebar surfaces it without clobbering user text.
      const identity = resolveGitHubWorkItemIdentity(item)
      if (identity.type === 'pr') {
        const suggestedNote = `PR #${identity.number} — ${item.title}`
        const currentNote = noteRef.current
        if (!currentNote.trim() || currentNote === lastAutoNoteRef.current) {
          setNote(suggestedNote)
          lastAutoNoteRef.current = suggestedNote
        }
      }
    },
    [applyLinkedWorkItem]
  )

  // Why: GitLab parallel of handleBaseBranchPrSelect; note prefill uses GitLab's `!N` MR convention so the sidebar makes the provider obvious.
  const handleBaseBranchMrSelect = useCallback(
    (
      nextBaseBranch: string,
      item: GitLabWorkItem,
      nextPushTarget?: GitPushTarget,
      nextCompareBaseRef?: string
    ): void => {
      setBaseBranch(nextBaseBranch)
      setCompareBaseRef(nextCompareBaseRef)
      setPushTarget(nextPushTarget)
      setBranchNameOverride(undefined)
      branchAutoNameRef.current = ''
      setStartFromResetHint(null)
      applyLinkedGitLabWorkItem(item)
      if (item.type === 'mr') {
        const suggestedNote = `MR !${item.number} — ${item.title}`
        const currentNote = noteRef.current
        if (!currentNote.trim() || currentNote === lastAutoNoteRef.current) {
          setNote(suggestedNote)
          lastAutoNoteRef.current = suggestedNote
        }
      }
    },
    [applyLinkedGitLabWorkItem]
  )

  return {
    handleRepoChange,
    handleFolderSourceRepoChange,
    handleProjectHostSetupChange,
    handleProjectChange,
    selectAddedProjectRepo,
    showProjectRequiredError,
    handleSparseSelectPreset,
    handleBaseBranchChange,
    handleBaseBranchPrSelect,
    handleBaseBranchMrSelect
  }
}
