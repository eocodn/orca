import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import type { SourceControlAiSettingsPatch } from '../../../../shared/source-control-ai-types'
import { useAppStore } from '../../store'
import { resolveAppearanceAccordionDeepLink } from './appearance-usage-percentage-search'
import { isIntentionalAppRestartInProgress } from '@/lib/updater-beforeunload'
import { registerWindowCloseGuard } from '../window-close-request-coordinator'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import {
  getSettingsSectionId,
  SHORTCUTS_ESCAPE_CONFIRM_TOAST_ID,
  SHORTCUTS_ESCAPE_CONFIRM_WINDOW_MS,
  readSourceControlAiSettings,
  cancelPendingSettingsSubsectionScrollFrame,
  isEditableTarget
} from './settings-navigation-model'
import {
  getSettingsTargetHostSelection,
  resolveSettingsTargetRepoId
} from './settings-project-list'
import { translate } from '@/i18n/i18n'
import { mergeFontSuggestions } from './SettingsConstants'

export function useSettingsPageLifecycle(context: Record<string, any>): Record<string, any> {
  const {
    settings,
    updateSettings,
    sourceControlAiWriteQueueRef,
    setSettingsSearchQuery,
    contentScrollRef,
    pendingSubsectionScrollFrameRef,
    installedFontsLoadedRef,
    installedFontsLoadPromiseRef,
    settingsMountedRef,
    setFontSuggestions,
    confirm,
    hasUnsavedSourceControlAiPromptChanges,
    setSourceControlAiPromptDiscardSignal,
    setHasUnsavedCommitPromptChanges,
    setHasUnsavedBranchPromptChanges,
    closeSettingsPage,
    fetchSettings,
    fetchKeybindings,
    shortcutsEscapeConfirmUntilRef,
    activeSectionId,
    keybindings,
    searchInputRef,
    hasUnsavedSourceControlAiPromptChangesRef,
    settingsNavigationTarget,
    repoIdToRepresentative,
    repoIdToHostSelection,
    settingsProjectList,
    pendingNavSectionRef,
    pendingScrollTargetRef,
    setSettingsProjectHostSelection,
    setQuickCommandAddIntentSignal,
    setSshHostAddIntentSignal,
    setRemoteServerAddIntentSignal,
    setMountedSectionIds,
    setPendingNavRequestTick,
    clearSettingsTarget
  } = context

  const writeSourceControlAiSettings = useCallback(
    (patch: SourceControlAiSettingsPatch): Promise<void> => {
      const next = sourceControlAiWriteQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const latestSettings = useAppStore.getState().settings ?? settings
          if (!latestSettings) {
            return
          }
          const latestConfig = readSourceControlAiSettings(latestSettings)
          const resolvedPatch = typeof patch === 'function' ? patch(latestConfig) : patch
          await updateSettings({ sourceControlAi: { ...latestConfig, ...resolvedPatch } })
        })
      sourceControlAiWriteQueueRef.current = next
      return next
    },
    [settings, updateSettings]
  )

  const setSettingsRootNode = useCallback(
    (node: HTMLDivElement | null): void => {
      if (node) {
        return
      }
      // Why: clear the transient search filter on close, else the next visit opens with whole sections still hidden.
      setSettingsSearchQuery('')
    },
    [setSettingsSearchQuery]
  )

  const setContentScrollNode = useCallback((node: HTMLDivElement | null): void => {
    contentScrollRef.current = node
    if (node !== null) {
      return
    }
    // Why: cancel pending subsection jumps with the scroll container so a stale deep-link frame can't run after close.
    cancelPendingSettingsSubsectionScrollFrame(pendingSubsectionScrollFrameRef)
  }, [])

  useEffect(() => {
    // Why: StrictMode replays mount effects; async font requests should still commit while Settings is mounted.
    settingsMountedRef.current = true
    return () => {
      settingsMountedRef.current = false
    }
  }, [])

  const requestFontSuggestions = useCallback((): void => {
    if (installedFontsLoadedRef.current || installedFontsLoadPromiseRef.current) {
      return
    }

    installedFontsLoadPromiseRef.current = window.api.settings
      .listFonts()
      .then((fonts) => {
        if (!settingsMountedRef.current) {
          return
        }
        // Latch after the first successful attempt even when empty, so a font-less system doesn't reissue listFonts() each time.
        installedFontsLoadedRef.current = true
        if (fonts.length === 0) {
          return
        }
        setFontSuggestions((prev) => mergeFontSuggestions(fonts, prev))
      })
      .catch(() => {
        // Fall back to curated cross-platform suggestions.
      })
      .finally(() => {
        installedFontsLoadPromiseRef.current = null
      })
  }, [])

  // Pure prompt (no side effects): the close guard must ask without clearing drafts, since a later guard can still cancel the close.
  const promptDiscardSourceControlAiPromptChanges = useCallback((): Promise<boolean> => {
    return confirm({
      title: translate(
        'auto.components.settings.Settings.17bdee4ff1',
        'Discard unsaved Git AI Author changes?'
      ),
      description: translate(
        'auto.components.settings.Settings.43b68e10f0',
        'You have unsaved Git AI Author changes. Leaving will discard them.'
      ),
      confirmLabel: translate('auto.components.settings.Settings.65358016ea', 'Discard'),
      confirmVariant: 'destructive'
    })
  }, [confirm])

  const confirmDiscardSourceControlAiPromptChanges = useCallback(async (): Promise<boolean> => {
    if (!hasUnsavedSourceControlAiPromptChanges) {
      return true
    }
    const shouldDiscard = await promptDiscardSourceControlAiPromptChanges()
    if (shouldDiscard) {
      setSourceControlAiPromptDiscardSignal((signal) => signal + 1)
      setHasUnsavedCommitPromptChanges(false)
      setHasUnsavedBranchPromptChanges(false)
    }
    return shouldDiscard
  }, [promptDiscardSourceControlAiPromptChanges, hasUnsavedSourceControlAiPromptChanges])

  const closeSettingsPageWithPromptGuard = useCallback(async (): Promise<void> => {
    if (!(await confirmDiscardSourceControlAiPromptChanges())) {
      return
    }
    closeSettingsPage()
  }, [closeSettingsPage, confirmDiscardSourceControlAiPromptChanges])

  useEffect(() => {
    fetchSettings()
    fetchKeybindings()
  }, [fetchKeybindings, fetchSettings])

  useEffect(() => {
    const hasVisibleOverlay = (): boolean =>
      Array.from(
        document.querySelectorAll('[role="dialog"], [role="listbox"], [role="menu"]')
      ).some((element) => {
        if (!(element instanceof HTMLElement)) {
          return false
        }
        if (element.closest('[aria-hidden="true"]')) {
          return false
        }
        const style = window.getComputedStyle(element)
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getClientRects().length > 0
        )
      })

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      // Why: nested dialogs/menus own Escape before Settings page-level navigation.
      if (hasVisibleOverlay()) {
        return
      }
      // Why: Escape in an editable control means "cancel this edit", not "close Settings" — defer to the field's own handler.
      if (isEditableTarget(event.target)) {
        return
      }
      if (activeSectionId === 'shortcuts') {
        event.preventDefault()
        const now = Date.now()
        if (now <= shortcutsEscapeConfirmUntilRef.current) {
          shortcutsEscapeConfirmUntilRef.current = 0
          toast.dismiss(SHORTCUTS_ESCAPE_CONFIRM_TOAST_ID)
          void closeSettingsPageWithPromptGuard()
          return
        }
        shortcutsEscapeConfirmUntilRef.current = now + SHORTCUTS_ESCAPE_CONFIRM_WINDOW_MS
        toast.info(
          translate(
            'auto.components.settings.Settings.acc7bbdefd',
            'Press ESC again to exit settings'
          ),
          {
            id: SHORTCUTS_ESCAPE_CONFIRM_TOAST_ID,
            duration: SHORTCUTS_ESCAPE_CONFIRM_WINDOW_MS,
            className: 'whitespace-nowrap'
          }
        )
        return
      }
      void closeSettingsPageWithPromptGuard()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeSectionId, closeSettingsPageWithPromptGuard])

  // Why: route window close/quit through the discard dialog; a bare beforeunload veto shows no UI and reads as an unquittable window.
  useEffect(() => {
    return registerWindowCloseGuard(() => {
      if (isIntentionalAppRestartInProgress()) {
        return true
      }
      if (!hasUnsavedSourceControlAiPromptChangesRef.current) {
        return true
      }
      return promptDiscardSourceControlAiPromptChanges()
    })
  }, [promptDiscardSourceControlAiPromptChanges])

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) {
        return
      }
      if (!keybindingMatchesAction('settings.search', event, getShortcutPlatform(), keybindings)) {
        return
      }
      const input = searchInputRef.current
      if (!input) {
        return
      }
      event.preventDefault()
      input.focus()
      input.select()
    }

    document.addEventListener('keydown', handleFindShortcut)
    return () => document.removeEventListener('keydown', handleFindShortcut)
  }, [keybindings])

  useEffect(() => {
    if (!settings || !settingsNavigationTarget) {
      return
    }

    const paneSectionId = getSettingsSectionId(
      settingsNavigationTarget.pane,
      settingsNavigationTarget.repoId,
      repoIdToRepresentative
    )
    // Why: select the target repo's host before scrolling so its host-specific subsection anchor renders and the scroll lands.
    const targetRepoId = resolveSettingsTargetRepoId(
      settingsNavigationTarget,
      repoIdToHostSelection.keys()
    )
    if (targetRepoId) {
      const hostSelection = settingsNavigationTarget.hostId
        ? getSettingsTargetHostSelection(
            settingsProjectList,
            targetRepoId,
            settingsNavigationTarget.hostId
          )
        : repoIdToHostSelection.get(targetRepoId)
      if (hostSelection) {
        setSettingsProjectHostSelection(
          hostSelection.projectId,
          hostSelection.hostId,
          'setupId' in hostSelection && typeof hostSelection.setupId === 'string'
            ? hostSelection.setupId
            : undefined
        )
      }
    }
    pendingNavSectionRef.current = paneSectionId
    pendingScrollTargetRef.current = settingsNavigationTarget.sectionId ?? paneSectionId
    // Why: ensure Appearance's nested status-bar section is open before scrolling so the row is visible.
    if (settingsNavigationTarget.pane === 'appearance') {
      const accordion = resolveAppearanceAccordionDeepLink(settingsNavigationTarget.sectionId)
      if (accordion) {
        useAppStore.getState().setAppearanceAccordionDeepLink(accordion)
      }
    }
    if (settingsNavigationTarget.intent === 'add-quick-command') {
      setQuickCommandAddIntentSignal((signal) => signal + 1)
    } else if (settingsNavigationTarget.intent === 'add-ssh-host') {
      setSshHostAddIntentSignal((signal) => signal + 1)
    } else if (settingsNavigationTarget.intent === 'add-remote-orca-server') {
      setRemoteServerAddIntentSignal((signal) => signal + 1)
    }
    setMountedSectionIds((previous) => {
      if (previous.has(paneSectionId)) {
        return previous
      }
      return new Set(previous).add(paneSectionId)
    })
    // Why: bump state so the scroll effect runs even when the visible section set is unchanged (target is kept in refs).
    setPendingNavRequestTick((tick) => tick + 1)
    clearSettingsTarget()
  }, [
    clearSettingsTarget,
    repoIdToHostSelection,
    repoIdToRepresentative,
    setSettingsProjectHostSelection,
    settings,
    settingsProjectList,
    settingsNavigationTarget
  ])


  return {
    writeSourceControlAiSettings,
    setSettingsRootNode,
    setContentScrollNode,
    requestFontSuggestions,
    promptDiscardSourceControlAiPromptChanges,
    confirmDiscardSourceControlAiPromptChanges,
    closeSettingsPageWithPromptGuard
  }
}
