import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/store'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import { normalizeBrowserNavigationUrl, redactKagiSessionToken } from '../../../../shared/browser-url'
import type { BrowserBackResult, BrowserGotoResult, BrowserReloadResult } from '../../../../shared/runtime-types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { consumeBrowserFocusRequest, ORCA_BROWSER_FOCUS_REQUEST_EVENT, type BrowserFocusRequestDetail } from './browser-focus'
import { getShortcutPlatform } from '@/hooks/useShortcutLabel'
import type { RemoteSurfaceBase } from './browser-pane-remote-surface-base'
import type { RemoteSurfaceRuntime } from './browser-pane-remote-surface-runtime'
import { isRemoteBrowserPageMissingError } from './browser-pane-remote-model'

export function useRemoteBrowserSurfaceNavigation(base: RemoteSurfaceBase, runtime: RemoteSurfaceRuntime) {
  const runRemoteNavigation = useCallback(async (method: 'browser.goto' | 'browser.back' | 'browser.forward' | 'browser.reload', url?: string): Promise<void> => {
    const target = base.runtimeTarget()
    if (!target) return
    const operationToken = base.createRemoteOperationToken()
    if (!operationToken) return
    const pageId = await runtime.ensureRemotePage(operationToken)
    if (!pageId) return
    const pageToken = { ...operationToken, remotePageId: pageId }
    if (!base.isCurrentRemoteOperationToken(pageToken)) return
    base.setBusy(true)
    base.setRemoteError(null)
    base.onUpdatePageState(base.browserTab.id, { loading: true, loadError: null })
    try {
      const params = method === 'browser.goto' ? { worktree: base.runtimeWorktree, page: pageId, url: url ?? 'about:blank' } : { worktree: base.runtimeWorktree, page: pageId }
      const result = await callRuntimeRpc<BrowserGotoResult | BrowserBackResult | BrowserReloadResult>(target, method, params, { timeoutMs: 30_000, suppressFeatureInteraction: true })
      if (base.isCurrentRemoteOperationToken(pageToken)) runtime.applyRemoteTabInfo(result)
    } catch (error) {
      if (!base.isCurrentRemoteOperationToken(pageToken)) return
      if (isRemoteBrowserPageMissingError(error)) { base.closeMissingRemotePage(pageId); return }
      const message = error instanceof Error ? error.message : 'Remote browser command failed.'
      base.setRemoteError(message)
      base.onUpdatePageState(base.browserTab.id, { loading: false, loadError: { code: 0, description: message, validatedUrl: redactKagiSessionToken(url ?? base.browserTab.url) } })
    } finally {
      if (base.isCurrentRemoteOperationToken(pageToken)) base.setBusy(false)
    }
  }, [base, runtime])

  const navigateToUrl = useCallback((url: string): void => { void runRemoteNavigation('browser.goto', url) }, [runRemoteNavigation])

  useEffect(() => {
    if (!base.isActive) return
    const shortcutPlatform = getShortcutPlatform()
    const handleKeyDown = (event: KeyboardEvent): void => {
      const method = keybindingMatchesAction('browser.back', event, shortcutPlatform, base.keybindings) ? 'browser.back' : keybindingMatchesAction('browser.forward', event, shortcutPlatform, base.keybindings) ? 'browser.forward' : null
      if (!method) return
      event.preventDefault()
      event.stopPropagation()
      void runRemoteNavigation(method)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [base.isActive, base.keybindings, runRemoteNavigation])

  useEffect(() => {
    if (!base.isActive) return
    const handleBrowserFocusRequest = (event: Event): void => {
      const detail = (event as CustomEvent<BrowserFocusRequestDetail>).detail
      if (!detail || detail.pageId !== base.browserTab.id) return
      const focusTarget = consumeBrowserFocusRequest(base.browserTab.id)
      if (!focusTarget) return
      if (focusTarget === 'address-bar') { base.addressBarInputRef.current?.focus(); base.addressBarInputRef.current?.select(); return }
      ;(base.imageRef.current ?? base.remoteViewportRef.current)?.focus()
    }
    window.addEventListener(ORCA_BROWSER_FOCUS_REQUEST_EVENT, handleBrowserFocusRequest)
    return () => window.removeEventListener(ORCA_BROWSER_FOCUS_REQUEST_EVENT, handleBrowserFocusRequest)
  }, [base.addressBarInputRef, base.browserTab.id, base.imageRef, base.isActive, base.remoteViewportRef])

  const submitAddressBar = useCallback((): void => {
    const searchEngine = useAppStore.getState().browserDefaultSearchEngine
    const kagiSessionLink = useAppStore.getState().browserKagiSessionLink
    const nextUrl = normalizeBrowserNavigationUrl(base.addressBarValue, searchEngine, { kagiSessionLink })
    if (!nextUrl) {
      const message = 'Enter a valid http(s) or localhost URL.'
      base.setRemoteError(message)
      base.onUpdatePageState(base.browserTab.id, { loadError: { code: 0, description: message, validatedUrl: redactKagiSessionToken(base.addressBarValue.trim()) || 'about:blank' } })
      return
    }
    navigateToUrl(nextUrl)
  }, [base, navigateToUrl])

  return { navigateToUrl, runRemoteNavigation, submitAddressBar }
}

export type RemoteSurfaceNavigation = ReturnType<typeof useRemoteBrowserSurfaceNavigation>
