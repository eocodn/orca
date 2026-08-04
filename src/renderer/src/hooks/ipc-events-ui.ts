import { useAppStore } from '../store'
import { toast } from 'sonner'
import { canShowRightSidebarForView } from '@/lib/right-sidebar-visibility'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { runWorktreeDelete } from '@/components/sidebar/delete-worktree-flow'
import { OPEN_WORKSPACE_BOARD_EVENT } from '@/components/sidebar/useWorkspaceBoardPanel'
import { activateTabNumberShortcut } from '@/lib/tab-number-shortcuts'
import { getVisibleWorktreeIds } from '@/components/sidebar/visible-worktrees'
import { TOGGLE_FLOATING_TERMINAL_EVENT } from '@/lib/floating-terminal'
import { TOGGLE_QUICK_COMMANDS_MENU_EVENT } from '@/lib/quick-commands-menu-events'
import { showTerminalShortcutCaptureNotification } from '@/lib/terminal-shortcut-capture-notification'
import { isGitRepoKind } from '../../../shared/repo-kind'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientEvent } from '../../../shared/runtime-client-events'
import { subscribeToUnpairedDeviceAuthNotification } from './unpaired-device-auth-notification'
import { getClientRuntime } from '@/runtime/client-runtime'
type UiSurfaceContext = {
  unsubs: Array<() => void>
  isRuntimeEnvironmentActive: () => boolean
  activateNotifiedWorktree: (
    event: Extract<RuntimeClientEvent, { type: 'activateWorktree' }>,
    options: { allowRuntimeEnvironment: boolean }
  ) => Promise<void>
  openNewWorkspaceFromShortcut: (state: ReturnType<typeof useAppStore.getState>) => void
}
function getShortcutPlatform(): NodeJS.Platform {
  if (navigator.userAgent.includes('Mac')) {
    return 'darwin'
  }
  if (navigator.userAgent.includes('Windows')) {
    return 'win32'
  }
  return 'linux'
}

