import { useAppStore } from '../store'
import { toast } from 'sonner'
import type { UpdateStatus } from '../../../shared/types'
import { translate } from '@/i18n/i18n'
import { getWorktreeRuntimeEnvironmentId } from './ipc-events-runtime-environment-model'
import { isFloatingWorkspacePanelFocused } from '@/lib/floating-workspace-terminal-actions'
import {
  createFloatingWorkspaceBrowserTab,
  createFloatingWorkspaceMarkdownTab
} from '@/lib/floating-workspace-terminal-actions'
import {
  createWebRuntimeSessionBrowserTab,
  isWebRuntimeSessionActive
} from '@/runtime/web-runtime-session'
import { openMobileEmulatorTab } from '@/lib/open-mobile-emulator-tab'
import { ensureSimulatorTab } from '@/lib/ensure-simulator-tab'
import {
  isManualSimulatorLaunchPending,
  rememberPrelaunchedSimulatorSession
} from '@/lib/simulator-launch-coordination'
type BrowserSurfaceContext = {
  unsubs: Array<() => void>
  acquireBrowserAutomationBootstrapLease: (
    worktreeId: string | null | undefined,
    browserPageId?: string | null
  ) => void
}
function isRuntimeEnvironmentActive(): boolean {
  return Boolean(useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim())
}

export function registerBrowserEvents({
  unsubs,
  acquireBrowserAutomationBootstrapLease
}: BrowserSurfaceContext): void {
// Hydrate initial update status then subscribe to changes
window.api.updater.getStatus().then((status) => {
  useAppStore.getState().setUpdateStatus(status as UpdateStatus)
})

unsubs.push(
  window.api.updater.onStatus((raw) => {
    const status = raw as UpdateStatus
    useAppStore.getState().setUpdateStatus(status)
  })
)

unsubs.push(
  window.api.updater.onClearDismissal(() => {
    useAppStore.getState().clearDismissedUpdateVersion()
  })
)

unsubs.push(
  window.api.ui.onFullscreenChanged((isFullScreen) => {
    useAppStore.getState().setIsFullScreen(isFullScreen)
  })
)

unsubs.push(
  window.api.browser.onGuestLoadFailed(({ browserPageId, loadError }) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    useAppStore.getState().updateBrowserPageState(browserPageId, {
      loading: false,
      loadError,
      canGoBack: false,
      canGoForward: false
    })
  })
)

const unsubscribeCertificateFailure = window.api.browser.onCertificateFailureChanged?.(
  ({ browserPageId, failure }) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    useAppStore.getState().setBrowserPageCertificateFailure(browserPageId, failure)
  }
)
if (unsubscribeCertificateFailure) {
  unsubs.push(unsubscribeCertificateFailure)
}

// Why: agent-browser navigates via CDP so did-navigate never fires; this IPC pushes live URL/title to the stale store.
unsubs.push(
  window.api.browser.onNavigationUpdate(({ browserPageId, url, title }) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    const store = useAppStore.getState()
    store.setBrowserPageUrl(browserPageId, url)
    store.updateBrowserPageState(browserPageId, { title, loading: false })
  })
)

// Why: webviews start their guest only when shown; sent pre-automation so hidden tabs mount without moving the active pane.
unsubs.push(
  window.api.browser.onActivateView(({ worktreeId, browserPageId }) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    acquireBrowserAutomationBootstrapLease(worktreeId, browserPageId)
  })
)

// Why: `orca tab switch --focus` must NOT call setActiveWorktree — a global focus from one agent's parallel-worktree switch would steal the user's view.
// focusBrowserTabInWorktree updates per-worktree state in place; globals flip only when the user is already on the targeted worktree.
unsubs.push(
  window.api.browser.onPaneFocus(({ worktreeId, browserPageId }) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    const store = useAppStore.getState()
    // Why: worktreeId is null if the tab closed mid-switch; the activeWorktreeId fallback makes the focus call a safe no-op for a stale page id.
    const targetWt = worktreeId ?? store.activeWorktreeId
    if (!targetWt) {
      return
    }
    store.focusBrowserTabInWorktree(targetWt, browserPageId)
  })
)

unsubs.push(
  window.api.browser.onOpenLinkInOrcaTab(({ browserPageId, url }) => {
    const store = useAppStore.getState()
    const sourcePage = Object.values(store.browserPagesByWorkspace)
      .flat()
      .find((page) => page.id === browserPageId)
    if (!sourcePage) {
      return
    }
    if (getRuntimeEnvironmentIdForWorktree(store, sourcePage.worktreeId)) {
      return
    }
    // Why: only the renderer owns Orca's tab model, so main delegates link-open here.
    store.createBrowserTab(sourcePage.worktreeId, url, { title: url })
  })
)

