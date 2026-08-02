// Concrete settings page view and orchestration.
// Concrete surface implementation for Settings.tsx
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { toast } from 'sonner'
import type { GlobalSettings, OrcaHooks, ProjectHostSetup, Repo } from '../../../../shared/types'
import type {
  SourceControlAiSettings,
  SourceControlAiSettingsPatch
} from '../../../../shared/source-control-ai-types'
import { useAppStore } from '../../store'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import { isMacUserAgent, isWindowsUserAgent } from '@/components/terminal-pane/pane-helpers'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import {
  SCROLLBACK_PRESETS_ROWS,
  getFallbackTerminalFonts,
  mergeFontSuggestions
} from './SettingsConstants'
import { DEFAULT_APP_FONT_FAMILY, getDefaultVoiceSettings } from '../../../../shared/constants'
import { useGhosttyImport } from './useGhosttyImport'
import { useWarpThemeImport } from './useWarpThemeImport'
import { resolveAppearanceAccordionDeepLink } from './appearance-usage-percentage-search'
import { isIntentionalAppRestartInProgress } from '@/lib/updater-beforeunload'
import { useSettingsPageNavigation } from './settings-page-navigation-state'
import { SettingsPageRender } from './settings-page-render'
import { registerWindowCloseGuard } from '../window-close-request-coordinator'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import {
  isWebClientLocation,
  useSettingsNavigationMetadata
} from '@/hooks/useSettingsNavigationMetadata'
import type {
  SettingsNavGroup,
  SettingsNavInstallStatus,
  SettingsNavSection,
  SettingsNavTarget
} from '@/lib/settings-navigation-types'
import {
  COMPUTER_USE_SKILL_NAME,
  LINEAR_AGENT_SKILL_NAMES,
  ORCHESTRATION_SKILL_NAME
} from '@/lib/agent-feature-install-commands'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkill,
  useInstalledAgentSkillNames
} from '@/hooks/useInstalledAgentSkills'
import { useActiveProjectSkillRuntime } from '@/hooks/useActiveProjectSkillRuntime'
import { useLinearProviderConnected } from '@/hooks/useLinearProviderConnected'
import { useSkillFreshness } from '@/hooks/useSkillFreshness'
import { deriveNeededSectionIds, getInitialMountedSectionIds } from './settings-load-performance'
import { translate } from '@/i18n/i18n'
import {
  buildRepoIdToHostSelection,
  buildRepoIdToRepresentative,
  buildSettingsProjectList,
  getSettingsProjectHostRepo,
  getSettingsTargetHostSelection,
  removeSettingsProjectFromAllHosts,
  resolveSettingsTargetRepoId
} from './settings-project-list'

