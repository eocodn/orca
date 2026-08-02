import React from 'react'
import { ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { isBlockingJiraUrlIntent } from './smart-workspace-source-results'
import { isComposerFieldToFieldFocus } from './smart-workspace-source-popover-focus'
import { replaceCompletedWorkspaceEmojiShortcode } from '@/lib/workspace-emoji-shortcodes'
import { SelectionIcon } from './smart-workspace-name-field-presentation'

export function SmartWorkspaceSourceInput({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    ActiveInputIcon,
    applyEmojiReplacement,
    disabled,
    emojiMenuOpen,
    emojiSuggestions,
    handleEmojiSelect,
    handleSelect,
    markSourcePopoverUserEngaged,
    mode,
    onClearSelectedSource,
    onPlainEnter,
    onValueChange,
    open,
    replaceCompletedWorkspaceEmojiShortcode: replaceEmoji,
    resolvedCommandValue,
    resolvedEmojiCommandValue,
    rows,
    selectedEmojiSuggestion,
    selectedSource,
    setEmojiCommandValue,
    setEmojiCursor,
    setInputNode,
    setOpen,
    setSelectedSourceNode,
    showSearchSpinner,
    tabsListRef,
    tryOpenSourcePopover,
    value
  } = context
  const replaceShortcode = replaceEmoji ?? replaceCompletedWorkspaceEmojiShortcode
  return selectedSource ? (
    <div
      ref={setSelectedSourceNode}
      data-workspace-source-pill="true"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target || event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        onPlainEnter?.()
      }}
      className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
    >
      <SelectionIcon kind={selectedSource.kind} />
      <span className="min-w-0 flex-1 truncate font-medium leading-none text-foreground">{selectedSource.label}</span>
      {selectedSource.url ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => void window.api.shell.openUrl(selectedSource.url!)} className="size-6 shrink-0 rounded-sm text-muted-foreground hover:text-foreground" aria-label={translate('auto.components.new.workspace.SmartWorkspaceNameField.2c69728c2a', 'Open link in browser')}>
              <ExternalLink className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>{translate('auto.components.new.workspace.SmartWorkspaceNameField.370a1faf67', 'Open in browser')}</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onClearSelectedSource} className="size-6 shrink-0 rounded-sm text-muted-foreground hover:text-foreground" aria-label={translate('auto.components.new.workspace.SmartWorkspaceNameField.7199ff19c7', 'Clear selected source')}>
            <X className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>{translate('auto.components.new.workspace.SmartWorkspaceNameField.0c9e668e3a', 'Clear')}</TooltipContent>
      </Tooltip>
    </div>
  ) : (
    <>
      <ActiveInputIcon className={cn('pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground', showSearchSpinner && mode !== 'text' && 'animate-spin')} />
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
          const completedEmoji = replaceShortcode(nextValue, nextCursor)
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
          const pasted = event.clipboardData.getData('text')
          if (!pasted || !isBlockingJiraUrlIntent(mode, pasted)) return
          event.preventDefault()
          onValueChange(pasted)
          if (!disabled && mode !== 'text') {
            markSourcePopoverUserEngaged()
            setOpen(true)
          }
        }}
        onFocus={(event) => {
          setEmojiCursor(event.currentTarget.selectionStart)
          if (!isComposerFieldToFieldFocus(event)) return
          markSourcePopoverUserEngaged()
          tryOpenSourcePopover()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && event.shiftKey) {
            const activeTrigger = tabsListRef.current?.querySelector<HTMLElement>(`[data-smart-name-mode="${mode}"]`)
            if (activeTrigger) {
              event.preventDefault()
              activeTrigger.focus()
              return
            }
          }
          if (emojiMenuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            event.stopPropagation()
            const selectedIndex = emojiSuggestions.findIndex((suggestion: any) => `emoji:${suggestion.shortcode}` === resolvedEmojiCommandValue)
            const direction = event.key === 'ArrowDown' ? 1 : -1
            const nextIndex = (selectedIndex + direction + emojiSuggestions.length) % emojiSuggestions.length
            setEmojiCommandValue(`emoji:${emojiSuggestions[nextIndex].shortcode}`)
            return
          }
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            if (isImeCompositionKeyDown(event)) return
            if (emojiMenuOpen && selectedEmojiSuggestion) {
              event.preventDefault()
              event.stopPropagation()
              handleEmojiSelect(selectedEmojiSuggestion)
              return
            }
            if (open && rows.length > 0) {
              const row = rows.find((entry: any) => entry.value === resolvedCommandValue)
              if (row) {
                event.preventDefault()
                handleSelect(row)
                return
              }
            }
            if (mode === 'jira' || context.jiraSource.intent) {
              event.preventDefault()
              return
            }
            onPlainEnter?.()
          }
          if (event.key === 'Tab' && !event.shiftKey && emojiMenuOpen && selectedEmojiSuggestion) {
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
        placeholder={context.placeholder}
        disabled={disabled}
        aria-busy={context.jiraSource.intent && context.jiraSource.loading}
        aria-describedby={context.jiraSource.intent ? context.jiraStatusId : undefined}
        className="h-9 bg-background pl-8 text-sm"
      />
    </>
  )
}