// Why: embedded browser guests capture keyboard focus and bypass window-level keydown, so shortcuts are forwarded via IPC.
unsubs.push(
  window.api.ui.onNewBrowserTab(() => {
    const store = useAppStore.getState()
    if (isFloatingWorkspacePanelFocused()) {
      void createFloatingWorkspaceBrowserTab(store)
      return
    }
    const worktreeId = store.activeWorktreeId
    if (worktreeId) {
      const environmentId = getWorktreeRuntimeEnvironmentId(worktreeId)
      if (environmentId) {
        if (!isWebRuntimeSessionActive(environmentId)) {
          store.createBrowserTab(worktreeId, store.browserDefaultUrl ?? 'about:blank', {
            title: translate('auto.hooks.useIpcEvents.f6300deb8b', 'New Browser Tab'),
            focusAddressBar: true
          })
          return
        }
        void (async () => {
          // Why: paired web tabs are host-owned; on RPC failure leave local state so the next host snapshot stays authoritative.
          await createWebRuntimeSessionBrowserTab({
            worktreeId,
            environmentId,
            url: store.browserDefaultUrl ?? 'about:blank'
          })
        })()
        return
      }
      store.createBrowserTab(worktreeId, store.browserDefaultUrl ?? 'about:blank', {
        title: translate('auto.hooks.useIpcEvents.f6300deb8b', 'New Browser Tab'),
        focusAddressBar: true
      })
    }
  })
)

unsubs.push(
  window.api.ui.onNewMarkdownTab(() => {
    const store = useAppStore.getState()
    if (isFloatingWorkspacePanelFocused()) {
      void createFloatingWorkspaceMarkdownTab(store).catch((err) => {
        toast.error(
          err instanceof Error
            ? err.message
            : translate(
                'auto.hooks.useIpcEvents.56d3ec4203',
                'Failed to create untitled markdown file.'
              )
        )
      })
      return
    }
    const worktreeId = store.activeWorktreeId
    if (!worktreeId) {
      return
    }
    const targetGroupId =
      store.activeGroupIdByWorktree[worktreeId] ?? store.groupsByWorktree[worktreeId]?.[0]?.id
    if (targetGroupId) {
      void store.openNewMarkdownInActiveWorkspace(targetGroupId)
    }
  })
)

// Why: emulator IPC is additive; guard so older clients or partial preload mocks don't crash the hook when it's absent.
const unsubscribeNewSimulatorTab = window.api.ui.onNewSimulatorTab?.(() => {
  if (isRuntimeEnvironmentActive()) {
    return
  }
  const store = useAppStore.getState()
  const worktreeId = store.activeWorktreeId
  if (!worktreeId) {
    return
  }
  void openMobileEmulatorTab(worktreeId, { placement: 'rightSplit' })
})
if (unsubscribeNewSimulatorTab) {
  unsubs.push(unsubscribeNewSimulatorTab)
}

const unsubscribeEmulatorAutoAttach = window.api.emulator?.onAutoAttach(
  ({ worktreeId, info }) => {
    if (isRuntimeEnvironmentActive()) {
      return
    }
    if (isManualSimulatorLaunchPending(worktreeId)) {
      // Why: manual launches pre-attach so the ready pane opens in the right split, not as a hidden tab in this group.
      rememberPrelaunchedSimulatorSession(worktreeId, info)
      return
    }
    ensureSimulatorTab(worktreeId, { surfacePane: false })
    // Why: watcher may detect a helper while a simulator tab is already mounted; push stream info so the pane updates without re-attach.
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('orca:emulator-auto-attach', {
          detail: { worktreeId, info }
        })
      )
    }, 0)
  }
)
if (unsubscribeEmulatorAutoAttach) {
  unsubs.push(unsubscribeEmulatorAutoAttach)
}

const unsubscribeEmulatorPaneFocus = window.api.emulator?.onPaneFocus(({ worktreeId }) => {
  if (isRuntimeEnvironmentActive()) {
    return
  }
  ensureSimulatorTab(worktreeId, { surfacePane: true })
})
if (unsubscribeEmulatorPaneFocus) {
  unsubs.push(unsubscribeEmulatorPaneFocus)
}

}
