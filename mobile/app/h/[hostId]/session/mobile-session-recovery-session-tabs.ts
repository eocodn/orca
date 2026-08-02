import { useCallback } from 'react'
import { runAcceptedMobileSessionTabsEffects } from '../../../../src/session/mobile-session-tabs-accepted-effects'
import { useMobileSessionTabsFetchReporting } from '../../../../src/session/use-mobile-session-tabs-fetch-reporting'
import { useMobileSessionTabsReconciliation } from '../../../../src/session/use-mobile-session-tabs-reconciliation'
import type { SessionTabsStreamSource } from '../../../../src/session/mobile-session-tabs-stream-health'
import type { MobileSessionTab, SessionTabsResult } from './mobile-session-route-types'

type SessionRecoveryContext = Record<string, any>

export function useMobileSessionRecoverySessionTabs(context: SessionRecoveryContext) {
  const {
    pendingBrowserFocusPageIdRef,
    switchSessionTabRef,
    setMarkdownDocs,
    closedTabTombstonesRef,
    nativeChatStream,
    appliedSessionTabsRevisionRef,
    worktreeId,
    terminalDiagnosticsRef,
    client,
    connState,
    applySessionTabs,
    fetchTerminals
  } = context

  const consumeAcceptedSessionTabs = useCallback(
    (
      _result: SessionTabsResult,
      effectiveTabs: readonly MobileSessionTab[],
      source: SessionTabsStreamSource
    ): void => {
      runAcceptedMobileSessionTabsEffects<MobileSessionTab>({
        effectiveTabs,
        source,
        getPendingBrowserPageId: () => pendingBrowserFocusPageIdRef.current,
        clearPendingBrowserPageId: (pageId) => {
          if (pendingBrowserFocusPageIdRef.current === pageId) {
            pendingBrowserFocusPageIdRef.current = null
          }
        },
        activateBrowserTab: (tab) => switchSessionTabRef.current?.(tab),
        markActiveMarkdownStale: (tabId) => {
          setMarkdownDocs((prev: Map<string, any>) => {
            const current = prev.get(tabId)
            if (current?.status !== 'ready' || current.isDirty) {
              return prev
            }
            return new Map(prev).set(tabId, { ...current, stale: true })
          })
        }
      })
    },
    []
  )
  const hasSessionTabsRecoveryNeed = useCallback(
    () =>
      closedTabTombstonesRef.current.size > 0 ||
      pendingBrowserFocusPageIdRef.current !== null ||
      nativeChatStream.hasTabsRecoveryNeed(),
    [nativeChatStream]
  )
  const getSessionTabsApplicationRevision = useCallback(
    () => appliedSessionTabsRevisionRef.current,
    []
  )
  const sessionTabsFetchReporting = useMobileSessionTabsFetchReporting<SessionTabsResult>({
    worktreeId,
    diagnosticsRef: terminalDiagnosticsRef
  })
  const { fetchSessionTabs, ensureSessionTabs, fetchPendingBrowserSessionTabs } =
    useMobileSessionTabsReconciliation<SessionTabsResult, MobileSessionTab>({
      client,
      connState,
      worktreeId,
      applySessionTabs,
      consumeAcceptedSessionTabs,
      fetchTerminals,
      hasRecoveryNeed: hasSessionTabsRecoveryNeed,
      getApplicationRevision: getSessionTabsApplicationRevision,
      ...sessionTabsFetchReporting
    })

  return {
    consumeAcceptedSessionTabs,
    hasSessionTabsRecoveryNeed,
    getSessionTabsApplicationRevision,
    fetchSessionTabs,
    ensureSessionTabs,
    fetchPendingBrowserSessionTabs
  }
}
