// Concrete surface implementation for StatusBar.tsx
import {   AlertTriangle,   Activity,   RotateCcw,   Plug,   ChevronDown,   ChevronRight,   Loader2,   PanelsTopLeft,   RefreshCw,   Server } from 'lucide-react' import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react' import { lazyWithRetry } from '@/lib/lazy-with-retry' import { Button } from '@/components/ui/button' import { Checkbox } from '@/components/ui/checkbox' import {   Dialog,   DialogContent,   DialogDescription,   DialogFooter,   DialogHeader,   DialogTitle } from '@/components/ui/dialog' import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip' import {   DropdownMenu,   DropdownMenuCheckboxItem,   DropdownMenuContent,   DropdownMenuItem,   DropdownMenuLabel,   DropdownMenuSeparator,   DropdownMenuSub,   DropdownMenuSubContent,   DropdownMenuSubTrigger,   DropdownMenuTrigger } from '@/components/ui/dropdown-menu' import { useAppStore } from '../../store' import { selectFloatingWorkspaceHasUnread } from '../../store/selectors' import type {   ClaudeRateLimitAccountsState,   CodexRateLimitAccountsState,   GlobalSettings } from '../../../../shared/types' import type {   ProviderRateLimits,   RateLimitRuntimeTarget,   RateLimitWindow } from '../../../../shared/rate-limit-types' import { resolveLocalAccountRuntimeTarget } from '../../../../shared/local-account-runtime' import { getRendererAppPlatform } from '../../lib/renderer-app-platform' import {   ProviderIcon,   ProviderPanel,   barColor,   clampUsedPercent,   formatResetCreditExpiry,   getProviderDisplayName,   getProviderUsageStatusLabel } from './tooltip' import { ClaudeIcon, GeminiIcon, MiniMaxIcon, OpenAIIcon, OpenCodeGoIcon } from './icons' import { AgentIcon } from '@/lib/agent-catalog' import { UsageRosterPanel, getTightestUsageSection } from './UsageRosterPanel' import { getUsageProviderAccountsSectionId } from './usage-provider-settings-target' import { formatRateLimitWindowChipLabel } from '@/lib/window-label-formatter' import { useResetCountdownClock } from '@/hooks/useResetCountdownClock' import {   markLiveCodexSessionsForRestart,   resolveCodexRestartPromptAccountLabel } from '@/lib/codex-session-restart' import { UpdateStatusSegment } from './UpdateStatusSegment' import { SkillUpdateStatusSegment } from './SkillUpdateStatusSegment' import { RemoteServerUpdateStatusSegment } from './RemoteServerUpdateStatusSegment' import { isStatusBarItemAvailable } from './status-bar-agent-gating' import { getVisibleUsageProvider, isUsageEmptyState } from './status-bar-provider-visibility' import { StatusBarUsageEmptyCta } from './StatusBarUsageEmptyCta' import { UsagePercentageDisplayChangeNotice } from './UsagePercentageDisplayChangeNotice' import {   STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS,   shouldOpenStatusBarContextMenu } from './status-bar-context-menu-policy' import { TOGGLE_FLOATING_TERMINAL_EVENT } from '@/lib/floating-terminal' import { useShortcutLabel } from '@/hooks/useShortcutLabel' import { FloatingTerminalIconContextMenu } from '@/components/floating-terminal/FloatingTerminalIconContextMenu' import { summarizeCodexRestartStatus } from './codex-restart-status-summary' import {   getWindowsTerminalCapabilityOwnerKey,   useWindowsTerminalCapabilities } from '@/lib/windows-terminal-capabilities' import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client' import {   fetchProviderAccountsSnapshot,   selectClaudeProviderAccount,   selectCodexProviderAccount } from '@/runtime/runtime-provider-accounts-client' import { translate } from '@/i18n/i18n' import {   getDisplayedUsagePercentage,   normalizeUsagePercentageDisplay,   type UsagePercentageDisplay } from '../../../../shared/usage-percentage-display' import { formatUsagePercentageLabel } from './usage-percentage-label' import {   normalizeStatusBarUsageMode,   type StatusBarUsageMode } from '../../../../shared/status-bar-usage-mode' 
type StatusBarProps = {
  floatingTerminalOpen: boolean
}


