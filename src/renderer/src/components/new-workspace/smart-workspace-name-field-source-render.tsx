import React from 'react'
import { ExternalLink, LoaderCircle, X } from 'lucide-react'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { isBlockingJiraUrlIntent } from './smart-workspace-source-results'
import { WorkspaceEmojiSuggestionPopover } from './WorkspaceEmojiSuggestionPopover'
import { RowIcon, RowLabel, SelectionIcon } from './smart-workspace-name-field-presentation'
import type { JiraSite } from '../../../../shared/types'
import type { JiraUrlSourceState } from './use-jira-url-source'
import type { SmartWorkspaceSourceRow } from './smart-workspace-source-results'
import type { SmartNameMode } from './smart-workspace-source-results'

export type RowEntry = SmartWorkspaceSourceRow | { kind: 'jira-account'; value: string; site: JiraSite }

const ROW_ITEM_CLASS_NAME = 'gap-2 px-3 py-2 text-xs'

function getJiraSourceStatusMessage(jiraSource: JiraUrlSourceState): string {
  if (jiraSource.loading) {
    return translate(
      'auto.components.new.workspace.SmartWorkspaceNameField.loadingJira',
      'Loading Jira issue…'
    )
  }
  switch (jiraSource.errorKind) {
    case 'disconnected':
      return translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.jiraDisconnected',
        'Connect Jira in Settings to link this issue'
      )
    case 'site-not-connected':
      return translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.jiraSiteNotConnected',
        'This Jira site is not connected'
      )
    case 'update-runtime':
      return translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.jiraRuntimeUpdate',
        'Update the remote runtime to link Jira'
      )
    case 'read-failed':
      return translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.jiraReadFailed',
        'Couldn’t load this Jira issue'
      )
    case null:
      return jiraSource.accountChoices.length > 0
        ? translate(
            'auto.components.new.workspace.SmartWorkspaceNameField.chooseJiraAccount',
            'Choose a Jira account'
          )
        : translate(
            'auto.components.new.workspace.SmartWorkspaceNameField.jiraLoaded',
            'Jira issue loaded'
          )
  }
}

function isTypedTextSourceRow(row: RowEntry): boolean {
  return row.kind === 'use-name' || row.kind === 'create-branch'
}

function getRowItemClassName(row: RowEntry, options?: { pinnedAction?: boolean }): string {
  return cn(
    ROW_ITEM_CLASS_NAME,
    options?.pinnedAction && isTypedTextSourceRow(row) && 'bg-muted/35'
  )
}

