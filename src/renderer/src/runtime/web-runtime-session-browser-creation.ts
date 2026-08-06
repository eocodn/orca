import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { BrowserTabCreateResult } from '../../../shared/runtime-types'
import { useAppStore } from '../store'
import { unwrapRuntimeRpcResult } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { recordWebSessionFocusIntent } from './web-session-focus-intent'
import {
  captureRuntimeEnvironmentCall,
  captureWebSessionIntentOwner,
  matchesWebSessionIntentOwner
} from './web-runtime-session-terminal-creation'
import {
  isWebRuntimeSessionActive,
  refreshWebRuntimeSessionTabsSnapshot,
  selectWebRuntimeSessionWorktree,
  stageWebRuntimeBrowserTab
} from './web-runtime-session-transport'

export async function createWebRuntimeSessionBrowserTab(args: {
  worktreeId: string
  environmentId?: string | null
  url?: string
  profileId?: string | null
  targetGroupId?: string
  selectWorktree?: boolean
}): Promise<boolean> {
  const environmentId =
    args.environmentId?.trim() ??
    useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim() ??
    null
  if (!environmentId || !isWebRuntimeSessionActive(environmentId)) {
    return false
  }
  const intentOwner = captureWebSessionIntentOwner(environmentId)
  const callEnvironment = captureRuntimeEnvironmentCall(environmentId, intentOwner.pairingRevision)

  const shouldSelectWorktree = args.selectWorktree !== false
  const stagedFromWorktreeId = useAppStore.getState().activeWorktreeId
  if (shouldSelectWorktree) {
    selectWebRuntimeSessionWorktree(args.worktreeId, environmentId)
  }
  try {
    const response = await callEnvironment({
      method: 'browser.tabCreate',
      params: {
        worktree: toRuntimeWorktreeSelector(args.worktreeId),
        url: args.url,
        profileId: args.profileId ?? undefined,
        // Why: user clicked "New Browser Tab", so mark it active in the snapshot, else the reconcile snaps back to a terminal.
        activate: true,
        // Why: place the new browser in the clicked split group so the host snapshot is authoritative for it (no left-snap).
        ...(args.targetGroupId ? { targetGroupId: args.targetGroupId } : {}),
        // Why: web clients need the local tab now; waiting for host webview registration makes the workspace appear to close.
        waitForRegistration: false
      },
      timeoutMs: 15_000
    })
    const created = unwrapRuntimeRpcResult(response as RuntimeRpcResponse<BrowserTabCreateResult>)
    // Why: record focus intent (tab id === browserPageId on a headless host) so the reconcile follows to the new browser tab.
    if (matchesWebSessionIntentOwner(intentOwner)) {
      recordWebSessionFocusIntent(intentOwner, args.worktreeId, created.browserPageId)
    }
    stageWebRuntimeBrowserTab({
      environmentId,
      worktreeId: args.worktreeId,
      remotePageId: created.browserPageId,
      url: args.url,
      targetGroupId: args.targetGroupId,
      restoreFocus:
        shouldSelectWorktree &&
        (stagedFromWorktreeId === args.worktreeId ||
          useAppStore.getState().activeWorktreeId === args.worktreeId)
    })
    void refreshWebRuntimeSessionTabsSnapshot(environmentId, args.worktreeId, {
      expectedEnvironmentPairingRevision: intentOwner.pairingRevision
    })
    return true
  } catch (error) {
    console.warn(
      '[web-runtime-session] failed to create browser tab:',
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}
