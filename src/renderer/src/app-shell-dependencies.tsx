import React, { useEffect, useState } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { translate } from '@/i18n/i18n'
import { useAppStore } from './store'
import type { RemoteWorkspacePatchResult } from '../../shared/remote-workspace-types'
import type { UpdateStatus } from '../../shared/types'
export function WindowControls(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    // Why: maximize-changed only fires on transitions; seed from main on mount so a startup-maximized window shows the right icon.
    let cancelled = false
    void window.api.ui.isMaximized().then((value) => {
      if (!cancelled) {
        setMaximized(value)
      }
    })
    const unsubscribe = window.api.ui.onMaximizeChanged(setMaximized)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return (
    <div className="window-controls">
      <button
        className="window-controls-btn"
        aria-label={translate('auto.App.bbb7f90669', 'Minimize')}
        onClick={() => window.api.ui.minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10v1H0z" fill="currentColor" />
        </svg>
      </button>
      <button
        className="window-controls-btn"
        aria-label={
          maximized
            ? translate('auto.App.66f0a552e5', 'Restore')
            : translate('auto.App.c9d6f98459', 'Maximize')
        }
        onClick={() => window.api.ui.maximize()}
      >
        {maximized ? (
          // Restore icon (two overlapping squares)
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 0v2H0v8h8V8h2V0H2zm6 9H1V3h7v6zM9 7H8V2H3V1h6v6z" fill="currentColor" />
          </svg>
        ) : (
          // Maximize icon (single square outline)
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        className="window-controls-btn window-controls-close"
        aria-label={translate('auto.App.e960d18540', 'Close')}
        // Why: route close through main so the 'close' event fires the terminal-running confirmation guard; window.close() is unreliable in sandboxed renderers.
        onClick={() => window.api.ui.requestClose()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4-4-4z" fill="currentColor" />
        </svg>
      </button>
    </div>
  )
}

export const Landing = lazy(() => import('./components/Landing'))
export const WorktreeCreationPanel = lazy(
  () => import('./components/worktree-creation/WorktreeCreationPanel')
)
export const TaskPage = lazy(() => import('./components/TaskPage'))
export const ActivityPrototypePage = lazy(
  () => import('./components/activity/ActivityPrototypePage')
)
export const Settings = lazy(() => import('./components/settings/Settings'))
export const SkillsPage = lazy(() => import('./components/skills/SkillsPage'))
export const WorkspaceSpacePage = lazy(
  () => import('./components/workspace-space/WorkspaceSpacePage')
)
export const MobilePage = lazy(() => import('./components/mobile/MobilePage'))
export const QuickOpen = lazy(() => import('./components/QuickOpen'))
export const WorktreeJumpPalette = lazy(() => import('./components/WorktreeJumpPalette'))
export const WorkspaceCleanupDialog = lazy(
  () => import('./components/workspace-cleanup/WorkspaceCleanupDialog')
)
export const Terminal = lazy(() => import('./components/Terminal'))
export const StatusBar = lazy(() =>
  import('./components/status-bar/StatusBar').then((module) => ({ default: module.StatusBar }))
)
export const SetupGuideModal = lazy(() => import('./components/setup-guide/SetupGuideModal'))
export const FeatureWallModal = lazy(() => import('./components/feature-wall/FeatureWallModal'))
export const FeatureTipsModal = lazy(() => import('./components/feature-tips/FeatureTipsModal'))
export const AddRepoDialog = lazy(() => import('./components/sidebar/AddRepoDialog'))
export const NonGitFolderDialog = lazy(() => import('./components/sidebar/NonGitFolderDialog'))
export const AddProjectFromFolderDialog = lazy(
  () => import('./components/sidebar/AddProjectFromFolderDialog')
)
export const ProjectAddedDialog = lazy(() => import('./components/sidebar/ProjectAddedDialog'))
export const DeleteWorktreeDialog = lazy(() => import('./components/sidebar/DeleteWorktreeDialog'))
export const SshPassphraseDialog = lazy(() =>
  import('./components/settings/SshPassphraseDialog').then((module) => ({
    default: module.SshPassphraseDialog
  }))
)
export const UpdateCard = lazy(() =>
  import('./components/UpdateCard').then((module) => ({ default: module.UpdateCard }))
)
export const RemoteServerUpdateDialog = lazy(
  () => import('./components/settings/RemoteServerUpdateDialog')
)
export const ContextualTourOverlay = lazy(() =>
  import('./components/contextual-tours/ContextualTourOverlay').then((module) => ({
    default: module.ContextualTourOverlay
  }))
)
export const FloatingTerminalPanel = lazy(() =>
  import('./components/floating-terminal/FloatingTerminalPanel').then((module) => ({
    default: module.FloatingTerminalPanel
  }))
)
// Why: lazy so the WebP asset + overlay module aren't fetched unless the experimental flag is on.
export const PetOverlay = lazy(() => import('./components/pet/PetOverlay'))
// Why: lazy so onboarding's step modules + assets aren't fetched for users past first-launch.
export const OnboardingFlow = lazy(() => import('./components/onboarding/OnboardingFlow'))

export function applyRemoteWorkspacePatchStatus(
  targetId: string,
  result: RemoteWorkspacePatchResult
): void {
  const store = useAppStore.getState()
  if (result.ok) {
    store.setRemoteWorkspaceSyncStatus(targetId, {
      phase: 'synced',
      direction: 'push',
      revision: result.snapshot.revision,
      updatedAt: result.snapshot.updatedAt,
      lastSyncedAt: Date.now(),
      message: translate('auto.App.332dbfa497', 'Workspace uploaded')
    })
    return
  }
  store.setRemoteWorkspaceSyncStatus(targetId, {
    phase: result.reason === 'stale-revision' ? 'conflict' : 'offline',
    direction: 'push',
    revision: result.snapshot?.revision,
    updatedAt: result.snapshot?.updatedAt,
    lastSyncedAt: Date.now(),
    message:
      result.message ??
      (result.reason === 'stale-revision'
        ? translate(
            'auto.hooks.useIpcEvents.workspaceChangedOnAnotherDevice',
            'Workspace changed on another device'
          )
        : translate('auto.hooks.useIpcEvents.2fe88c2e06', 'Remote workspace sync unavailable'))
  })
}

export function shouldMountUpdateCardForStatus(status: UpdateStatus): boolean {
  if (status.state === 'idle') {
    return false
  }
  if (status.state === 'checking' || status.state === 'not-available') {
    return status.userInitiated === true
  }
  return true
}