export function SmartWorkspaceNameFieldSourceRender({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    selectedRepo,
    mode,
    setMode,
    mrStateFilter,
    setMrStateFilter,
    open,
    setOpen,
    commandValue,
    setCommandValue,
    setEmojiCommandValue,
    setEmojiCursor,
    localInputRef,
    tabsListRef,
    localInputFocusFrameRef,
    crossRepoPrompt,
    jiraConnectionStatus,
    jiraSource,
    showJiraSiteContext,
    jiraStatusId,
    availableModes,
    mrStateFilters,
    setSelectedSourceNode,
    cancelLocalInputFocusFrame,
    markSourcePopoverUserEngaged,
    tryOpenSourcePopover,
    handleSourcePopoverOpenChange,
    setInputNode,
    item,
    intent,
    query,
    siteId,
    rows,
    isQueryStale,
    resolvedCommandValue,
    emojiSuggestions,
    emojiMenuOpen,
    resolvedEmojiCommandValue,
    selectedEmojiSuggestion,
    loading,
    showSearchSpinner,
    ActiveInputIcon,
    handleSelect,
    sites,
    site,
    applyEmojiReplacement,
    handleEmojiSelect,
    acceptGitHubLink,
    handleUseCurrentRepo,
    handleAddMatchingRepo,
    slug,
    dismissCrossRepoPrompt,
    crossRepoSwitchTitle,
    crossRepoSwitchDescriptionSuffix,
    crossRepoSwitchFallbackLabel,
    placeholder,
  } = context
  return (
    <div className="min-w-0 space-y-1.5">
      {textOnly ? null : (
        <div className="flex min-w-0 items-center gap-2 border-b border-border/40">
          <Tabs
            value={mode}
            onValueChange={(next) => {
              const nextMode = next as SmartNameMode
              onActiveSourceModeChange?.(nextMode)
              setMode(nextMode)
              if (!disabled && nextMode !== 'text' && selectedSource === null) {
                markSourcePopoverUserEngaged()
                setOpen(true)
              } else {
                setOpen(false)
              }
              cancelLocalInputFocusFrame()
              localInputFocusFrameRef.current = requestAnimationFrame(() => {
                localInputFocusFrameRef.current = null
                localInputRef.current?.focus({ preventScroll: true })
              })
            }}
            className="min-w-0 flex-1 gap-0"
          >
            <TabsList
              ref={tabsListRef}
              variant="line"
              className="h-7 w-full justify-start gap-4 overflow-x-auto overflow-y-hidden px-0 scrollbar-sleek"
              onFocusCapture={(event) => {
                // Why: Radix Tabs roving focus re-applies tabindex=0 to the active trigger (races React commits), so forward Tab to the input.
                const previous = event.relatedTarget as HTMLElement | null
                const list = tabsListRef.current
                const input = localInputRef.current
                if (!list || !input) {
                  return
                }
                if (!previous || previous === input || list.contains(previous)) {
                  return
                }
                event.stopPropagation()
                input.focus({ preventScroll: true })
              }}
            >
              {availableModes.map(({ id, label, Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  tabIndex={-1}
                  data-smart-name-mode={id}
                  className="flex-none gap-1.5 px-0 text-xs"
                >
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      <Popover
        open={!disabled && open && mode !== 'text' && selectedSource === null}
        onOpenChange={handleSourcePopoverOpenChange}
      >
        <Command
          value={resolvedCommandValue}
          onValueChange={(next) => {
            // Why: cmdk re-emits when the item list reshapes; ignore while the query
            // lags so the highlight cannot thrash mid-typing.
            if (isQueryStale) {
              return
            }
            setCommandValue(next)
          }}
          shouldFilter={false}
          className="overflow-visible bg-transparent"
        >
          <PopoverAnchor asChild>
            <div className="relative min-w-0">
              {selectedSource ? (
                // Why: min-w-0 + w-full let the pill shrink; else the inner truncate's min-content (long PR title) widens the dialog past its max-w.
                <div
                  ref={setSelectedSourceNode}
                  data-workspace-source-pill="true"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (
                      event.currentTarget !== event.target ||
                      event.key !== 'Enter' ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return
                    }
                    event.preventDefault()
                    onPlainEnter?.()
                  }}
                  className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
                >
                  <SelectionIcon kind={selectedSource.kind} />
                  <span className="min-w-0 flex-1 truncate font-medium leading-none text-foreground">
                    {selectedSource.label}
                  </span>
                  {selectedSource.url ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void window.api.shell.openUrl(selectedSource.url!)}
                          className="size-6 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                          aria-label={translate(
                            'auto.components.new.workspace.SmartWorkspaceNameField.2c69728c2a',
                            'Open link in browser'
                          )}
                        >
                          <ExternalLink className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        {translate(
                          'auto.components.new.workspace.SmartWorkspaceNameField.370a1faf67',
                          'Open in browser'
                        )}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={onClearSelectedSource}
                        className="size-6 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                        aria-label={translate(
                          'auto.components.new.workspace.SmartWorkspaceNameField.7199ff19c7',
                          'Clear selected source'
                        )}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      {translate(
                        'auto.components.new.workspace.SmartWorkspaceNameField.0c9e668e3a',
                        'Clear'
                      )}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <>
                  <ActiveInputIcon
                    className={cn(
                      'pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground',
                      showSearchSpinner && mode !== 'text' && 'animate-spin'
                    )}
                  />
                  <Input
                    ref={setInputNode}
                    data-workspace-name-input="true"
                    value={value}
                    onPointerDown={() => {
                      if (!disabled && mode !== 'text') {
                        markSourcePopoverUserEngaged()
                        setOpen(true)
                      }
                    }}
                    onClick={(event) => setEmojiCursor(event.currentTarget.selectionStart)}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      const nextCursor = event.target.selectionStart
                      const completedEmoji = replaceCompletedWorkspaceEmojiShortcode(
                        nextValue,
                        nextCursor
                      )
                      if (completedEmoji) {
                        applyEmojiReplacement(completedEmoji)
                        return
                      }
                      onValueChange(nextValue)
                      setEmojiCursor(nextCursor)
                      if (!disabled && mode !== 'text') {
                        markSourcePopoverUserEngaged()
                        setOpen(true)
                      }
                    }}
                    onPaste={(event) => {
                      // Why: a pasted issue URL is the whole intent — don't splice it into a name.
                      const pasted = event.clipboardData.getData('text')
                      if (!pasted || !isBlockingJiraUrlIntent(mode, pasted)) {
                        return
                      }
                      event.preventDefault()
                      onValueChange(pasted)
                      if (!disabled && mode !== 'text') {
                        markSourcePopoverUserEngaged()
                        setOpen(true)
                      }
                    }}
                    onFocus={(event) => {
                      // Why: only open on focus from another composer control (Tab); dialog autofocus from outside stays suppressed.
                      if (!isComposerFieldToFieldFocus(event)) {
                        setEmojiCursor(event.currentTarget.selectionStart)
                        return
                      }
                      setEmojiCursor(event.currentTarget.selectionStart)
                      markSourcePopoverUserEngaged()
                      tryOpenSourcePopover()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Tab' && event.shiftKey) {
                        const activeTrigger = tabsListRef.current?.querySelector<HTMLElement>(
                          `[data-smart-name-mode="${mode}"]`
                        )
                        if (activeTrigger) {
                          event.preventDefault()
                          activeTrigger.focus()
                          return
                        }
                      }
                      if (emojiMenuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                        event.preventDefault()
                        event.stopPropagation()
                        const selectedIndex = emojiSuggestions.findIndex(
                          (suggestion) =>
                            `emoji:${suggestion.shortcode}` === resolvedEmojiCommandValue
                        )
                        const direction = event.key === 'ArrowDown' ? 1 : -1
                        const nextIndex =
                          (selectedIndex + direction + emojiSuggestions.length) %
                          emojiSuggestions.length
                        setEmojiCommandValue(`emoji:${emojiSuggestions[nextIndex].shortcode}`)
                        return
                      }
                      if (
                        event.key === 'Enter' &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.shiftKey
                      ) {
                        // Why: an Enter that only commits a CJK IME candidate
                        // must not select a row or advance focus — moving focus
                        // mid-composition makes Chromium re-commit the composed
                        // character into the controlled input, duplicating the
                        // last syllable (e.g. 배포 → 배포포).
                        if (isImeCompositionKeyDown(event)) {
                          return
                        }
                        if (emojiMenuOpen && selectedEmojiSuggestion) {
                          event.preventDefault()
                          event.stopPropagation()
                          handleEmojiSelect(selectedEmojiSuggestion)
                          return
                        }
                        if (open && rows.length > 0) {
                          const row = rows.find((entry) => entry.value === resolvedCommandValue)
                          if (row) {
                            event.preventDefault()
                            handleSelect(row)
                            return
                          }
                          // No highlighted row; fall through to onPlainEnter so the keypress isn't inert.
                        }
                        if (mode === 'jira' || jiraSource.intent) {
                          event.preventDefault()
                          return
                        }
                        onPlainEnter?.()
                      }
                      if (
                        event.key === 'Tab' &&
                        !event.shiftKey &&
                        emojiMenuOpen &&
                        selectedEmojiSuggestion
                      ) {
                        event.preventDefault()
                        event.stopPropagation()
                        handleEmojiSelect(selectedEmojiSuggestion)
                        return
                      }
                      if (event.key === 'Escape' && emojiMenuOpen) {
                        event.stopPropagation()
                        setEmojiCursor(null)
                        return
                      }
                      if (event.key === 'Escape' && open) {
                        event.stopPropagation()
                        setOpen(false)
                      }
                    }}
                    placeholder={placeholder}
                    disabled={disabled}
                    aria-busy={jiraSource.intent && jiraSource.loading}
                    aria-describedby={jiraSource.intent ? jiraStatusId : undefined}
                    // Why: match the project/run-on comboboxes' solid `bg-background` — the input's
                    // default transparent fill made it read a different color on light mode.
                    className="h-9 bg-background pl-8 text-sm"
                  />
                </>
              )}
            </div>
          </PopoverAnchor>
          <PopoverContent
            data-workspace-source-suggestions="true"
            align="start"
            side="bottom"
            sideOffset={4}
            avoidCollisions={false}
            className="popover-scroll-content flex w-[var(--radix-popover-trigger-width)] flex-col p-0"
            // Why: capped height so the result list can't cover the create-workspace dialog's submit footer while typing.
            style={{ maxHeight: 'min(var(--radix-popover-content-available-height,7rem),7rem)' }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => {
              // Why: input is a PopoverAnchor not Trigger, so Radix counts clicks on it as outside; keep input/mode-tab clicks from closing results.
              const target = event.target as Node
              if (
                localInputRef.current?.contains(target) ||
                tabsListRef.current?.contains(target)
              ) {
                event.preventDefault()
              }
            }}
            onFocusOutside={(event) => {
              const target = event.target as Node
              if (
                localInputRef.current?.contains(target) ||
                tabsListRef.current?.contains(target)
              ) {
                event.preventDefault()
              }
            }}
          >
            {mode === 'gitlab' ? (
              // Why: MR-state filter mirrors gitlab.com's merge-requests tab strip so web-UI users find a familiar control.
              <div
                className="flex shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1.5"
                onMouseDown={(e) => e.preventDefault()}
              >
                {mrStateFilters.map(({ id, label }) => (
                  <Button
                    key={id}
                    type="button"
                    variant={mrStateFilter === id ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setMrStateFilter(id)}
                    className="h-6 px-2 text-xs"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            ) : null}
            <CommandList className="!max-h-none min-h-0 flex-1 scrollbar-sleek">
              {typedTextActionRow ? (
                <div
                  className="sticky top-0 z-10 border-b border-border/40 bg-popover p-1"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  <CommandItem
                    key={typedTextActionRow.value}
                    value={typedTextActionRow.value}
                    onSelect={() => handleSelect(typedTextActionRow)}
                    className={getRowItemClassName(typedTextActionRow, { pinnedAction: true })}
                  >
                    <RowIcon row={typedTextActionRow} />
                    <RowLabel row={typedTextActionRow} />
                  </CommandItem>
                </div>
              ) : null}
              {jiraSource.errorKind ? null : loading && searchResultRows.length === 0 ? (
                <div className="space-y-1 p-1">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="h-8 animate-pulse rounded bg-muted/40" />
                  ))}
                </div>
              ) : searchResultRows.length === 0 && !typedTextActionRow ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {jiraSource.intent
                    ? null
                    : mode === 'linear' && linearStatusChecked && !linearStatus.connected
                      ? translate(
                          'auto.components.new.workspace.SmartWorkspaceNameField.3e8bb1176a',
                          'Connect Linear in Settings to search issues.'
                        )
                      : getSmartWorkspaceEmptyHint(mode)}
                </div>
              ) : searchResultRows.length > 0 ? (
                <CommandGroup className="p-1">
                  {searchResultRows.map((row) => (
                    <CommandItem
                      key={row.value}
                      value={row.value}
                      onSelect={() => handleSelect(row)}
                      className={getRowItemClassName(row)}
                    >
                      <RowIcon row={row} />
                      <RowLabel
                        row={row}
                        jiraSite={
                          showJiraSiteContext && row.kind === 'jira'
                            ? (jiraConnectionStatus?.sites?.find(
                                (site) => site.id === row.issue.siteId
                              ) ?? null)
                            : null
                        }
                        showJiraSiteContext={showJiraSiteContext}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </PopoverContent>
        </Command>
      </Popover>
      {jiraSource.intent ? (
        <div
          id={jiraStatusId}
          role="status"
          aria-live="polite"
          className={cn(
            'flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground',
            !jiraSource.loading &&
              !jiraSource.errorKind &&
              jiraSource.accountChoices.length === 0 &&
              'sr-only'
          )}
        >
          <span>{getJiraSourceStatusMessage(jiraSource)}</span>
          {jiraSource.errorKind === 'disconnected' && onOpenJiraSettings ? (
            <Button type="button" variant="link" size="xs" onClick={onOpenJiraSettings}>
              {translate(
                'auto.components.new.workspace.SmartWorkspaceNameField.openSettings',
                'Settings'
              )}
            </Button>
          ) : jiraSource.errorKind === 'read-failed' ? (
            <Button type="button" variant="link" size="xs" onClick={jiraSource.retry}>
              {translate(
                'auto.components.new.workspace.SmartWorkspaceNameField.retryJira',
                'Retry'
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
      <WorkspaceEmojiSuggestionPopover
        anchorRef={localInputRef}
        open={emojiMenuOpen}
        commandValue={resolvedEmojiCommandValue}
        heading={translate('auto.components.new.workspace.SmartWorkspaceNameField.emoji', 'Emoji')}
        suggestions={emojiSuggestions}
        onCommandValueChange={setEmojiCommandValue}
        onSelect={handleEmojiSelect}
        onOpenChange={(next) => {
          if (!next) {
            setEmojiCursor(null)
          }
        }}
      />
      <Dialog
        open={crossRepoPrompt !== null}
        onOpenChange={(next) => !next && dismissCrossRepoPrompt()}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{crossRepoSwitchTitle}</DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.new.workspace.SmartWorkspaceNameField.ad188067ae',
                'The GitHub URL points to'
              )}{' '}
              {crossRepoPrompt?.link.slug.owner}/{crossRepoPrompt?.link.slug.repo}
              {crossRepoSwitchDescriptionSuffix}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={dismissCrossRepoPrompt}>
              {translate(
                'auto.components.new.workspace.SmartWorkspaceNameField.6859e2896c',
                'Cancel'
              )}
            </Button>
            <Button variant="outline" onClick={() => void handleUseCurrentRepo()}>
              {translate(
                'auto.components.new.workspace.SmartWorkspaceNameField.eadf877af5',
                'Keep'
              )}{' '}
              {selectedRepo?.displayName ?? crossRepoSwitchFallbackLabel}
            </Button>
            {crossRepoPrompt?.matchingRepo ? (
              <Button onClick={() => void acceptGitHubLink(crossRepoPrompt.matchingRepo!)}>
                {translate(
                  'auto.components.new.workspace.SmartWorkspaceNameField.a76fcb4fa0',
                  'Switch to'
                )}{' '}
                {crossRepoPrompt.matchingRepo.displayName}
              </Button>
            ) : allowCrossRepoProjectAdd ? (
              <Button onClick={() => void handleAddMatchingRepo()}>
                {translate(
                  'auto.components.new.workspace.SmartWorkspaceNameField.e57c53727c',
                  'Add project...'
                )}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
