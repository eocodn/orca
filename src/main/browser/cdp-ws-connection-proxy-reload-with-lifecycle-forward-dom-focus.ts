import type { WebSocket } from 'ws'

import * as foundation from './cdp-ws-connection-proxy-foundation'
const { LIFECYCLE_PRIMING_TIMEOUT_MS } = foundation

export const CdpWsProxyMethods6 = {
  async reloadWithLifecycle(
    this: any,
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>,
    msgSessionId?: string
  ): Promise<void> {
    const sessionId = this.resolveDebuggerSessionId(msgSessionId)
    const unsupportedParam = sessionId ? null : this.getUnsupportedRootReloadParam(params)
    if (unsupportedParam) {
      this.sendError(
        clientId,
        `Page.reload parameter "${unsupportedParam}" is not supported for Orca tab reloads`,
        client
      )
      return
    }
    await this.primePageLifecycle(sessionId)
    if (!this.isActiveClient(client)) {
      return
    }
    if (sessionId) {
      this.forwardCommand(client, clientId, 'Page.reload', params, msgSessionId)
      return
    }
    if (this.webContents.isDestroyed()) {
      this.sendError(clientId, 'Browser tab is no longer available', client)
      return
    }
    try {
      if (params.ignoreCache === true) {
        this.webContents.reloadIgnoringCache()
      } else {
        this.webContents.reload()
      }
      this.sendResult(clientId, {}, client)
    } catch (err) {
      this.sendError(clientId, err instanceof Error ? err.message : String(err), client)
    }
  },
  getUnsupportedRootReloadParam(this: any, params: Record<string, unknown>): string | null {
    return Object.keys(params).find((key) => key !== 'ignoreCache') ?? null
  },
  async primePageLifecycle(this: any, sessionId?: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const priming = (async (): Promise<void> => {
      // Why: without Network.enable, agent-browser never sees network idle → goto times out.
      await this.sendDebuggerCommand('Network.enable', {}, sessionId)
      await this.sendDebuggerCommand('Page.enable', {}, sessionId)
      await this.sendDebuggerCommand('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId)
    })().catch(() => {})

    try {
      await Promise.race([
        priming,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, LIFECYCLE_PRIMING_TIMEOUT_MS)
          timeout.unref?.()
        })
      ])
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  },
  forwardDomFocus(
    this: any,
    client: WebSocket,
    clientId: number,
    params: Record<string, unknown>,
    effectiveSessionId?: string
  ): void {
    const focused = this.sendDomFocus(client, clientId, params, effectiveSessionId)
    this.pendingDomFocusBySession.set(effectiveSessionId, focused)
  }
}
export type CdpWsProxyMethods6Surface = typeof CdpWsProxyMethods6
