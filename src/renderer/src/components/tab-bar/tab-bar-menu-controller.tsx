import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectExecutionRuntimeResolution } from '../../../../shared/project-execution-runtime'
import type { TuiAgent } from '../../../../shared/types'
import { useAppStore } from '../../store'
import { buildTabAgentLaunchOptions, orderTabLaunchAgents } from './tab-agent-launch-options'
import { buildTabCreateMenuOptions, type TabCreateMenuOption } from './tab-create-menu-options'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import {
  getWindowsTerminalCapabilityOwnerKey,
  useWindowsTerminalCapabilities
} from '@/lib/windows-terminal-capabilities'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { getConnectionIdFromState } from '@/lib/connection-context'
import { translate } from '@/i18n/i18n'
import {
  type BuiltInWindowsTerminalShell,
  WINDOWS_GIT_BASH_SHELL
} from '../../../../shared/windows-terminal-shell'
import { resolveWindowsShellLaunchTarget } from './windows-shell-launch'
import { shouldShowWindowsShellMenu } from './windows-shell-menu-visibility'
import { resolveTabBarLocalProjectRuntime } from './tab-bar-shell-runtime'
import { toast } from 'sonner'

const isWindows = navigator.userAgent.includes('Windows')
const RETRY_MS = 50
const FOCUS_TIMEOUT_MS = 5000
const EMPTY_AGENT_CMD_OVERRIDES: Partial<Record<TuiAgent, string>> = {}

function getProjectRuntimeShellMenuMode(
  projectRuntime: ProjectExecutionRuntimeResolution | undefined
): 'host' | 'wsl' | null {
  if (!projectRuntime) {
    return null
  }
  if (projectRuntime.status === 'repair-required') {
    return 'wsl'
  }
  return projectRuntime.runtime.kind === 'wsl' ? 'wsl' : 'host'
}

