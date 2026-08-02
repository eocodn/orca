import React from 'react'
import { reuseArrayIfEqual } from './worktree-agent-row-selectors'
import type { RenderRow } from './worktree-list-virtual-rows'
import type { HostSectionRow } from './host-section-rows'
import type { ProjectGroupingModel } from './worktree-list-groups'
import type { ProjectGroup, Repo } from '../../../../shared/types'
import { isRepoHeaderActionTarget } from './project-header-drag'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { getProjectGroupHeaderKey } from './worktree-list-groups'
import { revealElementInScrollContainer } from './worktree-sidebar-reveal'

const recordKeyCountCache = new WeakMap<Record<string, unknown>, number>()

export function countRecordKeysByReference(record: Record<string, unknown>): number {
  const cached = recordKeyCountCache.get(record)
  if (cached !== undefined) {
    return cached
  }
  const count = Object.keys(record).length
  recordKeyCountCache.set(record, count)
  return count
}

export function shouldAdjustWorktreeSidebarMeasuredRowScroll(args: {
  isScrolling: boolean
  now: number
  suppressUntil: number
}): boolean {
  return !args.isScrolling && args.now >= args.suppressUntil
}

export function resolvePendingSidebarReveal(args: {
  targetIndex: number
  targetWorktreeStillExists: boolean
}): 'scroll-and-clear' | 'clear' | 'keep-pending' {
  if (args.targetIndex !== -1) {
    return 'scroll-and-clear'
  }
  return args.targetWorktreeStillExists ? 'keep-pending' : 'clear'
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  // xterm's hidden input textarea isn't a real text field; treating it as one would block sidebar shortcuts.
  if (target.classList.contains('xterm-helper-textarea')) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  return (
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !==
    null
  )
}

export function stopRepoHeaderKeyboardToggle(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.stopPropagation()
  }
}

export function stopNestedWorktreeCardBubble(event: React.SyntheticEvent<HTMLElement>): void {
  event.stopPropagation()
}

export function handleRepoHeaderActionPointerDown(event: React.PointerEvent<HTMLElement>): void {
  event.stopPropagation()
}

export function handleRepoHeaderCollapseAffordancePointerDown(
  event: React.PointerEvent<HTMLElement>
): void {
  // Why: keep collapse-chevron clicks from arming the repo-header row drag.
  event.stopPropagation()
}

export function stopRepoHeaderMenuEvent(event: React.SyntheticEvent<HTMLElement>): void {
  event.stopPropagation()
}

export function shouldIgnoreRepoHeaderToggle(event: React.SyntheticEvent<HTMLElement>): boolean {
  return isRepoHeaderActionTarget(event.target, event.currentTarget)
}

export function getWorktreeOptionId(rowKey: string): string {
  return `worktree-list-option-${encodeURIComponent(rowKey)}`
}

function getMountedWorktreeOptions(worktreeId: string, root?: ParentNode | null): HTMLElement[] {
  const scope = root ?? document
  const result: HTMLElement[] = []
  scope.querySelectorAll<HTMLElement>('[data-worktree-id]').forEach((element) => {
    if (element.dataset.worktreeId === worktreeId) {
      result.push(element)
    }
  })
  return result
}

export function markSidebarWorktreeActiveImmediately(worktreeId: string, primaryRowKey?: string): void {
  const sidebar = document.querySelector<HTMLElement>('[data-worktree-sidebar]')
  const nextOptions = getMountedWorktreeOptions(worktreeId, sidebar)
  const nextOption = nextOptions[0]
  if (!nextOption) {
    return
  }

  sidebar
    ?.querySelectorAll<HTMLElement>('[role="option"][aria-current="page"]')
    .forEach((option) => option.removeAttribute('aria-current'))

  for (const option of nextOptions) {
    option.setAttribute('aria-current', 'page')
  }
  sidebar
    ?.querySelectorAll<HTMLElement>('[data-worktree-card-surface][data-worktree-card-active]')
    .forEach((surface) => {
      if (!nextOptions.some((option) => option.contains(surface))) {
        surface.removeAttribute('data-worktree-card-active')
      }
    })
  for (const option of nextOptions) {
    const activeSurfaceVariant =
      primaryRowKey !== undefined
        ? option.dataset.worktreeRowKey === primaryRowKey
          ? 'primary'
          : 'secondary'
        : option === nextOption
          ? 'primary'
          : 'secondary'
    const surface = option.matches('[data-worktree-card-surface]')
      ? option
      : option.querySelector<HTMLElement>('[data-worktree-card-surface]')
    surface?.setAttribute('data-worktree-card-active', activeSurfaceVariant)
  }
}

