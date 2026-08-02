import { useCallback, useEffect } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { redactKagiSessionToken } from '../../../../shared/browser-url'
import { getRemoteBrowserKeypressKey, getRemoteBrowserKeyboardShortcut } from './remote-browser-keyboard'
import { isEditableKeyboardTarget } from './browser-keyboard'
import {
  buildRemoteContextMenuExpression,
  getRemoteBrowserMouseButton,
  isRemoteBrowserPageMissingError,
  readRemoteContextMenuResult
} from './browser-pane-remote-model'
import type { RemoteSurfaceBase } from './browser-pane-remote-surface-base'
import type { RemoteSurfaceRuntime } from './browser-pane-remote-surface-runtime'

export function useRemoteBrowserSurfaceInput(base: RemoteSurfaceBase, runtime: RemoteSurfaceRuntime) {
  const handleRemotePointerDown = (event: React.PointerEvent<HTMLImageElement>): void => {
    if (base.busy) return
    const target = base.runtimeTarget()
    const pageId = base.remotePageIdRef.current
    const operationToken = pageId ? base.createRemoteOperationToken(pageId) : null
    const point = base.getRemoteImagePoint(event)
    const button = getRemoteBrowserMouseButton(event.button)
    if (button === 'right' || !target || !pageId || !base.imageRef.current || !operationToken || !point) return
    event.preventDefault()
    base.imageRef.current.focus()
    base.setContextMenu(null)
    base.setRemoteError(null)
    void base.enqueueRemoteInput(async () => {
      if (!base.isCurrentRemoteOperationToken(operationToken)) return
      try {
        const params = { worktree: base.runtimeWorktree, page: pageId }
        await callRuntimeRpc(target, 'browser.mouseMove', { ...params, x: point.x, y: point.y }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
        await callRuntimeRpc(target, 'browser.mouseDown', { ...params, button }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
      } catch (error) {
        if (!base.isCurrentRemoteOperationToken(operationToken)) return
        if (isRemoteBrowserPageMissingError(error)) { base.closeMissingRemotePage(pageId); return }
        base.setRemoteError(error instanceof Error ? error.message : 'Remote mouse input failed.')
      }
    })
  }

  const handleRemotePointerUp = (event: React.PointerEvent<HTMLImageElement>): void => {
    if (base.busy) return
    const target = base.runtimeTarget()
    const pageId = base.remotePageIdRef.current
    const operationToken = pageId ? base.createRemoteOperationToken(pageId) : null
    const point = base.getRemoteImagePoint(event)
    const button = getRemoteBrowserMouseButton(event.button)
    if (button === 'right' || !target || !pageId || !operationToken || !point) return
    event.preventDefault()
    base.setRemoteError(null)
    void base.enqueueRemoteInput(async () => {
      if (!base.isCurrentRemoteOperationToken(operationToken)) return
      try {
        const params = { worktree: base.runtimeWorktree, page: pageId }
        await callRuntimeRpc(target, 'browser.mouseMove', { ...params, x: point.x, y: point.y }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
        await callRuntimeRpc(target, 'browser.mouseUp', { ...params, button }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
        runtime.scheduleRemoteTabInfoRefresh(operationToken, 250)
      } catch (error) {
        if (!base.isCurrentRemoteOperationToken(operationToken)) return
        if (isRemoteBrowserPageMissingError(error)) { base.closeMissingRemotePage(pageId); return }
        base.setRemoteError(error instanceof Error ? error.message : 'Remote mouse input failed.')
      }
    })
  }

  const handleRemoteContextMenu = (event: React.MouseEvent<HTMLImageElement>): void => {
    if (base.busy) return
    const target = base.runtimeTarget()
    const pageId = base.remotePageIdRef.current
    const point = base.getRemoteImagePoint(event)
    if (!target || !pageId || !point) return
    event.preventDefault()
    base.imageRef.current?.focus()
    base.setRemoteError(null)
    base.setContextMenu({ x: event.clientX, y: event.clientY, linkUrl: null, pageUrl: base.browserTab.url || 'about:blank', selectionText: '' })
    void base.enqueueRemoteInput(async () => {
      const operationToken = base.createRemoteOperationToken(pageId)
      if (!operationToken || !base.isCurrentRemoteOperationToken(operationToken)) return
      try {
        const result = await callRuntimeRpc(target, 'browser.eval', { worktree: base.runtimeWorktree, page: pageId, expression: buildRemoteContextMenuExpression(point.x, point.y) }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
        const parsed = readRemoteContextMenuResult(result)
        if (parsed && base.mountedRef.current && base.isCurrentRemoteOperationToken(operationToken)) {
          base.setContextMenu((current) => current ? { ...current, linkUrl: parsed.linkUrl, pageUrl: redactKagiSessionToken(parsed.pageUrl), selectionText: parsed.selectionText } : current)
        }
      } catch (error) {
        if (base.isCurrentRemoteOperationToken(operationToken) && isRemoteBrowserPageMissingError(error)) base.closeMissingRemotePage(pageId)
      }
    })
  }

  const handleRemoteScreenshotKeyDown = (event: React.KeyboardEvent<HTMLImageElement>): void => {
    if (isEditableKeyboardTarget(event.target)) return
    const target = base.runtimeTarget()
    const pageId = base.remotePageIdRef.current
    const operationToken = pageId ? base.createRemoteOperationToken(pageId) : null
    if (!target || !pageId || !operationToken) return
    const key = getRemoteBrowserKeyboardShortcut(event) ?? getRemoteBrowserKeypressKey(event)
    if (!key) return
    event.preventDefault()
    base.setRemoteError(null)
    void base.enqueueRemoteInput(async () => {
      if (!base.isCurrentRemoteOperationToken(operationToken)) return
      try {
        await callRuntimeRpc(target, 'browser.keypress', { worktree: base.runtimeWorktree, page: pageId, key }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
        if (['Enter', 'Meta+r', 'Meta+Shift+r', 'Control+r', 'Control+Shift+r'].includes(key)) runtime.scheduleRemoteTabInfoRefresh(operationToken, 400)
      } catch (error) {
        if (!base.isCurrentRemoteOperationToken(operationToken)) return
        if (isRemoteBrowserPageMissingError(error)) { base.closeMissingRemotePage(pageId); return }
        base.setRemoteError(error instanceof Error ? error.message : 'Remote keyboard input failed.')
      }
    })
  }

  const schedulePendingRemoteWheel = useCallback((): void => {
    if (base.remoteWheelFrameRef.current !== null || base.remoteWheelInFlightRef.current) return
    base.remoteWheelFrameRef.current = window.requestAnimationFrame(() => {
      base.remoteWheelFrameRef.current = null
      const pending = base.pendingRemoteWheelRef.current
      if (!pending || base.remoteWheelInFlightRef.current) return
      base.pendingRemoteWheelRef.current = null
      base.remoteWheelInFlightRef.current = true
      const { target, pageId, operationToken, point, dx, dy } = pending
      void base.enqueueRemoteInput(async () => {
        if (!base.isCurrentRemoteOperationToken(operationToken)) return
        try {
          const params = { worktree: base.runtimeWorktree, page: pageId }
          await callRuntimeRpc(target, 'browser.mouseMove', { ...params, x: point.x, y: point.y }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
          await callRuntimeRpc(target, 'browser.mouseWheel', { ...params, dx, dy }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
          runtime.scheduleRemoteTabInfoRefresh(operationToken, 400)
        } catch (error) {
          if (!base.isCurrentRemoteOperationToken(operationToken)) return
          if (isRemoteBrowserPageMissingError(error)) { base.closeMissingRemotePage(pageId); return }
          base.setRemoteError(error instanceof Error ? error.message : 'Remote scroll failed.')
        }
      }).finally(() => {
        base.remoteWheelInFlightRef.current = false
        if (base.pendingRemoteWheelRef.current) schedulePendingRemoteWheel()
      })
    })
  }, [base, runtime])

  const handleRemoteScreenshotWheel = useCallback((event: WheelEvent): void => {
    if (base.busy) { event.preventDefault(); return }
    const target = base.runtimeTarget()
    const pageId = base.remotePageIdRef.current
    const operationToken = pageId ? base.createRemoteOperationToken(pageId) : null
    const point = base.getRemoteImagePoint(event)
    if (!target || !pageId || !operationToken || !point) return
    event.preventDefault()
    base.setRemoteError(null)
    const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? (base.remoteViewportRef.current?.clientHeight ?? 800) : 1
    const dx = Math.round(event.deltaX * deltaMultiplier)
    const dy = Math.round(event.deltaY * deltaMultiplier)
    if (dx === 0 && dy === 0) return
    const current = base.pendingRemoteWheelRef.current
    const sameTarget = current?.target.environmentId === target.environmentId && current.pageId === pageId && current.operationToken.generation === operationToken.generation
    base.pendingRemoteWheelRef.current = sameTarget ? { ...current, point, dx: current.dx + dx, dy: current.dy + dy } : { target, pageId, operationToken, point, dx, dy }
    schedulePendingRemoteWheel()
  }, [base, schedulePendingRemoteWheel])

  useEffect(() => {
    const image = base.imageRef.current
    if (!image || !base.frameUrl) return
    image.addEventListener('wheel', handleRemoteScreenshotWheel, { passive: false })
    return () => image.removeEventListener('wheel', handleRemoteScreenshotWheel)
  }, [base.frameUrl, base.imageRef, handleRemoteScreenshotWheel])

  return { handleRemoteContextMenu, handleRemotePointerDown, handleRemotePointerUp, handleRemoteScreenshotKeyDown, handleRemoteScreenshotWheel, schedulePendingRemoteWheel }
}

export type RemoteSurfaceInput = ReturnType<typeof useRemoteBrowserSurfaceInput>
