import {   AlertTriangle,   Activity,   RotateCcw,   Plug,   ChevronDown,   ChevronRight,   Loader2,   PanelsTopLeft,   RefreshCw,   Server } from 'lucide-react' import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react' import { lazyWithRetry } from '@/lib/lazy-with-retry' import { Button } from '@/components/ui/button' import { Checkbox } from '@/components/ui/checkbox' import {   Dialog,   DialogContent,   DialogDescription,   DialogFooter,   DialogHeader,   DialogTitle } from '@/components/ui/dialog' import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip' import {   DropdownMenu,   DropdownMenuCheckboxItem,   DropdownMenuContent,   DropdownMenuItem,   DropdownMenuLabel,   DropdownMenuSeparator,   DropdownMenuSub,   DropdownMenuSubContent,   DropdownMenuSubTrigger,   DropdownMenuTrigger } from '@/components/ui/dropdown-menu' import { useAppStore } from '../../store' import { selectFloatingWorkspaceHasUnread } from '../../store/selectors' import type {   ClaudeRateLimitAccountsState,   CodexRateLimitAccountsState,   GlobalSettings } from '../../../../shared/types' import type {   ProviderRateLimits,   RateLimitRuntimeTarget,   RateLimitWindow } from '../../../../shared/rate-limit-types' import { resolveLocalAccountRuntimeTarget } from '../../../../shared/local-account-runtime' import { getRendererAppPlatform } from '../../lib/renderer-app-platform' import {   ProviderIcon,   ProviderPanel,   barColor,   clampUsedPercent,   formatResetCreditExpiry,   getProviderDisplayName,   getProviderUsageStatusLabel } from './tooltip' import { ClaudeIcon, GeminiIcon, MiniMaxIcon, OpenAIIcon, OpenCodeGoIcon } from './icons' import { AgentIcon } from '@/lib/agent-catalog' import { UsageRosterPanel, getTightestUsageSection } from './UsageRosterPanel' import { getUsageProviderAccountsSectionId } from './usage-provider-settings-target' import { formatRateLimitWindowChipLabel } from '@/lib/window-label-formatter' import { useResetCountdownClock } from '@/hooks/useResetCountdownClock' import {   markLiveCodexSessionsForRestart,   resolveCodexRestartPromptAccountLabel } from '@/lib/codex-session-restart' import { UpdateStatusSegment } from './UpdateStatusSegment' import { SkillUpdateStatusSegment } from './SkillUpdateStatusSegment' import { RemoteServerUpdateStatusSegment } from './RemoteServerUpdateStatusSegment' import { isStatusBarItemAvailable } from './status-bar-agent-gating' import { getVisibleUsageProvider, isUsageEmptyState } from './status-bar-provider-visibility' import { StatusBarUsageEmptyCta } from './StatusBarUsageEmptyCta' import { UsagePercentageDisplayChangeNotice } from './UsagePercentageDisplayChangeNotice' import {   STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS,   shouldOpenStatusBarContextMenu } from './status-bar-context-menu-policy' import { TOGGLE_FLOATING_TERMINAL_EVENT } from '@/lib/floating-terminal' import { useShortcutLabel } from '@/hooks/useShortcutLabel' import { FloatingTerminalIconContextMenu } from '@/components/floating-terminal/FloatingTerminalIconContextMenu' import { summarizeCodexRestartStatus } from './codex-restart-status-summary' import {   getWindowsTerminalCapabilityOwnerKey,   useWindowsTerminalCapabilities } from '@/lib/windows-terminal-capabilities' import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client' import {   fetchProviderAccountsSnapshot,   selectClaudeProviderAccount,   selectCodexProviderAccount } from '@/runtime/runtime-provider-accounts-client' import { translate } from '@/i18n/i18n' import {   getDisplayedUsagePercentage,   normalizeUsagePercentageDisplay,   type UsagePercentageDisplay } from '../../../../shared/usage-percentage-display' import { formatUsagePercentageLabel } from './usage-percentage-label' import {   normalizeStatusBarUsageMode,   type StatusBarUsageMode } from '../../../../shared/status-bar-usage-mode'

import { ProviderLetterBadge, ProviderSegment } from './status-bar-provider-inline-usage'
import { useStatusBarMenuFocusHandoff } from './status-bar-menu-focus'

export function ProviderDetailsMenu({
  provider,
  compact,
  iconOnly,
  ariaLabel,
  topContent,
  hidePanelResetCredits = false,
  open,
  onOpenChange,
  children,
  asSubmenu = false,
  triggerContent
}: {
  provider: ProviderRateLimits
  compact: boolean
  iconOnly: boolean
  ariaLabel: string
  topContent?: React.ReactNode
  hidePanelResetCredits?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
  // When set, render as a drill-in submenu (used by the consolidated Usage
  // popover) with triggerContent as the full-width row instead of a segment.
  asSubmenu?: boolean
  triggerContent?: React.ReactNode
}): React.JSX.Element {
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const usagePercentageDisplay = normalizeUsagePercentageDisplay(
    useAppStore((s) => s.usagePercentageDisplay)
  )
  const menuFocusHandoff = useStatusBarMenuFocusHandoff()

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      menuFocusHandoff.reset()
      recordFeatureInteraction('usage-tracking')
    }
    onOpenChange?.(nextOpen)
  }

  const panelBody = (
    <>
      {topContent}
      <div className="p-2">
        {/* Why: provider-specific action sections may render richer reset-credit UI. */}
        <ProviderPanel
          p={provider}
          showResetCredits={!hidePanelResetCredits}
          usagePercentageDisplay={usagePercentageDisplay}
        />
      </div>
      {children ? (
        <>
          <DropdownMenuSeparator />
          {children}
        </>
      ) : null}
    </>
  )

  if (asSubmenu) {
    return (
      <DropdownMenuSub open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuSubTrigger className="w-full items-center gap-3 px-3.5 py-2.5">
          {triggerContent}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
          collisionPadding={{ top: 8, bottom: 32, left: 8, right: 8 }}
          className="max-h-(--radix-dropdown-menu-content-available-height) w-[300px] overflow-y-auto p-0 scrollbar-sleek"
        >
          {panelBody}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center cursor-pointer rounded px-1 py-0.5 hover:bg-accent/70"
          aria-label={ariaLabel}
        >
          {iconOnly ? (
            <ProviderLetterBadge p={provider} />
          ) : (
            <ProviderSegment p={provider} compact={compact} display={usagePercentageDisplay} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
        side="top"
        align="start"
        sideOffset={8}
        className="w-[260px]"
        onPointerDownOutside={menuFocusHandoff.onPointerDownOutside}
        onCloseAutoFocus={menuFocusHandoff.onCloseAutoFocus}
      >
        {panelBody}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}


