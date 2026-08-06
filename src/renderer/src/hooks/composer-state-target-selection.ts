import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { getSelectedRepoSshGate } from '@/lib/new-workspace-ssh-gate'
import { isWorkspaceStatusId } from '../../../shared/workspace-statuses'
import {
  getComposerEligibleRepos,
  resolveComposerActiveRepoId
} from '@/lib/new-workspace-composer-repo'
import { resolveWorkspaceCreationRepoId } from '@/lib/project-host-workspace-target'
import {
  resolveInitialWorkspaceRunSeed,
  type UseComposerStateOptions
} from './composer-state-contracts'
import { useComposerFolderTargetSelection } from './composer-state-folder-target-selection'
import { useComposerRepositoryTargetOptions } from './composer-state-repository-target-options'
import type { ProjectGroup } from '../../../shared/types'

export function useComposerTargetState(options: UseComposerStateOptions) {
  const {
    initialRepoId,
    initialTaskSourceContext = null,
    initialWorkspaceStatus,
    persistDraft,
    repoIdOverride,
    onRepoIdOverrideChange,
    initialProjectGroupId
  } = options

  // Why: fold stable actions into one subscription so store mutations run one equality check.
  const actions = useAppStore(
    useShallow((s) => ({
      setNewWorkspaceDraft: s.setNewWorkspaceDraft,
      clearNewWorkspaceDraft: s.clearNewWorkspaceDraft,
      createWorktree: s.createWorktree,
      updateRepo: s.updateRepo,
      updateWorktreeMeta: s.updateWorktreeMeta,
      createFolderWorkspace: s.createFolderWorkspace,
      setSidebarOpen: s.setSidebarOpen,
      closeModal: s.closeModal,
      openSettingsPage: s.openSettingsPage,
      openSettingsTarget: s.openSettingsTarget,
      setActiveRuntimeEnvironmentPreference: s.setActiveRuntimeEnvironmentPreference,
      prefetchWorktreeCreateBase: s.prefetchWorktreeCreateBase,
      prefetchWorkItems: s.prefetchWorkItems,
      fetchSparsePresets: s.fetchSparsePresets
    }))
  )
  const repos = useAppStore((s) => s.repos)
  const projects = useAppStore((s) => s.projects)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const projectHostSetups = useAppStore((s) => s.projectHostSetups)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const settings = useAppStore((s) => s.settings)
  const newWorkspaceDraft = useAppStore((s) => s.newWorkspaceDraft)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const sparsePresetsByRepo = useAppStore((s) => s.sparsePresetsByRepo)
  const workspaceStatuses = useAppStore((s) => s.workspaceStatuses)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const sshConnectedGeneration = useAppStore((s) => s.sshConnectedGeneration)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  const workspaceHostScope = useAppStore((s) => s.workspaceHostScope)
  const eligibleRepos = useMemo(() => getComposerEligibleRepos(repos), [repos])
  // Why: a runtime-owned SSH repo (active right after creating a per-workspace-env) is ineligible; seed from its local same-project sibling, not another project.
  const seedActiveRepoId = useMemo(
    () => resolveComposerActiveRepoId(repos, eligibleRepos, activeRepoId),
    [repos, eligibleRepos, activeRepoId]
  )
  const draftRepoId = persistDraft ? (newWorkspaceDraft?.repoId ?? null) : null
  const draftProjectId = persistDraft ? (newWorkspaceDraft?.projectId ?? null) : null
  const draftProjectGroupId = persistDraft ? (newWorkspaceDraft?.projectGroupId ?? null) : null
  const draftHostId = persistDraft ? (newWorkspaceDraft?.hostId ?? null) : null
  const draftProjectHostSetupId = persistDraft
    ? (newWorkspaceDraft?.projectHostSetupId ?? null)
    : null
  // Why: Tasks can start from non-repo Linear/Jira contexts; seed from the logical project/source host so the modal doesn't fall back to the active repo.
  const initialRunSeed = resolveInitialWorkspaceRunSeed({
    draftProjectId,
    draftHostId,
    draftProjectHostSetupId,
    initialTaskSourceContext
  })
  const resolvedInitialWorkspaceStatus = useMemo(
    () =>
      initialWorkspaceStatus && isWorkspaceStatusId(initialWorkspaceStatus, workspaceStatuses)
        ? initialWorkspaceStatus
        : undefined,
    [initialWorkspaceStatus, workspaceStatuses]
  )

  const resolvedInitialRepoId = resolveWorkspaceCreationRepoId({
    eligibleRepos,
    projects,
    projectHostSetups,
    draftRepoId,
    initialRepoId,
    activeRepoId: seedActiveRepoId,
    projectId: initialRunSeed.projectId,
    hostId: initialRunSeed.hostId,
    projectHostSetupId: initialRunSeed.projectHostSetupId,
    focusedHostScope: workspaceHostScope
  })

  const [internalRepoId, setInternalRepoId] = useState<string>(resolvedInitialRepoId)
  const initialFolderProjectGroupId = initialProjectGroupId ?? draftProjectGroupId
  const initialFolderProjectGroup = projectGroups.find(
    (group) => group.id === initialFolderProjectGroupId && Boolean(group.parentPath?.trim())
  )
  const [selectedProjectGroupId, setSelectedProjectGroupId] = useState<string | null>(
    initialFolderProjectGroup?.id ?? null
  )
  const initialProjectGroupAppliedRef = useRef(Boolean(initialFolderProjectGroup))
  const [projectError, setProjectError] = useState<string | null>(null)
  const repoId = repoIdOverride ?? internalRepoId
  const setRepoId = onRepoIdOverrideChange ?? setInternalRepoId
  const selectedProjectGroup = useMemo<ProjectGroup | null>(
    () =>
      selectedProjectGroupId
        ? (projectGroups.find(
            (group) => group.id === selectedProjectGroupId && Boolean(group.parentPath?.trim())
          ) ?? null)
        : null,
    [projectGroups, selectedProjectGroupId]
  )
  useEffect(() => {
    if (selectedProjectGroupId && !selectedProjectGroup) {
      setSelectedProjectGroupId(null)
    }
  }, [selectedProjectGroup, selectedProjectGroupId])
  useEffect(() => {
    if (
      selectedProjectGroupId ||
      !initialFolderProjectGroupId ||
      initialProjectGroupAppliedRef.current
    ) {
      return
    }
    const nextGroup = projectGroups.find(
      (group) => group.id === initialFolderProjectGroupId && Boolean(group.parentPath?.trim())
    )
    if (nextGroup) {
      initialProjectGroupAppliedRef.current = true
      setSelectedProjectGroupId(nextGroup.id)
    }
  }, [initialFolderProjectGroupId, projectGroups, selectedProjectGroupId])
  const isProjectGroupTarget = selectedProjectGroup !== null
  const {
    folderSourceRepos,
    folderTargetRuntimeEnvironmentId,
    folderTargetConnectionId,
    folderTargetIsRemote,
    folderTargetSshStatus,
    folderTargetRequiresConnection,
    folderTargetConnectInProgress,
    folderPathStatusBlocksCreate,
    pathStatusProjectError,
    folderDetectedAgentIds
  } = useComposerFolderTargetSelection({
    repos,
    projectGroups,
    selectedProjectGroup,
    sshConnectionStates
  })
  const {
    selectedWorkspaceTarget,
    selectedRepo,
    selectedRepoIsGit,
    selectedRepoAgentLaunchPlatform,
    selectedRepoIsRemote,
    selectedRepoStartupShell,
    selectedRepoProjectId,
    selectedProjectId,
    selectedProjectHostSetupId,
    projectHostSetupOptions,
    projectOptions,
    selectedRepoSettings
  } = useComposerRepositoryTargetOptions({
    repos,
    projects,
    projectGroups,
    projectHostSetups,
    activeRepoId,
    settings,
    worktreesByRepo,
    sshConnectionStates,
    sshTargetLabels,
    runtimeEnvironments,
    runtimeStatusByEnvironmentId,
    eligibleRepos,
    selectedProjectGroup,
    repoId,
    workspaceHostScope
  })
  const selectedRepoConnectionId = selectedRepo?.connectionId ?? null
  const selectedRepoSshState = selectedRepoConnectionId
    ? (sshConnectionStates.get(selectedRepoConnectionId) ?? null)
    : null
  const { selectedRepoSshStatus, selectedRepoRequiresConnection, selectedRepoConnectInProgress } =
    getSelectedRepoSshGate({
      connectionId: selectedRepoConnectionId,
      status: selectedRepoSshState?.status ?? null
    })
  const repoIdRef = useRef(repoId)
  repoIdRef.current = repoId

  return {
    actions,
    repos,
    projects,
    projectGroups,
    projectHostSetups,
    activeRepoId,
    settings,
    newWorkspaceDraft,
    worktreesByRepo,
    sparsePresetsByRepo,
    workspaceStatuses,
    sshConnectionStates,
    sshTargetLabels,
    sshConnectedGeneration,
    runtimeEnvironments,
    runtimeStatusByEnvironmentId,
    workspaceHostScope,
    eligibleRepos,
    seedActiveRepoId,
    draftRepoId,
    draftProjectId,
    draftProjectGroupId,
    draftHostId,
    draftProjectHostSetupId,
    initialRunSeed,
    resolvedInitialWorkspaceStatus,
    initialProjectGroupAppliedRef,
    projectError,
    setProjectError,
    repoId,
    setRepoId,
    selectedProjectGroupId,
    setSelectedProjectGroupId,
    selectedProjectGroup,
    isProjectGroupTarget,
    folderSourceRepos,
    folderTargetRuntimeEnvironmentId,
    folderTargetConnectionId,
    folderTargetIsRemote,
    folderTargetSshStatus,
    folderTargetRequiresConnection,
    folderTargetConnectInProgress,
    folderPathStatusBlocksCreate,
    pathStatusProjectError,
    folderDetectedAgentIds,
    selectedWorkspaceTarget,
    selectedRepo,
    selectedRepoIsGit,
    selectedRepoAgentLaunchPlatform,
    selectedRepoIsRemote,
    selectedRepoStartupShell,
    selectedRepoProjectId,
    selectedProjectId,
    selectedProjectHostSetupId,
    projectHostSetupOptions,
    projectOptions,
    selectedRepoSettings,
    selectedRepoConnectionId,
    selectedRepoSshStatus,
    selectedRepoRequiresConnection,
    selectedRepoConnectInProgress,
    repoIdRef
  }
}