export function registerUiEvents({
  unsubs,
  isRuntimeEnvironmentActive,
  activateNotifiedWorktree,
  openNewWorkspaceFromShortcut
}: UiSurfaceContext): void {
  unsubs.push(
    window.api.ui.onOpenSettings(() => {
      useAppStore.getState().openSettingsPage()
    })
  )

  // Why: a tray "Settings…" click can fire before this attaches; consume any queued intent (?. guards stale preload).
  void window.api.ui
    .consumePendingOpenSettings?.()
    .then((open) => {
      if (open) {
        useAppStore.getState().openSettingsPage()
      }
    })
    .catch(() => {})

  unsubs.push(
    window.api.ui.onOpenSetupGuide?.(() => {
      useAppStore.getState().openModal('setup-guide', { telemetrySource: 'help_menu' })
    }) ?? (() => {})
  )

  // Why: a phone stuck in a silent 4001 auth loop (lost device registry) reads as
  // "phone won't connect" with no clue on either end; main throttles to once per session.
  unsubs.push(
    subscribeToUnpairedDeviceAuthNotification(getClientRuntime().device, () => {
      toast.warning(
        translate(
          'auto.hooks.useIpcEvents.ef223fbb6b',
          'A device tried to connect but is not paired'
        ),
        {
          id: 'unpaired-device-auth-failure',
          description: translate(
            'auto.hooks.useIpcEvents.11992d0337',
            'If this was your phone or another Orca client, re-pair it from Settings → Mobile.'
          ),
          // Why: main emits this recovery path once per session, so it must remain visible until acted on or dismissed.
          duration: Infinity,
          action: {
            label: translate('auto.hooks.useIpcEvents.6573cfe955', 'Open Mobile Settings'),
            onClick: () => {
              const store = useAppStore.getState()
              store.openSettingsTarget({ pane: 'mobile', repoId: null })
              store.openSettingsPage()
            }
          }
        }
      )
    })
  )

  unsubs.push(
    window.api.ui.onOpenFeatureTour(() => {
      useAppStore.getState().openModal('feature-wall', { source: 'help_menu' })
    })
  )

  // Why: View > Appearance toggles settings in main and broadcasts; merge into the store for an immediate re-render.
  unsubs.push(
    window.api.settings.onChanged((updates) => {
      const store = useAppStore.getState()
      if (!store.settings) {
        return
      }
      useAppStore.setState({
        settings: {
          ...store.settings,
          ...updates,
          notifications: {
            ...store.settings.notifications,
            ...updates.notifications
          }
        }
      })
    })
  )

  // Why: UI view-state is shared with mobile via ui.set; re-hydrate so mobile changes reflect live in the desktop sidebar.
  unsubs.push(
    window.api.ui.onStateChanged((ui) => {
      useAppStore.getState().hydratePersistedUI(ui, 'sync')
    })
  )

  if (window.api.keybindings) {
    unsubs.push(
      window.api.keybindings.onChanged((snapshot) => {
        useAppStore.getState().setKeybindingSnapshot(snapshot)
      })
    )
  }

  unsubs.push(
    window.api.ui.onToggleLeftSidebar(() => {
      useAppStore.getState().toggleSidebar()
    })
  )

  unsubs.push(
    window.api.ui.onToggleRightSidebar(() => {
      const store = useAppStore.getState()
      if (!canShowRightSidebarForView(store.activeView)) {
        return
      }
      store.toggleRightSidebar()
    })
  )

  unsubs.push(
    window.api.ui.onToggleWorktreePalette(() => {
      const store = useAppStore.getState()
      if (store.activeModal === 'worktree-palette') {
        store.closeModal()
        return
      }
      store.openModal('worktree-palette')
    })
  )

  unsubs.push(
    window.api.ui.onToggleFloatingTerminal(() => {
      window.dispatchEvent(new CustomEvent(TOGGLE_FLOATING_TERMINAL_EVENT))
    })
  )

  if (window.api.ui.onTerminalShortcutCaptured) {
    unsubs.push(
      window.api.ui.onTerminalShortcutCaptured(({ actionId }) => {
        showTerminalShortcutCaptureNotification({
          actionId,
          platform: getShortcutPlatform(),
          keybindings: useAppStore.getState().keybindings
        })
      })
    )
  }

  unsubs.push(
    window.api.ui.onOpenQuickOpen(() => {
      const store = useAppStore.getState()
      if (store.activeView === 'terminal' && store.activeWorktreeId !== null) {
        store.openModal('quick-open')
      }
    })
  )

  unsubs.push(
    window.api.ui.onToggleQuickCommandsMenu(() => {
      window.dispatchEvent(new CustomEvent(TOGGLE_QUICK_COMMANDS_MENU_EVENT))
    })
  )

  unsubs.push(
    window.api.ui.onOpenNewWorkspace(() => {
      const store = useAppStore.getState()
      openNewWorkspaceFromShortcut(store)
    })
  )

  if (window.api.ui.onDeleteCurrentWorkspace) {
    unsubs.push(
      window.api.ui.onDeleteCurrentWorkspace(() => {
        const store = useAppStore.getState()
        if (
          store.activeModal !== 'none' ||
          store.activeView !== 'terminal' ||
          !store.activeWorktreeId
        ) {
          return
        }
        runWorktreeDelete(store.activeWorktreeId)
      })
    )
  }

  if (window.api.ui.onOpenWorkspaceBoard) {
    unsubs.push(
      window.api.ui.onOpenWorkspaceBoard(() => {
        const store = useAppStore.getState()
        if (store.activeView === 'settings') {
          return
        }
        store.setSidebarOpen(true)
        window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_BOARD_EVENT))
      })
    )
  }

  unsubs.push(
    window.api.ui.onOpenTasks(() => {
      const store = useAppStore.getState()
      if (store.activeView === 'settings' || !store.repos.some((repo) => isGitRepoKind(repo))) {
        return
      }
      store.openTaskPage()
    })
  )

  unsubs.push(
    window.api.ui.onJumpToWorktreeIndex((index) => {
      const store = useAppStore.getState()
      if (store.activeView !== 'terminal') {
        return
      }
      const visibleIds = getVisibleWorktreeIds()
      if (index < visibleIds.length) {
        activateAndRevealWorkspace(visibleIds[index])
      }
    })
  )

  unsubs.push(
    window.api.ui.onJumpToTabIndex((index) => {
      activateTabNumberShortcut(index)
    })
  )

  unsubs.push(
    window.api.ui.onWorktreeHistoryNavigate((direction) => {
      const store = useAppStore.getState()
      // Why: mirror button visibility — worktree history nav is only meaningful in the terminal view, so no-op elsewhere.
      if (store.activeView !== 'terminal') {
        return
      }
      if (direction === 'back') {
        store.goBackWorktree()
      } else {
        store.goForwardWorktree()
      }
    })
  )

  unsubs.push(
    window.api.ui.onToggleStatusBar(() => {
      const store = useAppStore.getState()
      store.setStatusBarVisible(!store.statusBarVisible)
    })
  )

  unsubs.push(
    window.api.ui.onActivateWorktree(({ repoId, worktreeId, setup, startup, defaultTabs }) => {
      void activateNotifiedWorktree(
        {
          type: 'activateWorktree',
          repoId,
          worktreeId,
          ...(setup ? { setup } : {}),
          ...(startup ? { startup } : {}),
          ...(defaultTabs ? { defaultTabs } : {})
        },
        { allowRuntimeEnvironment: false }
      ).catch((error) => {
        console.error('Failed to activate CLI-created worktree:', error)
      })
    })
  )
}
