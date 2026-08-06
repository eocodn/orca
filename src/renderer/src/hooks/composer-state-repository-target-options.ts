/* Repository target and host-option derivation for the new-workspace composer. */
import { useMemo } from 'react'
import type { useAppStore } from '@/store'
import { getAgentLaunchPlatformForRepo } from '@/lib/agent-launch-platform'
import { getLocalRepoProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { buildExecutionHostRegistry } from '../../../shared/execution-host-registry'
import { getHostDisplayLabelOverrides } from '../../../shared/host-setting-overrides'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { repoIsRemote } from '../../../shared/agent-launch-remote'
import { resolveLocalWindowsAgentStartupShell } from '../../../shared/windows-terminal-shell'
import { isGitRepoKind } from '../../../shared/repo-kind'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { resolveWorkspaceCreationTarget } from '@/lib/project-host-workspace-target'
import { buildProjectHostSetupOptions } from '@/lib/project-host-setup-options'
import { buildNewWorkspaceCreateTargetOptions } from '@/lib/new-workspace-project-options'
import type { ProjectGroup } from '../../../shared/types'

type RepositoryTargetOptionsInput = {
  repos: ReturnType<typeof useAppStore.getState>['repos']
  projects: ReturnType<typeof useAppStore.getState>['projects']
  projectGroups: ReturnType<typeof useAppStore.getState>['projectGroups']
  projectHostSetups: ReturnType<typeof useAppStore.getState>['projectHostSetups']
  activeRepoId: ReturnType<typeof useAppStore.getState>['activeRepoId']
  settings: ReturnType<typeof useAppStore.getState>['settings']
  worktreesByRepo: ReturnType<typeof useAppStore.getState>['worktreesByRepo']
  sshConnectionStates: ReturnType<typeof useAppStore.getState>['sshConnectionStates']
  sshTargetLabels: ReturnType<typeof useAppStore.getState>['sshTargetLabels']
  runtimeEnvironments: ReturnType<typeof useAppStore.getState>['runtimeEnvironments']
  runtimeStatusByEnvironmentId: ReturnType<
    typeof useAppStore.getState
  >['runtimeStatusByEnvironmentId']
  eligibleRepos: ReturnType<typeof useAppStore.getState>['repos']
  selectedProjectGroup: ProjectGroup | null
  repoId: string
  workspaceHostScope: ReturnType<typeof useAppStore.getState>['workspaceHostScope']
}

export function useComposerRepositoryTargetOptions({
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
}: RepositoryTargetOptionsInput) {
  const selectedWorkspaceTarget = useMemo(
    () =>
      resolveWorkspaceCreationTarget({
        eligibleRepos,
        projects,
        projectHostSetups,
        draftRepoId: repoId,
        focusedHostScope: workspaceHostScope
      }),
    [eligibleRepos, projectHostSetups, projects, repoId, workspaceHostScope]
  )
  const selectedRepo = eligibleRepos.find((repo) => repo.id === repoId)
  const selectedRepoIsGit = selectedRepo ? isGitRepoKind(selectedRepo) : false
  const selectedRepoAgentLaunchPlatform = useMemo(() => {
    if (!selectedRepo) {
      return CLIENT_PLATFORM
    }
    const projectRuntime = selectedRepo.connectionId
      ? undefined
      : getLocalRepoProjectExecutionRuntimeContext(
          { activeRepoId, activeWorktreeId: null, projects, repos, settings, worktreesByRepo },
          selectedRepo.id,
          CLIENT_PLATFORM
        )
    return getAgentLaunchPlatformForRepo(selectedRepo, projectRuntime)
  }, [activeRepoId, projects, repos, selectedRepo, settings, worktreesByRepo])
  // Why: SSH remotes deploy the CLI shim as plain `orca`, so the Linux-only `orca-ide` rename must not apply to remote launch commands.
  const selectedRepoIsRemote = selectedRepo ? repoIsRemote(selectedRepo) : false
  const selectedRepoStartupShell = resolveLocalWindowsAgentStartupShell({
    platform: selectedRepoAgentLaunchPlatform,
    isRemote: selectedRepoIsRemote,
    terminalWindowsShell: settings?.terminalWindowsShell
  })
  const selectedRepoProjectId =
    selectedWorkspaceTarget.status === 'ready' ? selectedWorkspaceTarget.target.projectId : null
  const selectedProjectId = selectedProjectGroup
    ? `project-group:${selectedProjectGroup.id}`
    : selectedRepoProjectId
  const selectedProjectHostSetupId =
    !selectedProjectGroup && selectedWorkspaceTarget.status === 'ready'
      ? selectedWorkspaceTarget.target.projectHostSetupId
      : null
  const hostOptions = useMemo(
    () =>
      buildExecutionHostRegistry({
        repos,
        settings,
        sshTargetLabels,
        sshConnectionStates,
        runtimeEnvironments,
        runtimeStatusByEnvironmentId,
        hostLabelOverrides: getHostDisplayLabelOverrides(settings)
      }),
    [
      repos,
      settings,
      sshConnectionStates,
      sshTargetLabels,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId
    ]
  )
  const projectHostSetupOptions = useMemo(
    () =>
      buildProjectHostSetupOptions({
        projectId: selectedRepoProjectId,
        projectHostSetups,
        eligibleRepos,
        hosts: hostOptions
      }),
    [eligibleRepos, hostOptions, projectHostSetups, selectedRepoProjectId]
  )
  const projectOptions = useMemo(
    () =>
      buildNewWorkspaceCreateTargetOptions({
        projects,
        projectHostSetups,
        eligibleRepos,
        projectGroups,
        hosts: hostOptions
      }),
    [eligibleRepos, hostOptions, projectGroups, projectHostSetups, projects]
  )
  const selectedRepoSettings = useMemo(() => {
    if (!settings) {
      return settings
    }
    // Why: probes and attachment uploads inspect the selected repo, even though creation defaults still follow host scope.
    return getSettingsForRepoRuntimeOwner(
      { repos: selectedRepo ? [selectedRepo] : [], settings },
      selectedRepo?.id ?? null
    )
  }, [selectedRepo, settings])

  return {
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
  }
}
