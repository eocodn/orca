import type {
  BrowserTab as BrowserTabState,
  Tab,
  TerminalTab,
  WorkspaceVisibleTabType
} from '../../../../shared/types'
import type { OpenFile } from '../../store/slices/editor'
import { reconcileTabOrder } from './reconcile-order'
import type { DropIndicator } from './drop-indicator'
import type { HoveredTabInsertion } from '../tab-group/useTabDragSplit'
import { resolveTabIndicatorEdges } from '../tab-group/tab-insertion'
import type { TabItem } from './tab-bar-types'

export function buildTabItems(args: {
  tabBarOrder?: string[]
  terminalIds: string[]
  editorFileIds: string[]
  browserTabIds: string[]
  terminalMap: Map<string, TerminalTab & { unifiedTabId?: string }>
  editorMap: Map<string, OpenFile & { tabId?: string }>
  browserMap: Map<string, BrowserTabState & { tabId?: string }>
  unifiedTabByVisibleId: Map<string, Tab>
}): TabItem[] {
  const ids = reconcileTabOrder(
    args.tabBarOrder,
    args.terminalIds,
    args.editorFileIds,
    args.browserTabIds
  )
  const items: TabItem[] = []
  for (const id of ids) {
    const terminal = args.terminalMap.get(id)
    if (terminal) {
      const unifiedTab = args.unifiedTabByVisibleId.get(id)
      items.push({
        type: 'terminal',
        id,
        unifiedTabId: terminal.unifiedTabId ?? unifiedTab?.id ?? id,
        isPinned: unifiedTab?.isPinned === true,
        data: terminal
      })
      continue
    }
    const file = args.editorMap.get(id)
    if (file) {
      const unifiedTab =
        args.unifiedTabByVisibleId.get(id) ?? args.unifiedTabByVisibleId.get(file.id)
      items.push({
        type: 'editor',
        id,
        unifiedTabId: file.tabId ?? unifiedTab?.id ?? file.id,
        isPinned: unifiedTab?.isPinned === true,
        data: file
      })
      continue
    }
    const browser = args.browserMap.get(id)
    if (browser) {
      const unifiedTab = args.unifiedTabByVisibleId.get(id)
      items.push({
        type: 'browser',
        id,
        unifiedTabId: browser.tabId ?? unifiedTab?.id ?? browser.id,
        isPinned: unifiedTab?.isPinned === true,
        data: browser
      })
    }
  }
  return items
}

export function resolveDropIndicators(
  ids: string[],
  insertion: HoveredTabInsertion | null
): Map<string, DropIndicator> {
  const indicators = new Map<string, DropIndicator>()
  for (const edge of resolveTabIndicatorEdges(ids, insertion)) {
    indicators.set(edge.visibleTabId, edge.side)
  }
  return indicators
}

export function findActiveVisibleTabId(
  items: readonly TabItem[],
  active: {
    tabType?: WorkspaceVisibleTabType
    terminalId: string | null
    fileId?: string | null
    browserId?: string | null
  }
): string | null {
  const item = items.find((candidate) => {
    if (candidate.type === 'terminal') {
      return active.tabType === 'terminal' && candidate.id === active.terminalId
    }
    if (candidate.type === 'browser') {
      return active.tabType === 'browser' && candidate.id === active.browserId
    }
    return active.tabType === 'editor' && candidate.id === active.fileId
  })
  return item?.id ?? null
}
