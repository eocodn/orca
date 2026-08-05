import { useMemo, useRef, useState } from 'react'
import type { OrcaHooks } from '../../../../shared/types'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import { isMacUserAgent, isWindowsUserAgent } from '@/components/terminal-pane/pane-helpers'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import {
  SCROLLBACK_PRESETS_ROWS,
  getFallbackTerminalFonts,
  mergeFontSuggestions
} from './SettingsConstants'
import { DEFAULT_APP_FONT_FAMILY } from '../../../../shared/constants'
import { useGhosttyImport } from './useGhosttyImport'
import { useWarpThemeImport } from './useWarpThemeImport'
import { getInitialMountedSectionIds } from './settings-load-performance'
import { LINEAR_AGENT_SKILL_NAMES } from '@/lib/agent-feature-install-commands'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkillNames
} from '@/hooks/useInstalledAgentSkills'
import { useActiveProjectSkillRuntime } from '@/hooks/useActiveProjectSkillRuntime'
import { useLinearProviderConnected } from '@/hooks/useLinearProviderConnected'
import { useSkillFreshness } from '@/hooks/useSkillFreshness'

export function useSettingsPageRuntimeState({
  settings,
  updateSettings
}: {
  settings: any
  updateSettings: (...args: any[]) => any
}): Record<string, any> {
  const [repoHooksMap, setRepoHooksMap] = useState<
    Record<string, { hasHooks: boolean; hooks: OrcaHooks | null; mayNeedUpdate: boolean }>
  >({})
  const systemPrefersDark = useSystemPrefersDark()
  const isWindows = isWindowsUserAgent()
  const isMac = isMacUserAgent()
  const linearConnected = useLinearProviderConnected()
  const activeSkillRuntime = useActiveProjectSkillRuntime()
  const linearSkill = useInstalledAgentSkillNames(LINEAR_AGENT_SKILL_NAMES, {
    enabled: linearConnected,
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })
  const skillFreshnessApplies = activeSkillRuntime.canUseLocalSkillFreshness
  const { inventory: skillFreshnessInventory } = useSkillFreshness(skillFreshnessApplies)
  const [scrollbackMode, setScrollbackMode] = useState<'preset' | 'custom'>('preset')
  const [prevScrollbackRows, setPrevScrollbackRows] = useState(settings?.terminalScrollbackRows)
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
  const hasUnsavedSourceControlAiPromptChangesRef = useRef(hasUnsavedSourceControlAiPromptChanges)
  hasUnsavedSourceControlAiPromptChangesRef.current = hasUnsavedSourceControlAiPromptChanges

  return {
    repoHooksMap,
    setRepoHooksMap,
    systemPrefersDark,
    isWindows,
    isMac,
    linearConnected,
    linearSkill,
    skillFreshnessApplies,
    skillFreshnessInventory,
    scrollbackMode,
    setScrollbackMode,
    prevScrollbackRows,
    setPrevScrollbackRows,
    ghostty,
    warpThemes,
    fontSuggestions,
    setFontSuggestions,
    terminalFontSuggestions,
    activeSectionId,
    setActiveSectionId,
    mountedSectionIds,
    setMountedSectionIds,
    pendingNavRequestTick,
    setPendingNavRequestTick,
    quickCommandAddIntentSignal,
    setQuickCommandAddIntentSignal,
    sshHostAddIntentSignal,
    setSshHostAddIntentSignal,
    remoteServerAddIntentSignal,
    setRemoteServerAddIntentSignal,
    hasUnsavedCommitPromptChanges,
    setHasUnsavedCommitPromptChanges,
    hasUnsavedBranchPromptChanges,
    setHasUnsavedBranchPromptChanges,
    sourceControlAiPromptDiscardSignal,
    setSourceControlAiPromptDiscardSignal,
    confirm,
    hiddenExperimentalUnlocked,
    setHiddenExperimentalUnlocked,
    contentScrollRef,
    searchInputRef,
    installedFontsLoadedRef,
    installedFontsLoadPromiseRef,
    settingsMountedRef,
    pendingNavSectionRef,
    pendingScrollTargetRef,
    pendingSubsectionScrollFrameRef,
    repoHooksRequestSeqRef,
    shortcutsEscapeConfirmUntilRef,
    sourceControlAiWriteQueueRef,
    hasUnsavedSourceControlAiPromptChanges,
    hasUnsavedSourceControlAiPromptChangesRef,
    scrollbackPresets: SCROLLBACK_PRESETS_ROWS
  }
}