import {
  ClaudeSwitcherMenu,
  CodexRestartStatusPrompt,
  CodexSwitcherMenu,
  InlineUsageBars,
  ProviderDetailsMenu,
  ProviderLetterBadge,
  ProviderSegment
} from './status-bar-provider-menus'
import { useStatusBarMenuFocusHandoff } from './status-bar-menu-focus'
const CLOSE_ALL_CONTEXT_MENUS_EVENT = 'orca-close-all-context-menus'

export function StatusBarInner({ floatingTerminalOpen }: StatusBarProps): React.JSX.Element | null {
  const floatingTerminalShortcut = useShortcutLabel('floatingTerminal.toggle')
  const rateLimits = useAppStore((s) => s.rateLimits)
  const settings = useAppStore((s) => s.settings)
  const refreshRateLimits = useAppStore((s) => s.refreshRateLimits)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const usagePercentageDisplay = normalizeUsagePercentageDisplay(
    useAppStore((s) => s.usagePercentageDisplay)
  )
  const statusBarUsageMode = normalizeStatusBarUsageMode(useAppStore((s) => s.statusBarUsageMode))
  const setStatusBarUsageMode = useAppStore((s) => s.setStatusBarUsageMode)
  const [usageMenuOpen, setUsageMenuOpen] = useState(false)
  const usageMenuFocusHandoff = useStatusBarMenuFocusHandoff()
  const statusBarVisible = useAppStore((s) => s.statusBarVisible)
  const statusBarItems = useAppStore((s) => s.statusBarItems)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  // Why: reuse the floating-button's unread dot so activity shows for either trigger location (see FloatingTerminalToggleButton).
  const hasFloatingUnread = useAppStore(selectFloatingWorkspaceHasUnread)
  const floatingTerminalEnabled = settings?.floatingTerminalEnabled === true
  const floatingTerminalTriggerLocation =
    settings?.floatingTerminalTriggerLocation ?? 'floating-button'
  // Why: gate per-CLI bars on PATH detection so an uninstalled agent isn't shown a noisy empty bar (auto re-shows when installed).
  const detectedAgentIds = useAppStore((s) => s.detectedAgentIds)
  const ensureDetectedAgents = useAppStore((s) => s.ensureDetectedAgents)
  // Why: pet segment is driven purely by experimentalPet, not statusBarItems, to avoid double-toggling the surface (see design doc).
  const petEnabled = useAppStore((s) => s.settings?.experimentalPet === true)
  const toggleStatusBarItem = useAppStore((s) => s.toggleStatusBarItem)
  const usageEmptyStateDismissed = useAppStore((s) => s.usageEmptyStateDismissed)
  const containerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 })

  const [containerWidth, setContainerWidth] = useState(900)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const closeMenu = (): void => setMenuOpen(false)
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
  }, [])

  // Why: detect agents on mount so per-CLI usage bars hide when the CLI isn't installed; the slice dedupes concurrent callers.
  useEffect(() => {
    void ensureDetectedAgents()
  }, [ensureDetectedAgents])

  const containerRefCallback = useCallback((node: HTMLDivElement | null) => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect()
      resizeObserverRef.current = null
    }
    if (node) {
      containerRef.current = node
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width)
        }
      })
      observer.observe(node)
      resizeObserverRef.current = observer
      setContainerWidth(node.getBoundingClientRect().width)
    }
  }, [])

  const refreshDetectedAgents = useAppStore((s) => s.refreshDetectedAgents)
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) {
      return
    }
    setIsRefreshing(true)
    try {
      // Why: re-run PATH detection so a freshly-installed/removed CLI's bar appears/hides without restarting Orca.
      await Promise.all([refreshRateLimits(), refreshDetectedAgents()])
    } finally {
      if (mountedRef.current) {
        setIsRefreshing(false)
      }
    }
  }, [isRefreshing, refreshRateLimits, refreshDetectedAgents])

  if (!statusBarVisible) {
    return null
  }

  const { claude, codex, gemini, opencodeGo, kimi, antigravity, minimax, grok } = rateLimits

  // Why: a bar is earned by a live snapshot or durable Settings setup; detection-gating hides per-CLI bars when the agent isn't on PATH.
  // Why: Antigravity has no persisted credential, so a checked status item + detected CLI is the durable "show its slot" signal.
  // Why: Antigravity visibility also requires geminiCliOAuthEnabled because its usage snapshot mirrors the Gemini fetch.
  const antigravityUsageConfigured =
    statusBarItems.includes('antigravity') &&
    isStatusBarItemAvailable('antigravity', detectedAgentIds)
  // Why: thread non-GlobalSettings durability flags so bars stay visible across reloads and snapshot refreshes.
  const usageSettings = {
    ...settings,
    antigravityUsageConfigured,
    minimaxCookieConfigured: rateLimits.minimaxCookieConfigured,
    grokAuthConfigured: rateLimits.grokAuthConfigured
  }
  const visibleClaude = getVisibleUsageProvider('claude', claude, usageSettings)
  const visibleCodex = getVisibleUsageProvider('codex', codex, usageSettings)
  const visibleGemini = getVisibleUsageProvider('gemini', gemini, usageSettings)
  const visibleKimi = getVisibleUsageProvider('kimi', kimi, usageSettings)
  const visibleAntigravity = getVisibleUsageProvider('antigravity', antigravity, usageSettings)
  const visibleMiniMax = getVisibleUsageProvider('minimax', minimax, usageSettings)
  const visibleGrok = getVisibleUsageProvider('grok', grok, usageSettings)
  const showClaude =
    visibleClaude !== null &&
    statusBarItems.includes('claude') &&
    isStatusBarItemAvailable('claude', detectedAgentIds)
  const showCodex =
    visibleCodex !== null &&
    statusBarItems.includes('codex') &&
    isStatusBarItemAvailable('codex', detectedAgentIds)
  const showGemini =
    visibleGemini !== null &&
    statusBarItems.includes('gemini') &&
    isStatusBarItemAvailable('gemini', detectedAgentIds)
  const showKimi =
    visibleKimi !== null &&
    statusBarItems.includes('kimi') &&
    isStatusBarItemAvailable('kimi', detectedAgentIds)
  const showAntigravity =
    visibleAntigravity !== null &&
    statusBarItems.includes('antigravity') &&
    isStatusBarItemAvailable('antigravity', detectedAgentIds)
  // Why: MiniMax is cookie-auth, not a CLI on PATH, so detection-gating doesn't apply.
  const showMiniMax = visibleMiniMax !== null && statusBarItems.includes('minimax')
  const showGrok =
    visibleGrok !== null &&
    statusBarItems.includes('grok') &&
    isStatusBarItemAvailable('grok', detectedAgentIds)
  // Why: OpenCode Go is web/cookie-auth, not a CLI on PATH, so detection-gating doesn't apply.
  const visibleOpencodeGo = getVisibleUsageProvider('opencode-go', opencodeGo, usageSettings)
  const showOpencodeGo = visibleOpencodeGo !== null && statusBarItems.includes('opencode-go')
  const showSsh = statusBarItems.includes('ssh')
  const showResourceUsage = statusBarItems.includes('resource-usage')
  const showPorts = statusBarItems.includes('ports')
  const showFloatingTerminalToggle =
    floatingTerminalEnabled && floatingTerminalTriggerLocation === 'status-bar'
  // Why: meter-only children (excludes resource-usage) so the % display callout anchors to a real meter cluster.
  const hasVisibleUsageMeters =
    showClaude ||
    showCodex ||
    showGemini ||
    showOpencodeGo ||
    showKimi ||
    showAntigravity ||
    showMiniMax ||
    showGrok
  const anyVisible = hasVisibleUsageMeters || showResourceUsage
  // Why: include Settings so durable managed accounts count — a configured user isn't shown the empty state while snapshots hydrate.
  const isEmptyUsageState = isUsageEmptyState(
    { claude, codex, gemini, opencodeGo, kimi, antigravity, minimax, grok },
    usageSettings
  )
  // Why: one-time nudge — once dismissed, stays hidden even if providers reconnect later.
  const showEmptyUsageCta = isEmptyUsageState && !usageEmptyStateDismissed
  const anyFetching =
    claude?.status === 'fetching' ||
    codex?.status === 'fetching' ||
    gemini?.status === 'fetching' ||
    opencodeGo?.status === 'fetching' ||
    kimi?.status === 'fetching' ||
    antigravity?.status === 'fetching' ||
    minimax?.status === 'fetching' ||
    grok?.status === 'fetching'

  const compact = containerWidth < 900
  const iconOnly = containerWidth < 500
  const floatingTerminalActionLabel = floatingTerminalOpen
    ? 'Minimize Floating Workspace'
    : 'Show Floating Workspace'
  const showFloatingWorkspaceAttentionDot = !floatingTerminalOpen && hasFloatingUnread

  // Why: the roster must contain only status items the user left visible;
  // otherwise an empty trigger would bypass those visibility controls.
  const rosterProviders = [
    showClaude ? visibleClaude : null,
    showCodex ? visibleCodex : null,
    showGemini ? visibleGemini : null,
    showAntigravity ? visibleAntigravity : null,
    showOpencodeGo ? visibleOpencodeGo : null,
    showKimi ? visibleKimi : null,
    showMiniMax ? visibleMiniMax : null,
    showGrok ? visibleGrok : null
  ].filter((p): p is ProviderRateLimits => p !== null)

  const handleManageAccounts = (): void => {
    setUsageMenuOpen(false)
    openSettingsTarget({ pane: 'accounts', repoId: null })
    openSettingsPage()
  }
  const handleUsageDetails = (): void => {
    setUsageMenuOpen(false)
    openSettingsTarget({ pane: 'stats', repoId: null })
    openSettingsPage()
  }
  const handleOpenProviderAccounts = (provider: ProviderRateLimits['provider']): void => {
    const sectionId = getUsageProviderAccountsSectionId(provider)
    if (!sectionId) {
      return
    }
    setUsageMenuOpen(false)
    openSettingsTarget({ pane: 'accounts', repoId: null, sectionId })
    openSettingsPage()
  }
  const handleUsageMenuOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      usageMenuFocusHandoff.reset()
      recordFeatureInteraction('usage-tracking')
    }
    setUsageMenuOpen(nextOpen)
  }

  return (
    <div
      ref={containerRefCallback}
      className="flex items-center h-6 min-h-[24px] px-3 gap-4 border-t border-border bg-[var(--bg-titlebar,var(--card))] text-xs select-none shrink-0 relative"
      onContextMenuCapture={(event) => {
        if (!shouldOpenStatusBarContextMenu(event.target)) {
          return
        }
        // Why: mirror the app-wide right-click pattern — close peer menus, then anchor a hidden trigger at the cursor so re-clicks reposition.
        event.preventDefault()
        window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
        const bounds = event.currentTarget.getBoundingClientRect()
        setMenuPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
        setMenuOpen(true)
      }}
    >
      <div className="flex items-center gap-3">
        {isEmptyUsageState ? (
          showEmptyUsageCta ? (
            <StatusBarUsageEmptyCta />
          ) : null
        ) : hasVisibleUsageMeters ? (
          // Consolidated roster pill → opens the all-agents Usage popover (mock parity).
          <UsagePercentageDisplayChangeNotice hasVisibleUsageMeters={hasVisibleUsageMeters}>
            <DropdownMenu
              open={usageMenuOpen}
              onOpenChange={handleUsageMenuOpenChange}
              modal={false}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-3 rounded px-1 py-0.5 hover:bg-accent/70"
                  aria-label={translate(
                    'auto.components.status.bar.UsageRosterPanel.title',
                    'Usage'
                  )}
                >
                  {rosterProviders.map((p) =>
                    iconOnly ? (
                      // Narrow status bar: fall back to main's compact letter badge.
                      <span key={p.provider} title={getProviderDisplayName(p.provider)}>
                        <ProviderLetterBadge p={p} />
                      </span>
                    ) : (
                      <ProviderSegment
                        key={p.provider}
                        p={p}
                        compact={compact}
                        display={usagePercentageDisplay}
                        mode={statusBarUsageMode}
                      />
                    )
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
                side="top"
                align="start"
                sideOffset={8}
                // Keep the popover (and its drill-in submenus) above the status
                // bar instead of overlapping it — bottom padding ≈ footer height.
                collisionPadding={{ top: 8, bottom: 32, left: 8, right: 8 }}
                className="w-[360px] p-0"
                onPointerDownOutside={usageMenuFocusHandoff.onPointerDownOutside}
                onCloseAutoFocus={usageMenuFocusHandoff.onCloseAutoFocus}
              >
                <UsageRosterPanel
                  providers={rosterProviders}
                  display={usagePercentageDisplay}
                  statusBarUsageMode={statusBarUsageMode}
                  onStatusBarUsageModeChange={setStatusBarUsageMode}
                  isRefreshing={isRefreshing || anyFetching}
                  onRefresh={handleRefresh}
                  onOpenProvider={handleOpenProviderAccounts}
                  onSignIn={handleOpenProviderAccounts}
                  canSignIn={(provider) => getUsageProviderAccountsSectionId(provider) !== null}
                  onManageAccounts={handleManageAccounts}
                  onUsageDetails={handleUsageDetails}
                  renderRow={(p, rowNode) => {
                    // Every provider drills into its detail panel (parity with the
                    // per-provider dropdowns on main); Claude/Codex additionally get
                    // the account switcher + runtime toggle + Codex reset credits.
                    if (p.provider === 'claude') {
                      return (
                        <ClaudeSwitcherMenu
                          claude={p}
                          compact={compact}
                          iconOnly={false}
                          asSubmenu
                          triggerContent={rowNode}
                        />
                      )
                    }
                    if (p.provider === 'codex') {
                      return (
                        <CodexSwitcherMenu
                          codex={p}
                          compact={compact}
                          iconOnly={false}
                          asSubmenu
                          triggerContent={rowNode}
                        />
                      )
                    }
                    return (
                      <ProviderDetailsMenu
                        provider={p}
                        compact={compact}
                        iconOnly={false}
                        asSubmenu
                        triggerContent={rowNode}
                        ariaLabel={translate(
                          'auto.components.status.bar.UsageRosterPanel.openDetails',
                          'Open usage details'
                        )}
                      />
                    )
                  }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </UsagePercentageDisplayChangeNotice>
        ) : null}
        {anyVisible && !isEmptyUsageState && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                aria-label={translate(
                  'auto.components.status.bar.StatusBar.3325d996cb',
                  'Refresh rate limits'
                )}
              >
                <RefreshCw
                  size={11}
                  className={isRefreshing || anyFetching ? 'animate-spin' : ''}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {translate('auto.components.status.bar.StatusBar.c8857b40f7', 'Refresh usage data')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <RemoteServerUpdateStatusSegment iconOnly={iconOnly} />
        <SkillUpdateStatusSegment iconOnly={iconOnly} />
        <UpdateStatusSegment compact={compact} iconOnly={iconOnly} />
        <React.Suspense fallback={null}>
          {petEnabled ? <PetStatusSegment /> : null}
          {showResourceUsage ? (
            <ResourceUsageStatusSegment compact={compact} iconOnly={iconOnly} />
          ) : null}
          {showPorts ? <PortsStatusSegment compact={compact} iconOnly={iconOnly} /> : null}
          {showSsh ? <SshStatusSegment compact={compact} iconOnly={iconOnly} /> : null}
        </React.Suspense>
        {showFloatingTerminalToggle && (
          <FloatingTerminalIconContextMenu currentLocation="status-bar" className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="relative inline-flex size-5 cursor-pointer items-center justify-center rounded border border-border bg-secondary text-secondary-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label={
                    showFloatingWorkspaceAttentionDot
                      ? `${floatingTerminalActionLabel}, new activity`
                      : floatingTerminalActionLabel
                  }
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent(TOGGLE_FLOATING_TERMINAL_EVENT))
                  }}
                >
                  <PanelsTopLeft className="size-3.5" />
                  {showFloatingWorkspaceAttentionDot ? (
                    // Why: amber = Orca's "needs attention" convention; ring matches the fill so the dot reads on the icon.
                    <span
                      aria-hidden
                      data-floating-terminal-attention
                      className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-amber-500 ring-1 ring-secondary"
                    />
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {floatingTerminalActionLabel} ({floatingTerminalShortcut})
              </TooltipContent>
            </Tooltip>
          </FloatingTerminalIconContextMenu>
        )}
      </div>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none absolute size-px opacity-0"
            style={{ left: menuPoint.x, top: menuPoint.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-0 w-fit" sideOffset={0} align="start">
          {isStatusBarItemAvailable('claude', detectedAgentIds) && (
            <DropdownMenuCheckboxItem
              checked={statusBarItems.includes('claude')}
              onCheckedChange={() => {
                recordFeatureInteraction('usage-tracking')
                toggleStatusBarItem('claude')
              }}
            >
              <ClaudeIcon size={14} />
              {translate('auto.components.status.bar.StatusBar.3885eb74d8', 'Claude Usage')}
            </DropdownMenuCheckboxItem>
          )}
          {isStatusBarItemAvailable('codex', detectedAgentIds) && (
            <DropdownMenuCheckboxItem
              checked={statusBarItems.includes('codex')}
              onCheckedChange={() => {
                recordFeatureInteraction('usage-tracking')
                toggleStatusBarItem('codex')
              }}
            >
              <OpenAIIcon size={14} />
              {translate('auto.components.status.bar.StatusBar.c0909c686e', 'Codex Usage')}
            </DropdownMenuCheckboxItem>
          )}
          {isStatusBarItemAvailable('gemini', detectedAgentIds) && (
            <DropdownMenuCheckboxItem
              checked={statusBarItems.includes('gemini')}
              onCheckedChange={() => {
                recordFeatureInteraction('usage-tracking')
                toggleStatusBarItem('gemini')
              }}
            >
              <GeminiIcon size={14} />
              {translate('auto.components.status.bar.StatusBar.c1df0d67ec', 'Gemini Usage')}
            </DropdownMenuCheckboxItem>
          )}
          {isStatusBarItemAvailable('antigravity', detectedAgentIds) && (
            <DropdownMenuCheckboxItem
              checked={statusBarItems.includes('antigravity')}
              onCheckedChange={() => {
                recordFeatureInteraction('usage-tracking')
                toggleStatusBarItem('antigravity')
              }}
            >
              <AgentIcon agent="antigravity" size={14} />
              {translate(
                'auto.components.status.bar.StatusBar.antigravityUsage',
                'Antigravity Usage'
              )}
            </DropdownMenuCheckboxItem>
          )}
          <DropdownMenuCheckboxItem
            checked={statusBarItems.includes('opencode-go')}
            onCheckedChange={() => {
              recordFeatureInteraction('usage-tracking')
              toggleStatusBarItem('opencode-go')
            }}
          >
            <OpenCodeGoIcon size={14} />
            {translate('auto.components.status.bar.StatusBar.8c86cd77b0', 'OpenCode Go Usage')}
          </DropdownMenuCheckboxItem>
          {isStatusBarItemAvailable('kimi', detectedAgentIds) && (
            <DropdownMenuCheckboxItem
              checked={statusBarItems.includes('kimi')}
              onCheckedChange={() => {
                recordFeatureInteraction('usage-tracking')
                toggleStatusBarItem('kimi')
              }}
            >
              <AgentIcon agent="kimi" size={14} />
              {translate('auto.components.status.bar.StatusBar.5e59007df4', 'Kimi Usage')}
            </DropdownMenuCheckboxItem>
          )}
          <DropdownMenuCheckboxItem
            checked={statusBarItems.includes('minimax')}
            onCheckedChange={() => {
              recordFeatureInteraction('usage-tracking')
              toggleStatusBarItem('minimax')
            }}
          >
            <MiniMaxIcon size={14} />
            {translate('auto.components.status.bar.StatusBar.3bbf140864', 'MiniMax Usage')}
          </DropdownMenuCheckboxItem>
          {isStatusBarItemAvailable('grok', detectedAgentIds) && (
            <DropdownMenuCheckboxItem
              checked={statusBarItems.includes('grok')}
              onCheckedChange={() => {
                recordFeatureInteraction('usage-tracking')
                toggleStatusBarItem('grok')
              }}
            >
              <AgentIcon agent="grok" size={14} />
              {translate('auto.components.status.bar.StatusBar.grokUsageMenu', 'Grok Usage')}
            </DropdownMenuCheckboxItem>
          )}
          <DropdownMenuCheckboxItem
            checked={statusBarItems.includes('ssh')}
            onCheckedChange={() => {
              recordFeatureInteraction('ssh')
              toggleStatusBarItem('ssh')
            }}
          >
            <Server className="size-3.5" />
            {translate('auto.components.status.bar.StatusBar.24ac89df1a', 'Remote Hosts')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={statusBarItems.includes('resource-usage')}
            onCheckedChange={() => {
              recordFeatureInteraction('resource-manager')
              toggleStatusBarItem('resource-usage')
            }}
          >
            <Activity className="size-3.5" />
            {translate('auto.components.status.bar.StatusBar.d1e1a7a6bf', 'Resource Manager')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={statusBarItems.includes('ports')}
            onCheckedChange={() => {
              recordFeatureInteraction('ports')
              toggleStatusBarItem('ports')
            }}
          >
            <Plug className="size-3.5" />
            {translate('auto.components.status.bar.StatusBar.9659e38343', 'Ports')}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export const StatusBar = React.memo(StatusBarInner)
