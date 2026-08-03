// Browser IPC handlers and tab lifecycle implementation.
import { webContents } from 'electron'
import { browserManager } from '../browser/browser-manager'
import type { AgentBrowserBridge } from '../browser/agent-browser-bridge'

export let trustedBrowserRendererWebContentsId: number | null = null
export let agentBrowserBridgeRef: AgentBrowserBridge | null = null

// Why: CLI-driven tab creation must wait until the renderer mounts the webview
// and calls registerGuest, so the tab has a webContentsId and is operable by
// subsequent commands. Multiple commands can wait for the same page during
// startup, so keep all one-shot resolvers keyed by browserPageId.
export const pendingTabRegistrations = new Map<string, Set<() => void>>()
export const pendingWorktreeTabRegistrations = new Map<string, Set<() => void>>()
export const pendingAnyTabRegistrations = new Set<() => void>()
export const grabModeIntentByPageId = new Map<string, { generation: number; enabled: boolean }>()
export const grabModeOperationByPageId = new Map<string, Promise<void>>()
export const GRAB_REGISTRATION_WAIT_MS = 1_000

export function waitForRegistrationSet(
  registrationResolvers: Set<() => void>,
  timeoutMs: number,
  onEmpty: () => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const resolveRegistration = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      registrationResolvers.delete(resolveRegistration)
      if (registrationResolvers.size === 0) {
        onEmpty()
      }
      reject(new Error('Tab registration timed out'))
    }, timeoutMs)
    registrationResolvers.add(resolveRegistration)
  })
}

export function resolvePendingRegistrations(registrationResolvers: Set<() => void> | undefined): void {
  if (!registrationResolvers) {
    return
  }
  for (const pendingResolve of registrationResolvers) {
    pendingResolve()
  }
}

export function isLiveBrowserWebContentsId(webContentsId: number | null | undefined): boolean {
  if (webContentsId == null) {
    return false
  }
  const guest = webContents.fromId(webContentsId)
  return Boolean(guest && !guest.isDestroyed())
}

export function hasRegisteredTabForWorktree(worktreeId: string): boolean {
  for (const [browserPageId, webContentsId] of browserManager.getWebContentsIdByTabId()) {
    if (
      browserManager.getWorktreeIdForTab(browserPageId) === worktreeId &&
      isLiveBrowserWebContentsId(webContentsId)
    ) {
      return true
    }
  }
  return false
}

export function waitForTabRegistration(browserPageId: string, timeoutMs = 8_000): Promise<void> {
  if (isLiveBrowserWebContentsId(browserManager.getGuestWebContentsId(browserPageId))) {
    return Promise.resolve()
  }
  return waitForNextTabRegistration(browserPageId, timeoutMs)
}

export function waitForNextTabRegistration(browserPageId: string, timeoutMs: number): Promise<void> {
  let registrationResolvers = pendingTabRegistrations.get(browserPageId)
  if (!registrationResolvers) {
    registrationResolvers = new Set()
    pendingTabRegistrations.set(browserPageId, registrationResolvers)
  }
  return waitForRegistrationSet(registrationResolvers, timeoutMs, () => {
    pendingTabRegistrations.delete(browserPageId)
  })
}

export function queueGrabModeOperation(
  browserPageId: string,
  operation: () => Promise<BrowserSetGrabModeResult>
): Promise<BrowserSetGrabModeResult> {
  const previous = grabModeOperationByPageId.get(browserPageId) ?? Promise.resolve()
  const result = previous.then(operation)
  const completion = result.then(
    () => {},
    () => {}
  )
  grabModeOperationByPageId.set(browserPageId, completion)
  return result.finally(() => {
    if (grabModeOperationByPageId.get(browserPageId) === completion) {
      grabModeOperationByPageId.delete(browserPageId)
    }
  })
}

export function waitForWorktreeTabRegistration(
  worktreeId: string | undefined,
  timeoutMs = 8_000
): Promise<void> {
  if (!worktreeId) {
    return waitForAnyTabRegistration(timeoutMs)
  }
  if (hasRegisteredTabForWorktree(worktreeId)) {
    return Promise.resolve()
  }
  let registrationResolvers = pendingWorktreeTabRegistrations.get(worktreeId)
  if (!registrationResolvers) {
    registrationResolvers = new Set()
    pendingWorktreeTabRegistrations.set(worktreeId, registrationResolvers)
  }
  return waitForRegistrationSet(registrationResolvers, timeoutMs, () => {
    pendingWorktreeTabRegistrations.delete(worktreeId)
  })
}

export function waitForAnyTabRegistration(timeoutMs = 8_000): Promise<void> {
  for (const webContentsId of browserManager.getWebContentsIdByTabId().values()) {
    if (isLiveBrowserWebContentsId(webContentsId)) {
      return Promise.resolve()
    }
  }
  return waitForRegistrationSet(pendingAnyTabRegistrations, timeoutMs, () => {})
}

export function setTrustedBrowserRendererWebContentsId(webContentsId: number | null): void {
  trustedBrowserRendererWebContentsId = webContentsId
}

export function setAgentBrowserBridgeRef(bridge: AgentBrowserBridge | null): void {
  agentBrowserBridgeRef = bridge
}

export function isTrustedBrowserRenderer(sender: Electron.WebContents): boolean {
  if (sender.isDestroyed() || sender.getType() !== 'window') {
    return false
  }
  if (trustedBrowserRendererWebContentsId != null) {
    return sender.id === trustedBrowserRendererWebContentsId
  }

  const senderUrl = sender.getURL()
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(senderUrl).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    } catch {
      return false
    }
  }

  return senderUrl.startsWith('file://')
}
