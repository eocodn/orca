import { defineMethod, type RpcAnyMethod } from '../core'
import {
  TerminalHandle,
  TerminalSetDisplayMode,
  TerminalUpdateViewport
} from './terminal-schemas'
import { updateViewportForClient } from './terminal-stream-state'

export const TERMINAL_DISPLAY_MODE_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'terminal.setDisplayMode',
    params: TerminalSetDisplayMode,
    handler: async (params, { runtime }) => {
      // Why: a stale handle must fail with terminal_handle_stale, not mutate the wrong PTY's display mode/viewport (#7718).
      const leaf = runtime.resolveLiveLeafForHandle(params.terminal)
      if (!leaf?.ptyId) {
        throw new Error('no_connected_pty')
      }
      // Why: late-bind viewport for desktop-subscribed callers; otherwise an 'auto' toggle skips phone-fit and nothing resizes.
      if (params.viewport && params.client?.id) {
        runtime.updateMobileSubscriberViewport(leaf.ptyId, params.client.id, params.viewport)
      }
      if (params.client && params.client.type === 'mobile' && params.mode !== 'desktop') {
        runtime.markMobileActor(leaf.ptyId, params.client.id)
      }
      runtime.setMobileDisplayMode(leaf.ptyId, params.mode)
      await runtime.applyMobileDisplayMode(leaf.ptyId)
      return { mode: params.mode, seq: runtime.getLayout(leaf.ptyId)?.seq }
    }
  }),
  defineMethod({
    name: 'terminal.restoreFit',
    params: TerminalHandle,
    handler: async (params, { runtime }) => {
      // Why: a stale handle must fail with terminal_handle_stale, not reclaim the wrong PTY to desktop dims (#7718).
      const leaf = runtime.resolveLiveLeafForHandle(params.terminal)
      if (!leaf?.ptyId) {
        throw new Error('no_connected_pty')
      }
      return { restored: await runtime.reclaimTerminalForDesktop(leaf.ptyId) }
    }
  }),
  defineMethod({
    name: 'terminal.getDisplayMode',
    params: TerminalHandle,
    handler: async (params, { runtime }) => {
      const leaf = runtime.resolveLeafForHandle(params.terminal)
      const mode = leaf?.ptyId ? runtime.getMobileDisplayMode(leaf.ptyId) : 'auto'
      const isPhoneFitted = leaf?.ptyId ? runtime.isMobileSubscriberActive(leaf.ptyId) : false
      return { mode, isPhoneFitted }
    }
  }),
  defineMethod({
    name: 'terminal.updateViewport',
    params: TerminalUpdateViewport,
    handler: async (params, { runtime }) => {
      // Why: a stale handle must fail with terminal_handle_stale, not write viewport state to the wrong PTY (#7718).
      const leaf = runtime.resolveLiveLeafForHandle(params.terminal)
      if (!leaf?.ptyId) {
        throw new Error('no_connected_pty')
      }
      const viewportUpdate = await updateViewportForClient(
        runtime,
        leaf.ptyId,
        `viewport:${params.client.id}`,
        params.client,
        params.viewport,
        'mobile',
        // Why: one-shot RPC with no disconnect hook — refresh the existing stream-owned floor, never create a leak-prone one.
        'refresh',
        params.claim === true
      )
      return { ...viewportUpdate, seq: runtime.getLayout(leaf.ptyId)?.seq }
    }
  }),
]