export function useTabBarMenuController(args: {
  worktreeId: string
  resolvedGroupId: string
  onNewTerminalTab: () => void
  onNewTerminalWithShell?: (shell: string) => void
  onNewBrowserTab: () => void
  onNewFileTab?: () => void
  onOpenFileTab?: () => void
  terminalOnly: boolean
}) {
  const {
    worktreeId,
    resolvedGroupId,
    onNewTerminalTab,
    onNewTerminalWithShell,
    onNewBrowserTab,
    onNewFileTab,
    onOpenFileTab,
    terminalOnly
  } = args
  const defaultWindowsShell = useAppStore(
    (s) => s.settings?.terminalWindowsShell ?? 'powershell.exe'
  )
  const defaultWindowsPowerShellImplementation = useAppStore(
    (s) => s.settings?.terminalWindowsPowerShellImplementation ?? 'auto'
  )
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const projects = useAppStore((s) => s.projects)
  const repos = useAppStore((s) => s.repos)
  const settings = useAppStore((s) => s.settings)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const activeRuntimeEnvironmentId = useAppStore(
    (s) => getRuntimeEnvironmentIdForWorktree(s, worktreeId)?.trim() || null
  )
  const worktreeConnectionId = useAppStore(
    (s) => getConnectionIdFromState(s, worktreeId)?.trim() || null
  )
  const worktreeRemotePlatform = useAppStore((s) =>
    worktreeConnectionId
      ? (s.sshConnectionStates.get(worktreeConnectionId)?.remotePlatform ?? null)
      : null
  )
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const agentCmdOverrides = useAppStore(
    (s) => s.settings?.agentCmdOverrides ?? EMPTY_AGENT_CMD_OVERRIDES
  )
  const agentDetectionTarget = useAgentDetectionTargetForWorktree(worktreeId)
  const { detectedIds } = useDetectedAgents(agentDetectionTarget)
  const agentLaunchOptions = useMemo(
    () =>
      buildTabAgentLaunchOptions(
        orderTabLaunchAgents(defaultAgent, detectedIds ?? []),
        agentCmdOverrides
      ),
    [agentCmdOverrides, defaultAgent, detectedIds]
  )
  const isWebClient = (globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__ === true
  const runtimeTarget = useMemo(
    () => getActiveRuntimeTarget({ activeRuntimeEnvironmentId }),
    [activeRuntimeEnvironmentId]
  )
  const windowsTerminalCapabilities = useWindowsTerminalCapabilities(
    isWindows ||
      Boolean(activeRuntimeEnvironmentId?.trim()) ||
      isWebClient ||
      Boolean(worktreeConnectionId),
    false,
    getWindowsTerminalCapabilityOwnerKey(activeRuntimeEnvironmentId, worktreeConnectionId),
    runtimeTarget,
    worktreeConnectionId
  )
  const showWindowsShellMenu = shouldShowWindowsShellMenu({
    activeRuntimeEnvironmentId,
    hostPlatform: worktreeConnectionId
      ? (worktreeRemotePlatform ?? windowsTerminalCapabilities.hostPlatform)
      : windowsTerminalCapabilities.hostPlatform,
    isWindowsClient: isWindows,
    worktreeHasRemoteConnection: Boolean(worktreeConnectionId)
  })
  const localProjectRuntime = useMemo(() => {
    return resolveTabBarLocalProjectRuntime({
      showWindowsShellMenu,
      activeRuntimeEnvironmentId,
      worktreeConnectionId,
      activeRepoId,
      activeWorktreeId,
      projects,
      repos,
      settings,
      worktreesByRepo,
      worktreeId,
      wslAvailable: windowsTerminalCapabilities.wslAvailable,
      availableWslDistros: windowsTerminalCapabilities.wslDistros,
      loading: windowsTerminalCapabilities.isLoading
    })
  }, [
    activeRepoId,
    activeRuntimeEnvironmentId,
    activeWorktreeId,
    projects,
    repos,
    settings,
    showWindowsShellMenu,
    worktreeConnectionId,
    windowsTerminalCapabilities.isLoading,
    windowsTerminalCapabilities.wslAvailable,
    windowsTerminalCapabilities.wslDistros,
    worktreeId,
    worktreesByRepo
  ])
  const projectRuntimeShellMenuMode = getProjectRuntimeShellMenuMode(localProjectRuntime)
  const windowsShellEntries = useMemo(() => {
    if (!showWindowsShellMenu || !onNewTerminalWithShell) {
      return undefined
    }
    const allShells: { label: string; shell: BuiltInWindowsTerminalShell }[] = []
    if (projectRuntimeShellMenuMode !== 'wsl') {
      allShells.push(
        {
          label: translate('auto.components.tab.bar.TabBar.2148f65e04', 'PowerShell'),
          shell: 'powershell.exe'
        },
        {
          label: translate('auto.components.tab.bar.TabBar.1a8af49530', 'CMD Prompt'),
          shell: 'cmd.exe'
        }
      )
      if (windowsTerminalCapabilities.gitBashAvailable) {
        allShells.push({
          label: translate('auto.components.tab.bar.TabBar.efb33546ff', 'Git Bash'),
          shell: WINDOWS_GIT_BASH_SHELL
        })
      }
    }
    if (projectRuntimeShellMenuMode !== 'host' && windowsTerminalCapabilities.wslAvailable) {
      allShells.push({
        label: translate('auto.components.tab.bar.TabBar.d1afac112b', 'WSL'),
        shell: 'wsl.exe'
      })
    }
    if (allShells.length === 0) {
      return undefined
    }
    const defaultEntry =
      allShells.find((shell) => shell.shell === defaultWindowsShell) ?? allShells[0]
    return [defaultEntry, ...allShells.filter((shell) => shell.shell !== defaultEntry.shell)].map(
      (entry) => ({ label: entry.label, shell: entry.shell })
    )
  }, [
    defaultWindowsShell,
    onNewTerminalWithShell,
    projectRuntimeShellMenuMode,
    showWindowsShellMenu,
    windowsTerminalCapabilities.gitBashAvailable,
    windowsTerminalCapabilities.wslAvailable
  ])
  const createMenuOptions = useMemo(
    () =>
      buildTabCreateMenuOptions({
        terminalOnly,
        windowsShellEntries,
        hasNewBrowser: !terminalOnly,
        hasNewMarkdown: !terminalOnly && Boolean(onNewFileTab),
        hasOpenMarkdown: !terminalOnly && Boolean(onOpenFileTab)
      }),
    [onNewFileTab, onOpenFileTab, terminalOnly, windowsShellEntries]
  )
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false)
  const [createMenuQuery, setCreateMenuQuery] = useState('')
  const pendingFocus = useRef<(() => void) | null>(null)
  const animation = useRef<number | null>(null)
  const retry = useRef<number | null>(null)
  const clearAnimation = (): void => {
    if (animation.current !== null) {
      cancelAnimationFrame(animation.current)
      animation.current = null
    }
  }
  const clearRetry = (): void => {
    if (retry.current !== null) {
      window.clearTimeout(retry.current)
      retry.current = null
    }
  }
  const focusNewTerminal = (previous: string | null, expires: number): void => {
    const state = useAppStore.getState()
    if (state.activeTabType === 'terminal' && state.activeTabId && state.activeTabId !== previous) {
      focusTerminalTabSurface(state.activeTabId)
      return
    }
    if (Date.now() >= expires) {
      return
    }
    retry.current = window.setTimeout(() => {
      retry.current = null
      focusNewTerminal(previous, expires)
    }, RETRY_MS)
  }
  const queueNewActiveTerminalFocusAfterNewTabMenuClose = (): void => {
    const previous = useAppStore.getState().activeTabId
    pendingFocus.current = () => focusNewTerminal(previous, Date.now() + FOCUS_TIMEOUT_MS)
  }
  const queueTerminalTabFocusAfterNewTabMenuClose = (tabId: string): void => {
    pendingFocus.current = () => focusTerminalTabSurface(tabId)
  }
  const handleSelectCreateMenuOption = (option: TabCreateMenuOption): void => {
    switch (option.kind) {
      case 'new-terminal':
        queueNewActiveTerminalFocusAfterNewTabMenuClose()
        onNewTerminalTab()
        break
      case 'new-terminal-shell':
        if (onNewTerminalWithShell && option.shell) {
          queueNewActiveTerminalFocusAfterNewTabMenuClose()
          onNewTerminalWithShell(
            resolveWindowsShellLaunchTarget(
              option.shell,
              defaultWindowsPowerShellImplementation,
              windowsTerminalCapabilities.pwshAvailable
            )
          )
        }
        break
      case 'new-browser':
        onNewBrowserTab()
        break
      case 'new-markdown':
        onNewFileTab?.()
        break
      case 'open-markdown':
        onOpenFileTab?.()
        break
    }
  }
  const launchAgentFromNewTabEntry = (agent: TuiAgent): void => {
    const option = agentLaunchOptions.find((candidate) => candidate.agent === agent)
    const result = launchAgentInNewTab({
      agent,
      worktreeId,
      groupId: resolvedGroupId,
      launchSource: 'tab_bar_quick_launch'
    })
    if (!result) {
      toast.error(
        translate(
          'auto.components.tab.bar.TabBar.ab589350e5',
          'Could not build launch command for {{value0}}.',
          { value0: option?.label ?? agent }
        )
      )
      return
    }
    if (result.tabId) {
      queueTerminalTabFocusAfterNewTabMenuClose(result.tabId)
    } else {
      queueNewActiveTerminalFocusAfterNewTabMenuClose()
    }
  }
  const runPendingNewTabMenuFocusAfterClose = (): void => {
    const focus = pendingFocus.current
    pendingFocus.current = null
    clearAnimation()
    clearRetry()
    if (focus) {
      animation.current = requestAnimationFrame(() => {
        animation.current = null
        focus()
      })
    }
  }
  const clearPendingNewTabMenuFocusOnUnmountRef = useRef<
    ((node: HTMLDivElement | null) => void) | null
  >(null)
  if (clearPendingNewTabMenuFocusOnUnmountRef.current === null) {
    clearPendingNewTabMenuFocusOnUnmountRef.current = (node: HTMLDivElement | null): void => {
      if (node === null) {
        clearAnimation()
        clearRetry()
      }
    }
  }
  const clearPendingNewTabMenuFocusOnUnmount = clearPendingNewTabMenuFocusOnUnmountRef.current
  useEffect(() => {
    if (newTabMenuOpen) {
      const dismiss = (): void => setNewTabMenuOpen(false)
      window.addEventListener('blur', dismiss)
      return () => window.removeEventListener('blur', dismiss)
    }
  }, [newTabMenuOpen])
  useEffect(() => {
    if (!newTabMenuOpen) {
      setCreateMenuQuery('')
    }
  }, [newTabMenuOpen])
  return {
    agentLaunchOptions,
    windowsShellEntries,
    createMenuOptions,
    defaultWindowsPowerShellImplementation,
    windowsTerminalCapabilities,
    newTabMenuOpen,
    setNewTabMenuOpen,
    createMenuQuery,
    setCreateMenuQuery,
    showStaticCreateMenuItems: createMenuQuery.trim().length === 0,
    queueNewActiveTerminalFocusAfterNewTabMenuClose,
    queueTerminalTabFocusAfterNewTabMenuClose,
    handleSelectCreateMenuOption,
    launchAgentFromNewTabEntry,
    runPendingNewTabMenuFocusAfterClose,
    clearPendingNewTabMenuFocusOnUnmount
  }
}
