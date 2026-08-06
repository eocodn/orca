import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, PanelsTopLeft, Plug, Server } from 'lucide-react'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '../../store'
import { selectFloatingWorkspaceHasUnread } from '../../store/selectors'
import { translate } from '@/i18n/i18n'
import { TOGGLE_FLOATING_TERMINAL_EVENT } from '@/lib/floating-terminal'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { FloatingTerminalIconContextMenu } from '@/components/floating-terminal/FloatingTerminalIconContextMenu'
import { UpdateStatusSegment } from './UpdateStatusSegment'
import { SkillUpdateStatusSegment } from './SkillUpdateStatusSegment'
import { RemoteServerUpdateStatusSegment } from './RemoteServerUpdateStatusSegment'
import { ResourceUsageStatusSegment } from './ResourceUsageStatusSegment'
import { PortsStatusSegment } from './PortsStatusSegment'
import { SshStatusSegment } from './SshStatusSegment'
import { PetStatusSegment } from './PetStatusSegment'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS, shouldOpenStatusBarContextMenu } from './status-bar-context-menu-policy'

type StatusBarProps = { floatingTerminalOpen: boolean }
const CLOSE_ALL_CONTEXT_MENUS_EVENT = 'orca-close-all-context-menus'

/** Status bar indicators that remain after provider quota/account surfaces were removed. */
export function StatusBarInner({ floatingTerminalOpen }: StatusBarProps): React.JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const statusBarVisible = useAppStore((s) => s.statusBarVisible)
  const statusBarItems = useAppStore((s) => s.statusBarItems)
  const toggleStatusBarItem = useAppStore((s) => s.toggleStatusBarItem)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const hasFloatingUnread = useAppStore(selectFloatingWorkspaceHasUnread)
  const floatingTerminalShortcut = useShortcutLabel('floatingTerminal.toggle')
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(900)

  useEffect(() => {
    const closeMenu = (): void => setMenuOpen(false)
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
  }, [])

  const containerRefCallback = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
  }, [])
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => setContainerWidth(entries[0]?.contentRect.width ?? 900))
    observer.observe(node)
    setContainerWidth(node.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [statusBarVisible])

  if (!statusBarVisible) return null
  const compact = containerWidth < 900
  const iconOnly = containerWidth < 500
  const showFloatingTerminalToggle =
    settings?.floatingTerminalEnabled === true && settings.floatingTerminalTriggerLocation === 'status-bar'
  const floatingTerminalActionLabel = floatingTerminalOpen ? 'Minimize Floating Workspace' : 'Show Floating Workspace'
  const showResourceUsage = statusBarItems.includes('resource-usage')
  const showPorts = statusBarItems.includes('ports')
  const showSsh = statusBarItems.includes('ssh')
  const petEnabled = settings?.experimentalPet === true

  return (
    <div
      ref={containerRefCallback}
      className="flex items-center h-6 min-h-[24px] px-3 gap-4 border-t border-border bg-[var(--bg-titlebar,var(--card))] text-xs select-none shrink-0 relative"
      onContextMenuCapture={(event) => {
        if (!shouldOpenStatusBarContextMenu(event.target)) return
        event.preventDefault()
        window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
        const bounds = event.currentTarget.getBoundingClientRect()
        setMenuPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
        setMenuOpen(true)
      }}
    >
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <RemoteServerUpdateStatusSegment iconOnly={iconOnly} />
        <SkillUpdateStatusSegment iconOnly={iconOnly} />
        <UpdateStatusSegment compact={compact} iconOnly={iconOnly} />
        <React.Suspense fallback={null}>
          {petEnabled ? <PetStatusSegment /> : null}
          {showResourceUsage ? <ResourceUsageStatusSegment compact={compact} iconOnly={iconOnly} /> : null}
          {showPorts ? <PortsStatusSegment compact={compact} iconOnly={iconOnly} /> : null}
          {showSsh ? <SshStatusSegment compact={compact} iconOnly={iconOnly} /> : null}
        </React.Suspense>
        {showFloatingTerminalToggle ? (
          <FloatingTerminalIconContextMenu currentLocation="status-bar" className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="relative inline-flex size-5 cursor-pointer items-center justify-center rounded border border-border bg-secondary text-secondary-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label={hasFloatingUnread ? `${floatingTerminalActionLabel}, new activity` : floatingTerminalActionLabel}
                  onClick={() => window.dispatchEvent(new CustomEvent(TOGGLE_FLOATING_TERMINAL_EVENT))}
                >
                  <PanelsTopLeft className="size-3.5" />
                  {hasFloatingUnread && !floatingTerminalOpen ? <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-amber-500 ring-1 ring-secondary" /> : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>{floatingTerminalActionLabel} ({floatingTerminalShortcut})</TooltipContent>
            </Tooltip>
          </FloatingTerminalIconContextMenu>
        ) : null}
      </div>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button aria-hidden tabIndex={-1} className="pointer-events-none absolute size-px opacity-0" style={{ left: menuPoint.x, top: menuPoint.y }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS} className="min-w-0 w-fit" sideOffset={0} align="start">
          <DropdownMenuCheckboxItem checked={showSsh} onCheckedChange={() => { recordFeatureInteraction('ssh'); toggleStatusBarItem('ssh') }}>
            <Server className="size-3.5" />{translate('auto.components.status.bar.StatusBar.24ac89df1a', 'Remote Hosts')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={showResourceUsage} onCheckedChange={() => { recordFeatureInteraction('resource-manager'); toggleStatusBarItem('resource-usage') }}>
            <Activity className="size-3.5" />{translate('auto.components.status.bar.StatusBar.d1e1a7a6bf', 'Resource Manager')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={showPorts} onCheckedChange={() => { recordFeatureInteraction('ports'); toggleStatusBarItem('ports') }}>
            <Plug className="size-3.5" />{translate('auto.components.status.bar.StatusBar.9659e38343', 'Ports')}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export const StatusBar = React.memo(StatusBarInner)
