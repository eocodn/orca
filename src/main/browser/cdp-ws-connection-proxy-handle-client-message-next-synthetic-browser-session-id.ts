import type { WebSocket } from 'ws'

export const CdpWsProxyMethods4 = {
  handleClientMessage(this: any, client: WebSocket, raw: string): void {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.id == null || !msg.method) {
      return
    }
    const clientId = msg.id
    const responseSessionIds = this.responseSessionIdsByClient.get(client) ?? new Map()
    if (msg.sessionId) {
      responseSessionIds.set(clientId, msg.sessionId)
    } else {
      responseSessionIds.delete(clientId)
    }
    this.responseSessionIdsByClient.set(client, responseSessionIds)

    if (msg.method === 'Target.getTargets') {
      this.sendResult(clientId, { targetInfos: [this.buildTargetInfo()] }, client)
      return
    }
    if (msg.method === 'Target.getTargetInfo') {
      this.sendResult(clientId, { targetInfo: this.buildTargetInfo() }, client)
      return
    }
    if (msg.method === 'Target.setDiscoverTargets' || msg.method === 'Target.detachFromTarget') {
      if (msg.method === 'Target.detachFromTarget') {
        const detachedSessionId = msg.params?.sessionId
        if (typeof detachedSessionId === 'string') {
          this.clientSessionIds.delete(detachedSessionId)
          this.clientBrowserSessionIds.delete(detachedSessionId)
          if (detachedSessionId === this.clientSessionId) {
            this.clientSessionId = this.clientSessionIds.values().next().value
          }
        }
      }
      this.sendResult(clientId, {}, client)
      return
    }
    if (msg.method === 'Target.attachToBrowserTarget') {
      // Why: Playwright needs a distinct browser session before it attaches to the selected page.
      const sessionId = this.nextSyntheticBrowserSessionId()
      this.clientBrowserSessionIds.add(sessionId)
      this.sendResult(clientId, { sessionId }, client)
      return
    }
    if (msg.method === 'Target.attachToTarget') {
      const sessionId = this.nextSyntheticPageSessionId()
      this.clientSessionIds.add(sessionId)
      this.clientSessionId ??= sessionId
      this.sendResult(clientId, { sessionId }, client)
      return
    }
    if (msg.method === 'Browser.getVersion') {
      // Why: returning "Orca/Electron" identifies this as an embedded automation
      // surface to agent-browser. Use a generic Chrome product string instead.
      const chromeVersion = process.versions.chrome ?? '134.0.0.0'
      this.sendResult(
        clientId,
        {
          protocolVersion: '1.3',
          product: `Chrome/${chromeVersion}`,
          userAgent: '',
          jsVersion: ''
        },
        client
      )
      return
    }
    const effectiveSessionId = this.resolveDebuggerSessionId(msg.sessionId)
    // Why: a stored focus is only valid for the immediately following Input.insertText;
    // any other command may have moved DOM focus, so invalidate the replay in one place.
    if (msg.method !== 'DOM.focus' && msg.method !== 'Input.insertText') {
      this.pendingDomFocusBySession.delete(effectiveSessionId)
    }
    if (msg.method === 'Page.bringToFront') {
      if (!this.webContents.isDestroyed()) {
        this.webContents.focus()
      }
      this.sendResult(clientId, {}, client)
      return
    }
    if (msg.method === 'DOM.focus') {
      this.forwardDomFocus(client, clientId, msg.params ?? {}, effectiveSessionId)
      return
    }
    // Why: Page.captureScreenshot via debugger.sendCommand hangs on Electron webview guests.
    if (msg.method === 'Page.captureScreenshot') {
      this.handleScreenshot(client, clientId, msg.params)
      return
    }
    // Why: CDP Page.printToPDF is not available for Electron webview guests.
    // Electron's native printToPDF path is the reliable equivalent.
    if (msg.method === 'Page.printToPDF') {
      void this.handlePrintToPdf(client, clientId, msg.params ?? {})
      return
    }
    if (msg.method === 'IO.read') {
      const params = msg.params ?? {}
      if (this.pdfStreams.ownsHandle(params)) {
        this.handleStreamRead(client, clientId, params)
        return
      }
      this.forwardCommand(client, clientId, msg.method, params, msg.sessionId)
      return
    }
    if (msg.method === 'IO.close') {
      const params = msg.params ?? {}
      if (this.pdfStreams.ownsHandle(params)) {
        this.handleStreamClose(client, clientId, params)
        return
      }
      this.forwardCommand(client, clientId, msg.method, params, msg.sessionId)
      return
    }
    // Why: Input.insertText can still require native focus in Electron webviews.
    // Do not auto-focus generic Runtime.evaluate/callFunctionOn traffic: wait
    // polling and read-only JS probes use those methods heavily, and focusing on
    // every eval steals the user's foreground window while background automation
    // is running.
    if (msg.method === 'Input.insertText' && !this.webContents.isDestroyed()) {
      this.webContents.focus()
      void this.forwardInsertText(client, clientId, msg.params ?? {}, effectiveSessionId)
      return
    }
    // Why: agent-browser waits for network idle to detect navigation completion.
    // Electron webview CDP subscriptions silently lapse after cross-process swaps.
    // Page.reload needs the same priming: forwarding it unprimed closed the tab (#7031).
    if (msg.method === 'Page.navigate' && !this.webContents.isDestroyed()) {
      void this.navigateWithLifecycle(client, clientId, msg.params ?? {}, msg.sessionId)
      return
    }
    // Why: CDP Page.reload can destroy Electron webview targets during process swaps.
    // Use the same direct webContents reload path as Orca's own browser.reload.
    if (msg.method === 'Page.reload' && !this.webContents.isDestroyed()) {
      void this.reloadWithLifecycle(client, clientId, msg.params ?? {}, msg.sessionId)
      return
    }
    this.forwardCommand(client, clientId, msg.method, msg.params ?? {}, msg.sessionId)
  },
  resolveDebuggerSessionId(this: any, msgSessionId?: string): string | undefined {
    const syntheticSession =
      (msgSessionId && this.clientSessionIds.has(msgSessionId)) ||
      (msgSessionId && this.clientBrowserSessionIds.has(msgSessionId))
    return msgSessionId && !syntheticSession ? msgSessionId : undefined
  },
  nextSyntheticPageSessionId(this: any): string {
    this.nextClientSessionOrdinal += 1
    return this.nextClientSessionOrdinal === 1
      ? 'orca-proxy-session'
      : `orca-proxy-session-${this.nextClientSessionOrdinal}`
  },
  nextSyntheticBrowserSessionId(this: any): string {
    this.nextClientBrowserSessionOrdinal += 1
    return this.nextClientBrowserSessionOrdinal === 1
      ? 'orca-proxy-browser-session'
      : `orca-proxy-browser-session-${this.nextClientBrowserSessionOrdinal}`
  }
}
export type CdpWsProxyMethods4Surface = typeof CdpWsProxyMethods4
