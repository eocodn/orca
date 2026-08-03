import type {
  Project,
  ProjectUpdateArgs,
  ProjectHostSetup,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  Repo,
  ProjectGroup,
  FolderWorkspace
} from '../shared/types'
import {
  normalizeProjectRuntimePreference
} from '../shared/project-execution-runtime'


import {
  normalizeExecutionHostId
} from '../shared/execution-host'
import {
  createProjectGroup,
  getProjectGroupSubtreeIds,
  normalizeProjectGroupName
} from '../shared/project-groups'
import {
  folderWorkspaceKey
} from '../shared/workspace-scope'

import {
  removeWorkspaceSessionOwner
} from './persistence-state-phase-8'
import { makeProjectHostSetupId } from './persistence-state-ssh'
import { StorePhase2 } from './persistence-store-project-state'

export class StorePhase3 extends StorePhase2 {
  getRepos(): Repo[] {
    return this.state.repos.map((repo) => this.hydrateRepo(repo))
  }

  getProjects(): Project[] {
    return [...this.state.projects]
  }

  updateProject(id: string, updates: ProjectUpdateArgs['updates']): Project | null {
    const project = this.state.projects.find((entry) => entry.id === id)
    if (!project) {
      return null
    }
    if ('localWindowsRuntimePreference' in updates) {
      if (updates.localWindowsRuntimePreference === undefined) {
        delete project.localWindowsRuntimePreference
      } else {
        project.localWindowsRuntimePreference = normalizeProjectRuntimePreference(
          updates.localWindowsRuntimePreference
        )
      }
    }
    project.updatedAt = Date.now()
    this.scheduleSave()
    return { ...project }
  }

  getProjectHostSetups(): ProjectHostSetup[] {
    return [...this.state.projectHostSetups]
  }

  createProjectHostSetup(args: ProjectHostSetupCreateArgs): ProjectHostSetupCreateResult | null {
    const project = this.state.projects.find((entry) => entry.id === args.projectId)
    if (!project) {
      return null
    }
    const hostId = normalizeExecutionHostId(args.hostId)
    if (!hostId) {
      throw new Error(`Invalid host ID: ${args.hostId}`)
    }
    const duplicateSetup = this.state.projectHostSetups.find(
      (entry) => entry.projectId === project.id && entry.hostId === hostId
    )
    if (duplicateSetup) {
      throw new Error(`Project host setup already exists: ${duplicateSetup.id}`)
    }
    const now = Date.now()
    const existingIds = new Set(this.state.projectHostSetups.map((entry) => entry.id))
    const setup: ProjectHostSetup = {
      id: makeProjectHostSetupId(project.id, hostId, existingIds, args.setupId),
      projectId: project.id,
      hostId,
      repoId: '',
      path: args.path?.trim() ?? '',
      displayName: args.displayName?.trim() || project.displayName,
      ...(args.kind ? { kind: args.kind } : {}),
      ...(args.worktreeBasePath?.trim() ? { worktreeBasePath: args.worktreeBasePath.trim() } : {}),
      ...(args.gitUsername?.trim() ? { gitUsername: args.gitUsername.trim() } : {}),
      setupState: args.setupState ?? 'not-set-up',
      setupMethod: args.setupMethod ?? 'provisioned',
      createdAt: now,
      updatedAt: now
    }
    // Why: persist independently so future repo projection sync doesn't erase this non-repo-backed setup.
    this.state.projectHostSetups.push(setup)
    this.scheduleSave()
    return { project, setup }
  }

  updateProjectHostSetup(args: ProjectHostSetupUpdateArgs): ProjectHostSetupUpdateResult | null {
    const setup = this.state.projectHostSetups.find((entry) => entry.id === args.setupId)
    if (!setup) {
      return null
    }
    const project = this.state.projects.find((entry) => entry.id === setup.projectId)
    if (!project) {
      return null
    }
    const repo = setup.repoId
      ? this.state.repos.find((entry) => entry.id === setup.repoId)
      : undefined
    if (repo) {
      const updated = this.updateRepoBackedProjectHostSetup(setup, repo, args.updates)
      const updatedProject = updated
        ? this.state.projects.find((entry) => entry.id === updated.setup.projectId)
        : undefined
      return updated && updatedProject
        ? { project: updatedProject, setup: updated.setup, repo: updated.repo }
        : null
    }
    const updatedSetup = this.updateIndependentProjectHostSetup(setup, args.updates)
    return { project, setup: updatedSetup }
  }

  deleteProjectHostSetup(args: ProjectHostSetupDeleteArgs): ProjectHostSetupDeleteResult | null {
    const setup = this.state.projectHostSetups.find((entry) => entry.id === args.setupId)
    if (!setup) {
      return null
    }
    const project = this.state.projects.find((entry) => entry.id === setup.projectId)
    if (!project) {
      return null
    }
    const repo = setup.repoId
      ? this.state.repos.find((entry) => entry.id === setup.repoId)
      : undefined
    if (repo) {
      this.removeProject(repo.id)
      return { project, setup, repo: this.hydrateRepo(repo) }
    }
    this.state.projectHostSetups = this.state.projectHostSetups.filter(
      (entry) => entry.id !== setup.id
    )
    this.scheduleSave()
    return { project, setup }
  }

