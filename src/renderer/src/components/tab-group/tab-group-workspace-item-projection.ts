import type { OpenFile } from '@/store/slices/editor'
import type { BrowserTab as BrowserTabState, Tab, TerminalTab } from '../../../../shared/types'
import { resolveUnifiedTabLabel } from '../../../../shared/tab-title-resolution'

export type ProjectedGroupEditorItem = OpenFile & { tabId: string }
export type ProjectedGroupBrowserItem = BrowserTabState & { tabId: string }
export type ProjectedTerminalTabItem = TerminalTab & { unifiedTabId: string }

export function projectTabGroupWorkspaceItems({
  groupTabs,
  terminalTabsById,
  worktreeId,
  generatedTabTitlesEnabled,
  openFiles,
  browserTabs
}: {
  groupTabs: readonly Tab[]
  terminalTabsById: ReadonlyMap<string, TerminalTab>
  worktreeId: string
  generatedTabTitlesEnabled: boolean
  openFiles: readonly OpenFile[]
  browserTabs: readonly BrowserTabState[]
}): {
  terminalTabs: ProjectedTerminalTabItem[]
  editorItems: ProjectedGroupEditorItem[]
  browserItems: ProjectedGroupBrowserItem[]
} {
  const terminalItems = groupTabs
    .filter((item) => item.contentType === 'terminal')
    .map((item) => {
      const terminalTab = terminalTabsById.get(item.entityId)
      return {
        id: item.entityId,
        unifiedTabId: item.id,
        ptyId: terminalTab?.ptyId ?? null,
        worktreeId,
        title: resolveUnifiedTabLabel(
          {
            ...item,
            quickCommandLabel: item.quickCommandLabel ?? terminalTab?.quickCommandLabel,
            generatedLabel: item.generatedLabel ?? terminalTab?.generatedTitle
          },
          generatedTabTitlesEnabled,
          item.label
        ),
        defaultTitle: terminalTab?.defaultTitle,
        quickCommandLabel: terminalTab?.quickCommandLabel ?? item.quickCommandLabel ?? null,
        generatedTitle: terminalTab?.generatedTitle ?? item.generatedLabel ?? null,
        customTitle: item.customLabel ?? terminalTab?.customTitle ?? null,
        color: item.color ?? terminalTab?.color ?? null,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        generation: terminalTab?.generation,
        shellOverride: terminalTab?.shellOverride,
        startupCwd: terminalTab?.startupCwd,
        // Preserve store-only launch metadata when rebuilding from unified tabs.
        launchAgent: terminalTab?.launchAgent,
        pendingActivationSpawn: terminalTab?.pendingActivationSpawn
      }
    })

  const editorItems = groupTabs
    .filter(
      (item) =>
        item.contentType === 'editor' ||
        item.contentType === 'diff' ||
        item.contentType === 'conflict-review' ||
        item.contentType === 'check-details'
    )
    .map((item) => {
      const file = openFiles.find((candidate) => candidate.id === item.entityId)
      return file ? { ...file, tabId: item.id } : null
    })
    .filter((item): item is ProjectedGroupEditorItem => item !== null)

  const browserItems = groupTabs
    .filter((item) => item.contentType === 'browser')
    .map((item) => {
      const browserTab = browserTabs.find((candidate) => candidate.id === item.entityId)
      return browserTab ? { ...browserTab, tabId: item.id } : null
    })
    .filter((item): item is ProjectedGroupBrowserItem => item !== null)

  return { terminalTabs: terminalItems, editorItems, browserItems }
}
