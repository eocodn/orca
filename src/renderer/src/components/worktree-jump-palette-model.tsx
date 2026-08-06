import type React from 'react'
import { useAppStore } from '@/store'
import { getComposerEligibleRepos, resolveComposerGitRepoId } from '@/lib/new-workspace-composer-repo'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getPaletteHostBadge, type PaletteHostBadge } from '@/components/cmd-j/palette-host-badge'
import { CREATE_WORKTREE_ITEM_ID, CREATE_WORKSPACE_QUICK_ACTION_ID } from '@/components/cmd-j/quick-actions'
import type { SettingsNavTarget } from '@/lib/settings-navigation-types'
import type { MatchRange, PaletteSearchResult } from '@/lib/worktree-palette-search'
import type { BrowserPaletteSearchResult } from '@/lib/browser-palette-search'
import type { WorkspaceTabPaletteSearchResult } from '@/lib/workspace-tab-palette-search'
import type { CmdJActionResult, CmdJSettingsResult } from '@/components/cmd-j/palette-results'
import type { CmdJProjectSearchResult } from '@/components/cmd-j/palette-project-results'
import type { BrowserPage, BrowserWorkspace, Worktree } from '../../../shared/types'
import { translate } from '@/i18n/i18n'

export type WorktreePaletteItem = {
  id: string
  type: 'worktree'
  match: PaletteSearchResult
  worktree: Worktree
}

export type BrowserPaletteItem = {
  id: string
  type: 'browser-page'
  result: BrowserPaletteSearchResult
}

export type WorkspaceTabPaletteItem = {
  id: string
  type: 'workspace-tab'
  result: WorkspaceTabPaletteSearchResult
}

export type SettingsPaletteItem = {
  id: string
  type: 'settings'
  result: CmdJSettingsResult
}

export type QuickActionPaletteItem = {
  id: string
  type: 'quick-action'
  result: CmdJActionResult
}

export type ProjectTargetPaletteItem = {
  id: string
  type: 'project-target'
  result: CmdJProjectSearchResult
}

export type SectionHeader = {
  id: string
  type: 'section-header'
  label: string
}

export type HintRow = {
  id: string
  type: 'hint'
  label: string
}

export type CreateWorktreePaletteItem = {
  id: typeof CREATE_WORKTREE_ITEM_ID
  type: 'create-worktree'
}

// Why: keep quick actions curated — Cmd+J is a fast intent surface, not a dump of every setup button.
export type PaletteItem =
  | WorktreePaletteItem
  | ProjectTargetPaletteItem
  | SettingsPaletteItem
  | QuickActionPaletteItem
  | BrowserPaletteItem
  | WorkspaceTabPaletteItem

export type PaletteListEntry = PaletteItem | CreateWorktreePaletteItem | SectionHeader | HintRow

export const CREATE_WORKSPACE_QUICK_ACTION_ITEM_ID = `quick-action:${CREATE_WORKSPACE_QUICK_ACTION_ID}`

// Why: outlast the CommandDialog close animation (~150–200ms) so gated status maps stay live until fading rows are gone.
export const PALETTE_STATUS_INPUTS_LINGER_MS = 300

export function getComposerPrefetchRepoId(
  state: ReturnType<typeof useAppStore.getState>,
  initialRepoId?: string
): string | null {
  return resolveComposerGitRepoId({
    eligibleRepos: getComposerEligibleRepos(state.repos),
    initialRepoId,
    activeRepoId: state.activeRepoId,
    focusedHostScope: state.workspaceHostScope
  })
}

export function appendPaletteListEntries(
  target: PaletteListEntry[],
  source: readonly PaletteItem[]
): void {
  // Why: source can be large enough to hit the argument limit of push(...source).
  for (const entry of source) {
    target.push(entry)
  }
}

export type BrowserSelection = {
  worktree: Worktree
  workspace: BrowserWorkspace
  page: BrowserPage
}

export function HighlightedText({
  text,
  matchRange
}: {
  text: string
  matchRange: MatchRange | null
}): React.JSX.Element {
  if (!matchRange) {
    return <>{text}</>
  }
  const before = text.slice(0, matchRange.start)
  const match = text.slice(matchRange.start, matchRange.end)
  const after = text.slice(matchRange.end)
  return (
    <>
      {before}
      <span className="font-semibold text-foreground">{match}</span>
      {after}
    </>
  )
}

export function PaletteState({ title, subtitle }: { title: string; subtitle: string }): React.JSX.Element {
  return (
    <div className="px-5 py-8 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  )
}

export function FooterKey({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="rounded-full border border-border/60 bg-muted/35 px-2 py-0.5 text-[10px] font-medium text-foreground/85">
      {children}
    </span>
  )
}

export function PaletteHostBadgeChip({
  badge
}: {
  badge: PaletteHostBadge | null
}): React.JSX.Element | null {
  if (!badge) {
    return null
  }
  // Host labels come from the registry and are intentionally not translated.
  return (
    <span
      aria-label={translate(
        'auto.components.WorktreeJumpPalette.paletteHostBadge',
        'Host: {{value0}}',
        { value0: badge.label }
      )}
      className="max-w-[140px] truncate rounded-[6px] border border-border/60 bg-background/45 px-1.5 py-px text-[9px] font-medium leading-normal text-muted-foreground/88"
    >
      {badge.label}
    </span>
  )
}

export function findBrowserSelection(
  pageId: string,
  workspaceId: string,
  worktreeId: string
): BrowserSelection | null {
  const state = useAppStore.getState()
  const page = (state.browserPagesByWorkspace[workspaceId] ?? []).find((p) => p.id === pageId)
  if (!page) {
    return null
  }
  const workspace = (state.browserTabsByWorktree[worktreeId] ?? []).find(
    (w) => w.id === workspaceId
  )
  if (!workspace) {
    return null
  }
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  if (!worktree) {
    return null
  }
  return { page, workspace, worktree }
}

export function getSettingsTargetFromSectionId(sectionId: string): {
  pane: SettingsNavTarget
  repoId: string | null
  sectionId?: string
} {
  if (sectionId.startsWith('repo-')) {
    return { pane: 'repo', repoId: sectionId.slice('repo-'.length) }
  }
  return { pane: sectionId as SettingsNavTarget, repoId: null }
}