  /** O(1) repo count; unlike `getRepos()` this skips per-repo hydration. */
  getRepoCount(): number {
    return this.state.repos.length
  }

  getRepo(id: string): Repo | undefined {
    const repo = this.state.repos.find((r) => r.id === id)
    return repo ? this.hydrateRepo(repo) : undefined
  }

  /**
   * Record a background-resolved git username; kept out of updateRepo's whitelist so the renderer can't write it directly.
   * @returns true when the hydrated value changed.
   */
  setResolvedRepoGitUsername(id: string, username: string): boolean {
    const repo = this.state.repos.find((r) => r.id === id)
    if (!repo) {
      return false
    }
    const previous = this.gitUsernameCache.get(repo.path) ?? repo.gitUsername ?? ''
    this.gitUsernameCache.set(repo.path, username)
    if (previous === username) {
      return false
    }
    if (username) {
      // Why: persist so the next launch hydrates repos with the right branch prefix before enrichment re-runs.
      repo.gitUsername = username
    } else {
      delete repo.gitUsername
    }
    this.scheduleSave()
    return true
  }

  getProjectGroups(): ProjectGroup[] {
    return [...(this.state.projectGroups ?? [])].sort(
      (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
    )
  }

  createProjectGroup(input: {
    name: string
    parentPath?: string | null
    connectionId?: string | null
    parentGroupId?: string | null
    createdFrom: ProjectGroup['createdFrom']
  }): ProjectGroup {
    let maxOrder = -1
    // Why: persisted group lists can be large enough to exceed spread limits.
    for (const existingGroup of this.state.projectGroups ?? []) {
      maxOrder = Math.max(maxOrder, existingGroup.tabOrder)
    }
    const group = createProjectGroup({
      ...input,
      tabOrder: maxOrder + 1
    })
    this.state.projectGroups = [...(this.state.projectGroups ?? []), group]
    this.scheduleSave()
    return group
  }

  updateProjectGroup(
    groupId: string,
    updates: Partial<Pick<ProjectGroup, 'name' | 'isCollapsed' | 'tabOrder' | 'color'>>
  ): ProjectGroup | null {
    const group = (this.state.projectGroups ?? []).find((entry) => entry.id === groupId)
    if (!group) {
      return null
    }
    if (updates.name !== undefined) {
      group.name = normalizeProjectGroupName(updates.name, group.name)
    }
    if (updates.isCollapsed !== undefined) {
      group.isCollapsed = updates.isCollapsed
    }
    if (updates.tabOrder !== undefined && Number.isFinite(updates.tabOrder)) {
      group.tabOrder = updates.tabOrder
    }
    if (updates.color !== undefined) {
      group.color = typeof updates.color === 'string' ? updates.color : null
    }
    group.updatedAt = Date.now()
    this.scheduleSave()
    return group
  }

  deleteProjectGroup(groupId: string): boolean {
    const before = this.state.projectGroups?.length ?? 0
    const deletedGroupIds = getProjectGroupSubtreeIds(this.state.projectGroups ?? [], groupId)
    this.state.projectGroups = (this.state.projectGroups ?? []).filter(
      (group) => !deletedGroupIds.has(group.id)
    )
    if ((this.state.projectGroups?.length ?? 0) === before) {
      return false
    }
    // Why: groups are sidebar organization only, so deleting one ungroups its repos rather than deleting them.
    this.state.repos = this.state.repos.map((repo) =>
      repo.projectGroupId && deletedGroupIds.has(repo.projectGroupId)
        ? { ...repo, projectGroupId: null }
        : repo
    )
    const removedFolderWorkspaceKeys = new Set<string>()
    for (const workspace of this.state.folderWorkspaces ?? []) {
      if (deletedGroupIds.has(workspace.projectGroupId)) {
        removedFolderWorkspaceKeys.add(folderWorkspaceKey(workspace.id))
        this.state.workspaceSession = removeWorkspaceSessionOwner(
          this.state.workspaceSession,
          folderWorkspaceKey(workspace.id)
        )!
        this.removeWorkspaceLineageForFolderParent(workspace.id)
      }
    }
    this.state.folderWorkspaces = (this.state.folderWorkspaces ?? []).filter(
      (workspace) => !deletedGroupIds.has(workspace.projectGroupId)
    )
    this.pruneMobileClientTabSelections((worktreeId) => removedFolderWorkspaceKeys.has(worktreeId))
    this.scheduleSave()
    return true
  }

  getFolderWorkspaces(): FolderWorkspace[] {
    return [...(this.state.folderWorkspaces ?? [])].sort(
      (left, right) => right.sortOrder - left.sortOrder || left.name.localeCompare(right.name)
    )
  }

  getFolderWorkspace(id: string): FolderWorkspace | undefined {
    return (this.state.folderWorkspaces ?? []).find((workspace) => workspace.id === id)
  }

  getFolderWorkspaceByCreationOperationId(operationId: string): FolderWorkspace | undefined {
    return (this.state.folderWorkspaces ?? []).find(
      (workspace) => workspace.creationOperationId === operationId
    )
  }


}