import {
  DevToolsPane,
  SHORTCUTS_ESCAPE_CONFIRM_TOAST_ID,
  SHORTCUTS_ESCAPE_CONFIRM_WINDOW_MS,
  getSettingsSectionId,
  getFallbackVisibleSection,
  getSettingsNavGroupDefinitionsForSearch,
  hasReadyVoiceModel,
  getSettingsScrollTarget,
  scrollSubsectionIntoView,
  readSourceControlAiSettings,
  cancelPendingSettingsSubsectionScrollFrame,
  isEditableTarget
} from './settings-navigation-model'
function Settings(): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const keybindings = useAppStore((s) => s.keybindings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const updateSettingsOrThrow = useAppStore((s) => s.updateSettingsOrThrow)
  const setActiveRuntimeEnvironmentPreference = useAppStore(
    (s) => s.setActiveRuntimeEnvironmentPreference
  )
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const fetchKeybindings = useAppStore((s) => s.fetchKeybindings)
  const closeSettingsPage = useAppStore((s) => s.closeSettingsPage)
  const repos = useAppStore((s) => s.repos)
  const projects = useAppStore((s) => s.projects)
  const projectHostSetups = useAppStore((s) => s.projectHostSetups)
  const updateProject = useAppStore((s) => s.updateProject)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const removeProject = useAppStore((s) => s.removeProject)
  const settingsNavigationTarget = useAppStore((s) => s.settingsNavigationTarget)
  const clearSettingsTarget = useAppStore((s) => s.clearSettingsTarget)
  const settingsProjectHostSelection = useAppStore((s) => s.settingsProjectHostSelection)
  const settingsProjectSetupSelection = useAppStore((s) => s.settingsProjectSetupSelection)
  const setSettingsProjectHostSelection = useAppStore((s) => s.setSettingsProjectHostSelection)
  const settingsSearchInputQuery = useAppStore((s) => s.settingsSearchInputQuery)
  const settingsSearchQuery = useAppStore((s) => s.settingsSearchQuery)
  const setSettingsSearchQuery = useAppStore((s) => s.setSettingsSearchQuery)
  const modelStates = useAppStore((s) => s.modelStates)
  const refreshModelStates = useAppStore((s) => s.refreshModelStates)

  // Why: one entry per project (derived from repos to match nav metadata) — the source of truth for the pane list.
  const settingsProjectList = useMemo(() => buildSettingsProjectList(repos), [repos])
  const repoIdToRepresentative = useMemo(
    () => buildRepoIdToRepresentative(settingsProjectList),
    [settingsProjectList]
  )
  // Why: lets a deep-link's repoId select the owning project's host so host-specific subsection anchors exist.
  const repoIdToHostSelection = useMemo(
    () => buildRepoIdToHostSelection(settingsProjectList),
    [settingsProjectList]
  )
  // Why: pane-level "Remove Project" removes every host setup, not just the selected host (per-host remove lives in "Available Hosts").
  const removeProjectAllHosts = useCallback(
    (setups: readonly ProjectHostSetup[]): Promise<void> =>
      removeSettingsProjectFromAllHosts(setups, removeProject),
    [removeProject]
  )

  const [repoHooksMap, setRepoHooksMap] = useState<
    Record<string, { hasHooks: boolean; hooks: OrcaHooks | null; mayNeedUpdate: boolean }>
  >({})
  const systemPrefersDark = useSystemPrefersDark()
  const isWindows = isWindowsUserAgent()
  const isMac = isMacUserAgent()
  const isWebClient = isWebClientLocation()
  const showDesktopOnlySettings = !isWebClient
  // Why: mirror the nav registry's gate so the Linear sidebar entry and section appear/disappear together.
  const linearConnected = useLinearProviderConnected()
  const activeSkillRuntime = useActiveProjectSkillRuntime()
  const orchestrationSkill = useInstalledAgentSkill(ORCHESTRATION_SKILL_NAME, {
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const linearSkill = useInstalledAgentSkillNames(LINEAR_AGENT_SKILL_NAMES, {
    enabled: linearConnected,
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const computerUseSkill = useInstalledAgentSkill(COMPUTER_USE_SKILL_NAME, {
    enabled: showDesktopOnlySettings,
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const skillFreshnessApplies = activeSkillRuntime.canUseLocalSkillFreshness
  const { inventory: skillFreshnessInventory } = useSkillFreshness(skillFreshnessApplies)
  const [voiceModelStatesLoading, setVoiceModelStatesLoading] = useState(showDesktopOnlySettings)
  // Why: trim platform-only Terminal entries from the shared search index so search never reveals hidden controls.
  const [scrollbackMode, setScrollbackMode] = useState<'preset' | 'custom'>('preset')
  const [prevScrollbackRows, setPrevScrollbackRows] = useState(settings?.terminalScrollbackRows)
  // Why: keep Ghostty import state at Settings level so the modal survives section remounts.
  const ghostty = useGhosttyImport(updateSettings, settings)
  const warpThemes = useWarpThemeImport(updateSettings, settings)
  const [fontSuggestions, setFontSuggestions] = useState<string[]>(
    mergeFontSuggestions([], getFallbackTerminalFonts())
  )
  const terminalFontSuggestions = useMemo(
    () => fontSuggestions.filter((font) => font !== DEFAULT_APP_FONT_FAMILY),
    [fontSuggestions]
  )
  const [activeSectionId, setActiveSectionId] = useState('general')
  const [mountedSectionIds, setMountedSectionIds] = useState<Set<string>>(
    getInitialMountedSectionIds
  )
  const [pendingNavRequestTick, setPendingNavRequestTick] = useState(0)
  const [quickCommandAddIntentSignal, setQuickCommandAddIntentSignal] = useState(0)
  const [sshHostAddIntentSignal, setSshHostAddIntentSignal] = useState(0)
  const [remoteServerAddIntentSignal, setRemoteServerAddIntentSignal] = useState(0)
  const [hasUnsavedCommitPromptChanges, setHasUnsavedCommitPromptChanges] = useState(false)
  const [hasUnsavedBranchPromptChanges, setHasUnsavedBranchPromptChanges] = useState(false)
  const [sourceControlAiPromptDiscardSignal, setSourceControlAiPromptDiscardSignal] = useState(0)
  const confirm = useConfirmationDialog()
  // Why: session-only (deliberately not persisted) unlock — Shift-click the Experimental entry reveals the hidden group.
  const [hiddenExperimentalUnlocked, setHiddenExperimentalUnlocked] = useState(false)
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const installedFontsLoadedRef = useRef(false)
  const installedFontsLoadPromiseRef = useRef<Promise<void> | null>(null)
  const settingsMountedRef = useRef(true)
  const pendingNavSectionRef = useRef<string | null>(null)
  const pendingScrollTargetRef = useRef<string | null>(null)
  const pendingSubsectionScrollFrameRef = useRef<number | null>(null)
  const repoHooksRequestSeqRef = useRef(0)
  const shortcutsEscapeConfirmUntilRef = useRef(0)
  const sourceControlAiWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

  const hasUnsavedSourceControlAiPromptChanges =
    hasUnsavedCommitPromptChanges || hasUnsavedBranchPromptChanges
  // Why: the close guard registers once, so it reads latest dirty state from a ref instead of a lagging closure.
  const hasUnsavedSourceControlAiPromptChangesRef = useRef(hasUnsavedSourceControlAiPromptChanges)
  hasUnsavedSourceControlAiPromptChangesRef.current = hasUnsavedSourceControlAiPromptChanges

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
    if (!showDesktopOnlySettings) {
      setVoiceModelStatesLoading(false)
      return
    }
    let canceled = false
    // Why: modelStates starts empty, so Voice shouldn't look missing before the first speech-model scan reports state.
    setVoiceModelStatesLoading(true)
    void refreshModelStates().finally(() => {
      if (!canceled) {
        setVoiceModelStatesLoading(false)
      }
    })
    return () => {
      canceled = true
    }
  }, [refreshModelStates, showDesktopOnlySettings])

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

  // Why: recompute scrollback mode only when the row value changes, not on every settings mutation.
  if (settings?.terminalScrollbackRows !== prevScrollbackRows) {
    setPrevScrollbackRows(settings?.terminalScrollbackRows)
    if (settings) {
      setScrollbackMode(
        SCROLLBACK_PRESETS_ROWS.includes(
          settings.terminalScrollbackRows as (typeof SCROLLBACK_PRESETS_ROWS)[number]
        )
          ? 'preset'
          : 'custom'
      )
    }
  }

  const settingsNavigation = useSettingsPageNavigation({
    settings,
    repos,
    projects,
    projectHostSetups,
    settingsProjectHostSelection,
    settingsProjectSetupSelection,
    settingsSearchQuery,
    setSettingsSearchQuery,
    modelStates,
    settingsProjectList,
    setRepoHooksMap,
    isWindows,
    isWebClient,
    showDesktopOnlySettings,
    linearConnected,
    orchestrationSkill,
    linearSkill,
    computerUseSkill,
    skillFreshnessApplies,
    voiceModelStatesLoading,
    activeSectionId,
    setActiveSectionId,
    mountedSectionIds,
    setMountedSectionIds,
    pendingNavRequestTick,
    setPendingNavRequestTick,
    setHiddenExperimentalUnlocked,
    contentScrollRef,
    pendingNavSectionRef,
    pendingScrollTargetRef,
    pendingSubsectionScrollFrameRef,
    repoHooksRequestSeqRef,
    hasUnsavedSourceControlAiPromptChanges,
    confirmDiscardSourceControlAiPromptChanges,  })
  const {
    applyTheme,
    baseNavSections,
    navSections,
    navSectionById,
    getSectionSearchEntries,
    visibleNavSections,
    visibleSectionIds,
    projectByRepoId,
    neededSectionIds,
    windowsTerminalCapabilities,
    localWindowsRuntimeCapabilities,
    localWslSupportedPlatform,
    isWindowsTerminalHost,
    neededRepos,
    scrollToSection,
    openComputerUseFromBrowser,  } = settingsNavigation
  if (!settings) {
    return (
      <div
        ref={setSettingsRootNode}
        className="settings-view-shell flex min-h-0 flex-1 overflow-hidden bg-background"
      >
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          {translate('auto.components.settings.Settings.c7ad095d96', 'Loading settings...')}
        </div>
      </div>
    )
  }

  const generalNavSections = visibleNavSections.filter((section) => !section.id.startsWith('repo-'))
  const generalNavGroupDefinitions = getSettingsNavGroupDefinitionsForSearch(
    visibleNavSections,
    settingsSearchQuery
  )
  const generalNavGroups: SettingsNavGroup[] = generalNavGroupDefinitions
    .map((group) => ({
      id: group.id,
      title: translate(group.titleKey, group.titleDefault),
      sections: generalNavSections.filter((section) => section.group === group.id)
    }))
    .filter((group) => group.sections.length > 0 || group.id === 'setup')
  const repoNavSections = visibleNavSections
    .filter((section) => section.id.startsWith('repo-'))
    .map((section) => {
      const repo = repos.find((entry) => entry.id === section.id.replace('repo-', ''))
      return {
        ...section,
        badgeColor: repo?.badgeColor,
        isRemote: !!repo?.connectionId,
        repoIcon: repo?.repoIcon,
        upstream: repo?.upstream
      }
    })
  const isSectionMounted = (sectionId: string): boolean => neededSectionIds.has(sectionId)
  const isFocusedShortcutsPane =
    activeSectionId === 'shortcuts' && settingsSearchQuery.trim() === ''
  const isFocusedSetupGuidePane =
    activeSectionId === 'setup-guide' && settingsSearchQuery.trim() === ''

  const settingsViewContext = {
    settings,
    updateSettings,
    updateSettingsOrThrow,
    setActiveRuntimeEnvironmentPreference,
    repos,
    updateProject,
    updateRepo,
    removeProject,
    settingsProjectHostSelection,
    settingsProjectSetupSelection,
    settingsSearchInputQuery,
    settingsSearchQuery,
    setSettingsSearchQuery,
    settingsProjectList,
    removeProjectAllHosts,
    repoHooksMap,
    systemPrefersDark,
    isMac,
    isWebClient,
    showDesktopOnlySettings,
    linearConnected,
    scrollbackMode,
    setScrollbackMode,
    ghostty,
    warpThemes,
    fontSuggestions,
    terminalFontSuggestions,
    activeSectionId,
    quickCommandAddIntentSignal,
    sshHostAddIntentSignal,
    remoteServerAddIntentSignal,
    setHasUnsavedCommitPromptChanges,
    hasUnsavedBranchPromptChanges,
    setHasUnsavedBranchPromptChanges,
    sourceControlAiPromptDiscardSignal,
    hiddenExperimentalUnlocked,
    searchInputRef,
    hasUnsavedSourceControlAiPromptChanges,
    writeSourceControlAiSettings,
    setSettingsRootNode,
    setContentScrollNode,
    requestFontSuggestions,
    closeSettingsPageWithPromptGuard,
    generalNavGroups,
    repoNavSections,
    isSectionMounted,
    isFocusedShortcutsPane,
    isFocusedSetupGuidePane,  }
  return <SettingsPageRender context={settingsViewContext} />
}

export default Settings
