import React from 'react'
import { SortableContext } from '@dnd-kit/sortable'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TabDragItemData } from '../tab-group/useTabDragSplit'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import SortableTab from './SortableTab'
import EditorFileTab from './EditorFileTab'
import BrowserTab from './BrowserTab'
import { TabStripScrollIndicator } from './TabStripScrollIndicator'
import { getTabStripScrollMaskClassName } from './tab-strip-scroll-metrics'
import { translate } from '@/i18n/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import type { TabBarControllerModel, TabBarProps } from './tab-bar-controller'
import { getTabDragLabel } from './tab-bar-types'
import { TabBarMenu } from './tab-bar-menu'

export function TabBarView({
  props,
  controller
}: {
  props: TabBarProps
  controller: TabBarControllerModel
}): React.JSX.Element {
  const {
    activeTabId,
    worktreeId,
    expandedPaneByTabId,
    onActivate,
    onClose,
    onCloseOthers,
    onCloseToRight,
    onCloseToLeft,
    onNewTerminalTab,
    onNewTerminalWithShell,
    onNewBrowserTab,
    onOpenEntry,
    terminalOnly,
    showAgentLaunchItems,
    onNewFileTab,
    onOpenFileTab,
    newTabMenuOrder,
    onSetCustomTitle,
    onSetTabColor,
    onTogglePaneExpand,
    activeFileId,
    activeBrowserTabId,
    activeTabType,
    onActivateFile,
    onCloseFile,
    onActivateBrowserTab,
    onCloseBrowserTab,
    onDuplicateBrowserTab,
    onCloseAllFiles,
    onMakePreviewFilePermanent
  } = props
  const {
    includeTopTabBorder,
    resolvedGroupId,
    generatedTabTitlesEnabled,
    statusByRelativePath,
    orderedItems,
    sortableIds,
    dropIndicatorByVisibleId,
    tabStripRef,
    tabStripOverflowState,
    scrollTabStrip,
    tabStripDragScroll,
    clearPendingNewTabMenuFocusOnUnmount,
    togglePinned
  } = controller
  return (
    <div
      ref={clearPendingNewTabMenuFocusOnUnmount}
      className="flex items-stretch h-full overflow-hidden flex-1 min-w-0"
      data-native-file-drop-target="editor"
    >
      {tabStripOverflowState.hasOverflow ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="mx-0.5 my-auto h-6 w-5 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              aria-label={translate(
                'auto.components.tab.bar.TabBar.7a9b4af2af',
                'Scroll tabs left'
              )}
              aria-disabled={!tabStripOverflowState.canScrollStart}
              disabled={
                !tabStripDragScroll.isTabDragActive && !tabStripOverflowState.canScrollStart
              }
              onClick={() => scrollTabStrip('start')}
              onPointerEnter={tabStripDragScroll.onDragScrollStartEnter}
              onPointerLeave={tabStripDragScroll.onDragScrollLeave}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.components.tab.bar.TabBar.7a9b4af2af', 'Scroll tabs left')}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <SortableContext items={sortableIds}>
        <div
          className="relative flex min-h-0 min-w-0 max-w-full flex-[0_1_auto]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div
            ref={tabStripRef}
            className={[
              'terminal-tab-strip flex h-full min-w-0 max-w-full flex-1 items-stretch overflow-x-auto overflow-y-hidden border-r border-border/70',
              getTabStripScrollMaskClassName(tabStripOverflowState)
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {orderedItems.map((item, index) => {
              const dragData: TabDragItemData = {
                kind: 'tab',
                worktreeId,
                groupId: resolvedGroupId,
                unifiedTabId: item.unifiedTabId,
                visibleTabId: item.id,
                tabType: item.type,
                label: getTabDragLabel(item, generatedTabTitlesEnabled),
                iconPath: item.type === 'editor' ? item.data.filePath : undefined,
                color: item.type === 'terminal' ? (item.data.color ?? null) : null
              }
              if (item.type === 'terminal') {
                const terminalTab = {
                  ...item.data,
                  title: resolveTerminalTabTitle(
                    item.data,
                    generatedTabTitlesEnabled,
                    item.data.title
                  )
                }
                return (
                  <SortableTab
                    key={item.id}
                    tab={terminalTab}
                    unifiedTabId={item.unifiedTabId}
                    groupId={resolvedGroupId}
                    tabCount={orderedItems.length}
                    hasTabsToRight={index < orderedItems.length - 1}
                    hasTabsToLeft={index > 0}
                    isActive={activeTabType === 'terminal' && item.id === activeTabId}
                    isPinned={item.isPinned}
                    isExpanded={expandedPaneByTabId[item.id] === true}
                    onActivate={onActivate}
                    onClose={onClose}
                    onCloseOthers={onCloseOthers}
                    onCloseToRight={onCloseToRight}
                    onCloseToLeft={onCloseToLeft}
                    onSetCustomTitle={onSetCustomTitle}
                    onSetTabColor={onSetTabColor}
                    onTogglePin={() => togglePinned(item)}
                    onToggleExpand={onTogglePaneExpand}
                    dragData={dragData}
                    dropIndicator={dropIndicatorByVisibleId.get(item.id) ?? null}
                    includeTopTabBorder={includeTopTabBorder}
                  />
                )
              }
              if (item.type === 'browser') {
                return (
                  <BrowserTab
                    key={item.id}
                    tab={item.data}
                    isActive={activeTabType === 'browser' && activeBrowserTabId === item.id}
                    isPinned={item.isPinned}
                    hasTabsToRight={index < orderedItems.length - 1}
                    hasTabsToLeft={index > 0}
                    tabCount={orderedItems.length}
                    onActivate={() => onActivateBrowserTab?.(item.id)}
                    onClose={() => onCloseBrowserTab?.(item.id)}
                    onCloseOthers={() => onCloseOthers(item.id)}
                    onCloseToRight={() => onCloseToRight(item.id)}
                    onCloseToLeft={() => onCloseToLeft(item.id)}
                    onDuplicate={() => onDuplicateBrowserTab?.(item.id)}
                    onTogglePin={() => togglePinned(item)}
                    dragData={dragData}
                    dropIndicator={dropIndicatorByVisibleId.get(item.id) ?? null}
                    includeTopTabBorder={includeTopTabBorder}
                  />
                )
              }
              return (
                <EditorFileTab
                  key={item.id}
                  file={item.data}
                  isActive={activeTabType === 'editor' && activeFileId === item.id}
                  isPinned={item.isPinned}
                  hasTabsToRight={index < orderedItems.length - 1}
                  hasTabsToLeft={index > 0}
                  tabCount={orderedItems.length}
                  statusByRelativePath={statusByRelativePath}
                  onActivate={() => onActivateFile?.(item.id)}
                  onClose={() => onCloseFile?.(item.id)}
                  onCloseOthers={() => onCloseOthers(item.id)}
                  onCloseToRight={() => onCloseToRight(item.id)}
                  onCloseToLeft={() => onCloseToLeft(item.id)}
                  onCloseAll={() => onCloseAllFiles?.()}
                  onMakePermanent={() =>
                    onMakePreviewFilePermanent?.(item.data.id, item.data.tabId)
                  }
                  onTogglePin={() => togglePinned(item)}
                  dragData={dragData}
                  dropIndicator={dropIndicatorByVisibleId.get(item.id) ?? null}
                  includeTopTabBorder={includeTopTabBorder}
                />
              )
            })}
          </div>
          <TabStripScrollIndicator metrics={tabStripOverflowState} />
        </div>
      </SortableContext>
      {tabStripOverflowState.hasOverflow ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="mx-0.5 my-auto h-6 w-5 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              aria-label={translate(
                'auto.components.tab.bar.TabBar.232e075b07',
                'Scroll tabs right'
              )}
              aria-disabled={!tabStripOverflowState.canScrollEnd}
              disabled={!tabStripDragScroll.isTabDragActive && !tabStripOverflowState.canScrollEnd}
              onClick={() => scrollTabStrip('end')}
              onPointerEnter={tabStripDragScroll.onDragScrollEndEnter}
              onPointerLeave={tabStripDragScroll.onDragScrollLeave}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.components.tab.bar.TabBar.232e075b07', 'Scroll tabs right')}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {TabBarMenu({
        controller,
        worktreeId,
        onNewTerminalTab,
        onNewTerminalWithShell,
        onNewBrowserTab,
        onOpenEntry,
        onNewFileTab,
        onOpenFileTab,
        terminalOnly,
        showAgentLaunchItems,
        newTabMenuOrder
      })}
    </div>
  )
}
