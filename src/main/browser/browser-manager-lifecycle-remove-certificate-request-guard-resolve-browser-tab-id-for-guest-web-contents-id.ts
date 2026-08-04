import { ANTI_DETECTION_SCRIPT } from './anti-detection'
import type { KeybindingOverrides } from '../../shared/keybindings'

export const BrowserManagerMethods2 = {
  removeCertificateRequestGuard(this: any, session: Electron.Session): void {
    this.certificateTrustController?.removeSessionRequestGuard(session)
  },
  setSettingsResolver(
    this: any,
    resolver: () => {
      keybindings?: KeybindingOverrides
    }
  ): void {
    this.settingsResolver = resolver
  },
  injectAntiDetection(this: any, guest: Electron.WebContents): () => void {
    let disposed = false
    let reattachTimer: ReturnType<typeof setTimeout> | null = null

    const attach = (): void => {
      if (disposed || guest.isDestroyed()) {
        return
      }
      try {
        if (!guest.debugger.isAttached()) {
          guest.debugger.attach('1.3')
        }
        void guest.debugger
          .sendCommand('Page.enable', {})
          .then(() =>
            guest.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
              source: ANTI_DETECTION_SCRIPT
            })
          )
          .catch(() => {})
      } catch {
        /* best-effort — debugger may be unavailable */
      }
    }

    // Why: proxy/bridge stop detaches the debugger and drops injections; re-attach (500ms delay to avoid racing a mid-restart) to keep overrides.
    const onDetach = (): void => {
      if (!disposed && !guest.isDestroyed() && reattachTimer === null) {
        reattachTimer = setTimeout(() => {
          reattachTimer = null
          attach()
        }, 500)
      }
    }

    try {
      attach()
      guest.debugger.on('detach', onDetach)
    } catch {
      /* best-effort */
    }

    return () => {
      disposed = true
      if (reattachTimer !== null) {
        clearTimeout(reattachTimer)
        reattachTimer = null
      }
      try {
        guest.debugger.off('detach', onDetach)
      } catch {
        /* guest may already be destroyed */
      }
    }
  },
  resolveBrowserTabIdForGuestWebContentsId(this: any, guestWebContentsId: number): string | null {
    return this.resolvePopupOwnerContext(guestWebContentsId)?.browserTabId ?? null
  }
}
export type BrowserManagerMethods2Surface = typeof BrowserManagerMethods2