export function revealMountedWorktreeElement(
  container: HTMLElement,
  worktreeId: string,
  behavior: ScrollBehavior,
  optionId?: string
): HTMLElement | null {
  const element = optionId
    ? document.getElementById(optionId)
    : getMountedWorktreeOptions(worktreeId, container)[0]
  if (!element || !container.contains(element)) {
    return null
  }
  return revealElementInScrollContainer(container, element, behavior) ? element : null
}

export function revealMountedSidebarRowElement(
  container: HTMLElement,
  rowKey: string,
  behavior: ScrollBehavior
): HTMLElement | null {
  const element = document.getElementById(getWorktreeOptionId(rowKey))
  if (!element || !container.contains(element)) {
    return null
  }
  return revealElementInScrollContainer(container, element, behavior) ? element : null
}

export function getRenderRowSidebarKey(row: RenderRow): string | null {
  if (row.type === 'header') {
    return row.key
  }
  if (row.type === 'item') {
    return row.rowKey
  }
  if (row.type === 'folder-workspace') {
    return folderWorkspaceKey(row.folderWorkspace.id)
  }
  if (row.type === 'pending-creation') {
    return `pending:${row.creationId}`
  }
  if (row.type === 'imported-worktrees-card') {
    return row.key
  }
  if (row.type === 'new-external-worktrees-inbox') {
    return row.key
  }
  return null
}

export function rowKeyMatchesRenderRow(row: RenderRow, rowKey: string): boolean {
  if (row.type === 'lineage-group') {
    return row.rows.some((item) => item.rowKey === rowKey)
  }
  return getRenderRowSidebarKey(row) === rowKey
}

function getProjectIdFromHeaderRowKey(rowKey: string): string | null {
  if (!rowKey.startsWith('project:')) {
    return null
  }
  const withoutPrefix = rowKey.slice('project:'.length)
  const setupSeparator = withoutPrefix.indexOf('::setup:')
  return setupSeparator === -1 ? withoutPrefix : withoutPrefix.slice(0, setupSeparator)
}

function getRepoIdsFromHeaderRowKey(
  rowKey: string,
  repoMap: Map<string, Repo>,
  projectGrouping?: ProjectGroupingModel
): string[] {
  if (rowKey.startsWith('repo:')) {
    return [rowKey.slice('repo:'.length)]
  }
  const setupMarker = '::setup:'
  const setupIndex = rowKey.indexOf(setupMarker)
  if (rowKey.startsWith('project:') && setupIndex !== -1) {
    return [rowKey.slice(setupIndex + setupMarker.length)]
  }
  const projectId = getProjectIdFromHeaderRowKey(rowKey)
  if (!projectId) {
    return []
  }
  const repoIds = new Set<string>()
  for (const setup of projectGrouping?.projectHostSetups ?? []) {
    if (setup.projectId === projectId && repoMap.has(setup.repoId)) {
      repoIds.add(setup.repoId)
    }
  }
  const project = projectGrouping?.projects.find((candidate) => candidate.id === projectId)
  for (const repoId of project?.sourceRepoIds ?? []) {
    if (repoMap.has(repoId)) {
      repoIds.add(repoId)
    }
  }
  return [...repoIds]
}

function getProjectGroupAncestorKeys(
  projectGroupId: string | null | undefined,
  projectGroups: readonly ProjectGroup[]
): string[] {
  const groupsById = new Map(projectGroups.map((group) => [group.id, group]))
  const keys: string[] = []
  const seen = new Set<string>()
  let currentGroupId = projectGroupId ?? null
  while (currentGroupId && !seen.has(currentGroupId)) {
    const group = groupsById.get(currentGroupId)
    if (!group) {
      break
    }
    seen.add(currentGroupId)
    keys.unshift(getProjectGroupHeaderKey(group.id))
    currentGroupId = group.parentGroupId
  }
  return keys
}

export function getSidebarRowRevealAncestorKeys(args: {
  rowKey: string
  repoMap: Map<string, Repo>
  projectGroups: readonly ProjectGroup[]
  projectGrouping?: ProjectGroupingModel
}): string[] {
  if (args.rowKey.startsWith('project-group:')) {
    const groupId = args.rowKey.slice('project-group:'.length)
    const group = args.projectGroups.find((candidate) => candidate.id === groupId)
    return getProjectGroupAncestorKeys(group?.parentGroupId, args.projectGroups)
  }
  const keys = new Set<string>()
  for (const repoId of getRepoIdsFromHeaderRowKey(
    args.rowKey,
    args.repoMap,
    args.projectGrouping
  )) {
    const repo = args.repoMap.get(repoId)
    for (const key of getProjectGroupAncestorKeys(repo?.projectGroupId, args.projectGroups)) {
      keys.add(key)
    }
  }
  return [...keys]
}
