import type { CdpCommandSender, RefEntry } from './snapshot-engine'

export const CdpBridgeMethods14 = {
  async scrollIntoView(this: any, sender: CdpCommandSender, backendNodeId: number): Promise<void> {
    const { nodeId } = (await sender('DOM.requestNode', { backendNodeId })) as { nodeId: number }
    const { object } = (await sender('DOM.resolveNode', { nodeId })) as {
      object: { objectId: string }
    }
    await sender('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() { this.scrollIntoView({ block: 'center', inline: 'center' }); }`
    })
  },
  async getElementCenter(
    this: any,
    sender: CdpCommandSender,
    backendNodeId: number
  ): Promise<{ cx: number; cy: number }> {
    const { model } = (await sender('DOM.getBoxModel', { backendNodeId })) as {
      model: { content: number[] }
    }
    const [x1, y1, , , x3, y3] = model.content
    return { cx: (x1 + x3) / 2, cy: (y1 + y3) / 2 }
  },
  async getIframeOffset(
    this: any,
    guest: Electron.WebContents,
    sessionId: string
  ): Promise<{ offsetX: number; offsetY: number }> {
    const tabId = this.resolveTabId(guest.id)
    const state = this.getOrCreateTabState(tabId)
    const parentSender = this.makeCdpSender(guest)

    for (const [targetId, sid] of state.iframeSessions) {
      if (sid === sessionId) {
        try {
          // Why: match the iframe's target URL against DOM iframe src to pick the right element on multi-iframe pages.
          const { targetInfo } = (await parentSender('Target.getTargetInfo', {
            targetId
          })) as { targetInfo: { url?: string } }

          const targetUrl = targetInfo?.url

          const { result } = (await parentSender('Runtime.evaluate', {
            expression: `(() => {
              const frames = document.querySelectorAll('iframe, frame');
              const rects = [];
              for (const f of frames) {
                const rect = f.getBoundingClientRect();
                rects.push({ x: rect.x, y: rect.y, src: f.src || '' });
              }
              return JSON.stringify(rects);
            })()`,
            returnByValue: true
          })) as { result: { value: string } }

          const rects = JSON.parse(result.value) as { x: number; y: number; src: string }[]

          // Match by URL first (reliable for cross-origin iframes)
          if (targetUrl) {
            for (const rect of rects) {
              if (rect.src === targetUrl) {
                return { offsetX: rect.x, offsetY: rect.y }
              }
            }
            // Why: iframe may redirect after load so src differs from target URL; match by origin as a fallback.
            try {
              const targetOrigin = new URL(targetUrl).origin
              for (const rect of rects) {
                if (rect.src && new URL(rect.src).origin === targetOrigin) {
                  return { offsetX: rect.x, offsetY: rect.y }
                }
              }
            } catch {
              // URL parsing failed — fall through
            }
          }

          // Fallback: if only one iframe exists, use its position
          if (rects.length === 1) {
            return { offsetX: rects[0].x, offsetY: rects[0].y }
          }
        } catch {
          // Can't determine offset, return zero (best effort)
        }
        break
      }
    }

    return { offsetX: 0, offsetY: 0 }
  },
  async getPageCoordinates(
    this: any,
    guest: Electron.WebContents,
    refEntry: RefEntry,
    localCx: number,
    localCy: number
  ): Promise<{ cx: number; cy: number }> {
    if (!refEntry.sessionId) {
      return { cx: localCx, cy: localCy }
    }
    const { offsetX, offsetY } = await this.getIframeOffset(guest, refEntry.sessionId)
    return { cx: localCx + offsetX, cy: localCy + offsetY }
  }
}
export type CdpBridgeMethods14Surface = typeof CdpBridgeMethods14
