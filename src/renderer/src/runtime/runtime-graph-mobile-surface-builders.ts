import { getSystemPrefersDark, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import { sanitizeTerminalLayoutPaneTitles } from '@/lib/terminal-pane-title-sanitization'
import {
  collectLeafIdsInOrder,
  normalizeTerminalLayoutSnapshot,
  serializePaneTree
} from '@/components/terminal-pane/layout-serialization'
import { isClaudeManagementTitle } from '../../../shared/agent-detection'
import { isTerminalLeafId, makePaneKey } from '../../../shared/stable-pane-id'
import type {
  RuntimeMobileSessionBrowserTab,
  RuntimeMobileSessionFileTab,
  RuntimeMobileSessionMarkdownTab,
  RuntimeMobileSessionSnapshotTab,
  RuntimeMobileTerminalTheme
} from '../../../shared/runtime-types'
import type { AppState } from '../store/types'
import type { Tab } from '../../../shared/types'
import { registeredTabs, type OpenFileByWorktreeAndId } from './runtime-graph-sync'
import { resolveRuntimeTerminalTitle } from './runtime-graph-mobile-projections'
import { resolveTerminalLayoutRoot } from './remote-terminal-layout-resolution'

export function mobileTerminalSurfaceId(parentTabId: string, leafId: string): string {
  return `${parentTabId}::${leafId}`
}

function hexToRgba(hex: string, alpha: number): string {
  let clean = hex.replace('#', '')
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function isHexColor(value: string | undefined): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}

export function resolveMobileTerminalTheme(
  state: AppState,
  systemPrefersDark: boolean
): RuntimeMobileTerminalTheme | undefined {
  const settings = state.settings
  if (!settings) {
    return undefined
  }
  const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
  const resolvedTheme = appearance.theme
    ? { ...appearance.theme, ...settings.terminalColorOverrides }
    : undefined
  if (!resolvedTheme) {
    return undefined
  }
  if (settings.terminalBackgroundOpacity !== undefined && isHexColor(resolvedTheme.background)) {
    resolvedTheme.background = hexToRgba(
      resolvedTheme.background,
      settings.terminalBackgroundOpacity
    )
  }
  if (settings.terminalCursorOpacity !== undefined && isHexColor(resolvedTheme.cursor)) {
    resolvedTheme.cursor = hexToRgba(resolvedTheme.cursor, settings.terminalCursorOpacity)
  }

  const theme: Record<string, string> = {}
  for (const [key, value] of Object.entries(resolvedTheme)) {
    if (typeof value === 'string') {
      theme[key] = value
    }
  }
  return { mode: appearance.mode, theme: theme as RuntimeMobileTerminalTheme['theme'] }
}

function getRuntimeLeafIdsForTerminal(tabId: string, state: AppState): string[] {
  const registered = registeredTabs.get(tabId)
  const manager = registered?.getManager()
  const liveLeafIds = manager?.getPanes().map((pane) => pane.leafId) ?? []
  if (liveLeafIds.length > 0) {
    return liveLeafIds
  }

  const layout = state.terminalLayoutsByTabId[tabId]
  const persistedLeafIds = collectLeafIdsInOrder(layout?.root).filter(isTerminalLeafId)
  if (persistedLeafIds.length > 0) {
    return persistedLeafIds
  }

  // Why: a new tab can predate TerminalPane mount; fabricating pane:1 with no live/persisted leaf would go stale after mount.
  return []
}

export function buildMobileTerminalSurfaceTabs(
  state: AppState,
  terminal: NonNullable<AppState['tabsByWorktree'][string]>[number],
  worktreeId: string,
  systemPrefersDark: boolean,
  unifiedTabId?: string
): RuntimeMobileSessionSnapshotTab[] {
  const registered = registeredTabs.get(terminal.id)
  const isDesktopTabActive = unifiedTabId
    ? state.groupsByWorktree[worktreeId]?.some(
        (group) =>
          group.id === state.activeGroupIdByWorktree[worktreeId] &&
          group.activeTabId === unifiedTabId
      ) === true
    : state.activeTabId === terminal.id
  const manager = registered?.getManager()
  const liveActivePaneId = manager?.getActivePane()?.id ?? null
  const leafIds = getRuntimeLeafIdsForTerminal(terminal.id, state)
  const activeLeafId =
    liveActivePaneId !== null
      ? (manager?.getLeafId(liveActivePaneId) ?? null)
      : (state.terminalLayoutsByTabId[terminal.id]?.activeLeafId ?? leafIds[0] ?? null)
  const paneTitles = state.runtimePaneTitlesByTabId[terminal.id] ?? {}
  const generatedTitlesEnabled = state.settings?.tabAutoGenerateTitle === true
  const savedLayout = state.terminalLayoutsByTabId[terminal.id]
  const sanitizedSavedLayout = savedLayout
    ? sanitizeTerminalLayoutPaneTitles(savedLayout, terminal)
    : undefined
  const savedPtyIdsByLeafId = sanitizedSavedLayout?.ptyIdsByLeafId ?? {}
  const terminalTheme = resolveMobileTerminalTheme(state, systemPrefersDark)
  const container = registered?.getContainer()
  const firstChild = container?.firstElementChild
  const liveLayoutRoot = serializePaneTree(
    typeof HTMLElement !== 'undefined' && firstChild instanceof HTMLElement ? firstChild : null
  )
  const parentLayout = normalizeTerminalLayoutSnapshot({
    // Why: live DOM tree is authoritative when mounted, else the saved tree; synthesize only as a last resort, never re-guess.
    root: resolveTerminalLayoutRoot({
      authoritativeRoot: liveLayoutRoot,
      existingRoot: sanitizedSavedLayout?.root,
      leafIds,
      onSynthesize: (leafCount) =>
        console.warn(
          `[sync-runtime-graph] synthesized parentLayout for ${leafCount} leaves with no live or saved tree`
        )
    }),
    activeLeafId,
    expandedLeafId: sanitizedSavedLayout?.expandedLeafId ?? null,
    ...(Object.keys(savedPtyIdsByLeafId).length > 0 ? { ptyIdsByLeafId: savedPtyIdsByLeafId } : {}),
    ...(sanitizedSavedLayout?.titlesByLeafId
      ? { titlesByLeafId: sanitizedSavedLayout.titlesByLeafId }
      : {})
  } satisfies TerminalLayoutSnapshot).snapshot
  return leafIds.map((leafId) => {
    const numericPaneId = manager?.getNumericIdForLeaf(leafId) ?? null
    const ptyId =
      numericPaneId === null
        ? (savedPtyIdsByLeafId[leafId] ?? (leafIds.length === 1 ? terminal.ptyId : null))
        : (registered?.getPtyIdForPane(numericPaneId) ?? savedPtyIdsByLeafId[leafId] ?? null)
    const legacyPaneId = numericPaneId === null ? /^pane:(\d+)$/.exec(leafId)?.[1] : null
    const paneTitle =
      numericPaneId !== null
        ? paneTitles[numericPaneId]
        : legacyPaneId
          ? paneTitles[Number(legacyPaneId)]
          : undefined
    const paneKey = isTerminalLeafId(leafId) ? makePaneKey(terminal.id, leafId) : null
    const title = resolveRuntimeTerminalTitle(
      terminal,
      generatedTitlesEnabled,
      paneTitle ?? terminal.title ?? 'Terminal'
    )
    const agentStatusTitle = paneTitle ?? terminal.title ?? ''
    const agentStatus =
      paneKey && !isClaudeManagementTitle(agentStatusTitle)
        ? state.agentStatusByPaneKey?.[paneKey]
        : undefined
    return {
      type: 'terminal' as const,
      id: mobileTerminalSurfaceId(terminal.id, leafId),
      title,
      ...(terminal.quickCommandLabel?.trim()
        ? { quickCommandLabel: terminal.quickCommandLabel.trim() }
        : {}),
      parentTabId: terminal.id,
      leafId,
      ptyId,
      ...(terminalTheme ? { terminalTheme } : {}),
      ...(agentStatus ? { agentStatus } : {}),
      ...(terminal.launchAgent ? { launchAgent: terminal.launchAgent } : {}),
      parentLayout,
      isActive: isDesktopTabActive && leafId === activeLeafId
    }
  })
}

export function buildMobileMarkdownTab(
  state: AppState,
  openFileByWorktreeAndId: OpenFileByWorktreeAndId,
  editorDraftVersionByFileId: ReadonlyMap<string, string>,
  file: AppState['openFiles'][number],
  unifiedTab?: Tab
): RuntimeMobileSessionMarkdownTab | null {
  if (file.mode !== 'edit' && file.mode !== 'markdown-preview') {
    return null
  }
  if (file.language !== 'markdown' && file.mode !== 'markdown-preview') {
    return null
  }

  const sourceFile =
    file.mode === 'markdown-preview' && file.markdownPreviewSourceFileId
      ? (openFileByWorktreeAndId.get(file.worktreeId)?.get(file.markdownPreviewSourceFileId) ??
        file)
      : file
  const draftVersion = editorDraftVersionByFileId.get(sourceFile.id)
  const title = file.relativePath.split(/[\\/]/).pop() || file.relativePath || 'Markdown'
  const unifiedTabId = unifiedTab?.id

  return {
    type: 'markdown',
    id: unifiedTabId ?? file.id,
    title,
    filePath: file.filePath,
    relativePath: file.relativePath,
    language: 'markdown',
    mode: file.mode,
    isDirty: file.isDirty || sourceFile.isDirty,
    isActive: unifiedTabId
      ? isUnifiedTabActiveInActiveGroup(state, file.worktreeId, unifiedTabId)
      : isFileActiveEditorSurface(state, file),
    sourceFileId: sourceFile.id,
    sourceFilePath: sourceFile.filePath,
    sourceRelativePath: sourceFile.relativePath,
    documentVersion: draftVersion ?? `file:${sourceFile.id}`,
    color: unifiedTab?.color ?? null,
    isPinned: unifiedTab?.isPinned === true
  }
}

export function buildMobileFileTab(
  state: AppState,
  file: AppState['openFiles'][number],
  unifiedTab?: Tab
): RuntimeMobileSessionFileTab {
  const title = file.relativePath.split(/[\\/]/).pop() || file.relativePath || 'File'
  const diffSource = isMobileFileDiffSource(file.diffSource) ? file.diffSource : undefined
  const unifiedTabId = unifiedTab?.id

  return {
    type: 'file',
    id: unifiedTabId ?? file.id,
    title,
    filePath: file.filePath,
    relativePath: file.relativePath,
    language: file.language,
    mode: file.mode === 'diff' ? 'diff' : 'edit',
    ...(diffSource ? { diffSource } : {}),
    isDirty: file.isDirty,
    color: unifiedTab?.color ?? null,
    isPinned: unifiedTab?.isPinned === true,
    isActive: unifiedTabId
      ? isUnifiedTabActiveInActiveGroup(state, file.worktreeId, unifiedTabId)
      : isFileActiveEditorSurface(state, file)
  }
}

function isFileActiveEditorSurface(
  state: Pick<
    AppState,
    'activeFileId' | 'activeFileIdByWorktree' | 'activeTabType' | 'activeTabTypeByWorktree'
  >,
  file: Pick<AppState['openFiles'][number], 'id' | 'worktreeId'>
): boolean {
  const activeType = state.activeTabTypeByWorktree?.[file.worktreeId] ?? state.activeTabType
  return (
    activeType === 'editor' &&
    (state.activeFileIdByWorktree?.[file.worktreeId] ?? state.activeFileId) === file.id
  )
}

function isMobileFileDiffSource(
  diffSource: AppState['openFiles'][number]['diffSource']
): diffSource is 'staged' | 'unstaged' {
  return diffSource === 'staged' || diffSource === 'unstaged'
}

function isMobileUnsupportedCombinedDiffSource(
  diffSource: AppState['openFiles'][number]['diffSource']
): boolean {
  return (
    diffSource === 'combined-all' ||
    diffSource === 'combined-uncommitted' ||
    diffSource === 'combined-branch' ||
    diffSource === 'combined-commit'
  )
}

export function isMobilePublishableOpenFile(file: AppState['openFiles'][number]): boolean {
  // Why: combined diff tabs use display labels as paths and need the desktop renderer; mobile would mis-call files.read.
  return !isMobileUnsupportedCombinedDiffSource(file.diffSource)
}

export function buildMobileBrowserTab(
  state: AppState,
  workspace: NonNullable<AppState['browserTabsByWorktree'][string]>[number],
  unifiedTab?: Tab
): RuntimeMobileSessionBrowserTab {
  const pages = state.browserPagesByWorkspace[workspace.id] ?? []
  const activePage = pages.find((page) => page.id === workspace.activePageId) ?? pages[0] ?? null
  const title =
    activePage?.title || workspace.title || activePage?.url || workspace.url || 'Browser'
  const unifiedTabId = unifiedTab?.id

  return {
    type: 'browser',
    id: unifiedTabId ?? workspace.id,
    title,
    browserWorkspaceId: workspace.id,
    browserPageId: activePage?.id ?? workspace.activePageId ?? null,
    url: activePage?.url ?? workspace.url ?? 'about:blank',
    loading: activePage?.loading ?? workspace.loading,
    canGoBack: activePage?.canGoBack ?? workspace.canGoBack,
    canGoForward: activePage?.canGoForward ?? workspace.canGoForward,
    // Why: null means the active page cleared its failure; ?? would resurrect a stale workspace-level error.
    loadError: activePage ? activePage.loadError : workspace.loadError,
    certificateFailure: activePage
      ? (state.browserCertificateFailuresByPageId?.[activePage.id] ?? null)
      : null,
    color: unifiedTab?.color ?? null,
    isPinned: unifiedTab?.isPinned === true,
    isActive: unifiedTabId
      ? isUnifiedTabActiveInActiveGroup(state, workspace.worktreeId, unifiedTabId)
      : state.activeBrowserTabIdByWorktree[workspace.worktreeId] === workspace.id
  }
}

function isUnifiedTabActiveInActiveGroup(
  state: AppState,
  worktreeId: string,
  unifiedTabId: string
): boolean {
  const activeGroupId = state.activeGroupIdByWorktree[worktreeId]
  return (
    state.groupsByWorktree[worktreeId]?.some(
      (group) => group.id === activeGroupId && group.activeTabId === unifiedTabId
    ) === true
  )
}

export function stableHashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `draft:${value.length}:${(hash >>> 0).toString(16)}`
}
