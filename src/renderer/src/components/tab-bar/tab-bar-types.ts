import type { BrowserTab as BrowserTabState, Tab, TerminalTab } from '../../../../shared/types'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import type { OpenFile } from '../../store/slices/editor'
import { getEditorDisplayLabel } from '@/components/editor/editor-labels'
import { getBrowserTabLabel } from './BrowserTab'

export type TabItem =
  | {
      type: 'terminal'
      id: string
      unifiedTabId: string
      isPinned: boolean
      data: TerminalTab & { unifiedTabId?: string }
    }
  | {
      type: 'editor'
      id: string
      unifiedTabId: string
      isPinned: boolean
      data: OpenFile & { tabId?: string }
    }
  | {
      type: 'browser'
      id: string
      unifiedTabId: string
      isPinned: boolean
      data: BrowserTabState & { tabId?: string }
    }

export function getTabDragLabel(item: TabItem, generatedTitlesEnabled: boolean): string {
  if (item.type === 'terminal') {
    return resolveTerminalTabTitle(item.data, generatedTitlesEnabled, item.data.title)
  }
  if (item.type === 'browser') {
    return getBrowserTabLabel(item.data)
  }
  return getEditorDisplayLabel(item.data)
}

export function getTabLayoutSignature(
  item: TabItem,
  options: { generatedTitlesEnabled: boolean; isExpanded: boolean; status?: string | null }
): string {
  const label = getTabDragLabel(item, options.generatedTitlesEnabled)
  if (item.type === 'terminal') {
    return `${item.type}:${item.id}:${item.isPinned}:${options.isExpanded}:${Boolean(item.data.color)}:${label}`
  }
  if (item.type === 'browser') {
    return `${item.type}:${item.id}:${item.isPinned}:${item.data.loading}:${Boolean(item.data.loadError)}:${label}`
  }
  return `${item.type}:${item.id}:${item.isPinned}:${item.data.isDirty}:${item.data.isPreview}:${item.data.externalMutation ?? ''}:${options.status ?? ''}:${label}`
}

export function createUnifiedTabLookup(tabs: readonly Tab[], groupId: string): Map<string, Tab> {
  const lookup = new Map<string, Tab>()
  for (const tab of tabs) {
    if (tab.groupId !== groupId) {
      continue
    }
    lookup.set(tab.id, tab)
    if (tab.contentType === 'terminal' || tab.contentType === 'browser') {
      lookup.set(tab.entityId, tab)
    }
  }
  return lookup
}
