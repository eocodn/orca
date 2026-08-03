import { BrowserWindow } from './orca-runtime-symbols'
import { OrcaRuntimeBrowserScreencastPart87 } from './orca-runtime-browser-screencast-part-87'

export class OrcaRuntimeGetAuthoritativeWindowPart88 extends OrcaRuntimeBrowserScreencastPart87 {
  protected getAuthoritativeWindow(): BrowserWindow {
    const win = this.getAvailableAuthoritativeWindow()
    if (!win || win.isDestroyed()) {
      throw new Error('No renderer window available')
    }
    return win
  }
  protected getAvailableAuthoritativeWindow(): BrowserWindow | null {
    if (this.authoritativeWindowId === null) {
      return null
    }
    if (!BrowserWindow?.fromId) {
      return null
    }
    const win = BrowserWindow.fromId(this.authoritativeWindowId)
    return win && !win.isDestroyed() ? win : null
  }
}
