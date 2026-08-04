import type { BrowserCertificateTrustController } from './browser-certificate-trust-controller'

export const BrowserManagerMethods1 = {
  setDictationShortcutForwardingPredicate(this: any, predicate: (() => boolean) | null): void {
    this.shouldForwardDictationShortcut = predicate
  },
  setBrowserGuestStateChangedListener(
    this: any,
    listener: ((worktreeId: string) => void) | null
  ): void {
    this.browserGuestStateChangedListener = listener
  },
  setCertificateTrustController(this: any, controller: BrowserCertificateTrustController): void {
    this.certificateTrustController = controller
  },
  installCertificateRequestGuard(this: any, session: Electron.Session): void {
    this.certificateTrustController?.installSessionRequestGuard(session)
  }
}
export type BrowserManagerMethods1Surface = typeof BrowserManagerMethods1
