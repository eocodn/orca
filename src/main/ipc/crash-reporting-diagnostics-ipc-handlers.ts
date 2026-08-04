// Crash report IPC handlers and renderer-report deduplication.
import { clipboard, ipcMain } from 'electron'
import {
  type CrashReportCopyDiagnosticsArgs,
  formatCrashReportText
} from '../../shared/crash-reporting'
import type { CrashReportStore } from '../crash-reporting/crash-report-store'
import {
  recordCoalescedCrashBreadcrumb,
  recordCrashBreadcrumb
} from '../crash-reporting/crash-breadcrumb-store'
import {
  assertClipboardTextWriteWithinLimit,
  isClipboardTextWriteTooLargeError
} from '../../shared/clipboard-text'
import { formatCrashReportCopyText } from '../crash-reporting/crash-report-copy-text'

import {
  recordRendererErrorReport,
  getRequestedCrashReport,
  sanitizeRendererBreadcrumbData,
  recordRendererBreadcrumbTrace,
  buildUncapturedCrashReportText,
  COALESCED_RENDERER_BREADCRUMB_NAMES,
  RENDERER_BREADCRUMB_COALESCE_MS,
  rendererBreadcrumbCoalesceKey
} from './crash-reporting-ipc-foundation'

export function registerCrashReportDiagnosticsHandlers(store: CrashReportStore): void {
  ipcMain.removeAllListeners('crashReports:recordBreadcrumb')

  ipcMain.on(
      'crashReports:recordBreadcrumb',
      (_event, args?: { name?: unknown; data?: unknown }) => {
        if (!args || typeof args.name !== 'string') {
          return
        }
        const data = sanitizeRendererBreadcrumbData(args.data)
        if (COALESCED_RENDERER_BREADCRUMB_NAMES.has(args.name)) {
          const coalesceKey = rendererBreadcrumbCoalesceKey(args.name, data)
          if (!coalesceKey) {
            recordCrashBreadcrumb(args.name, data)
            recordRendererBreadcrumbTrace(args.name, data)
            return
          }
          const coalesceResult = recordCoalescedCrashBreadcrumb({
            name: args.name,
            data,
            coalesceKey,
            minIntervalMs: RENDERER_BREADCRUMB_COALESCE_MS
          })
          // Why: tracing every suppressed duplicate would preserve the same
          // serialization and disk churn that breadcrumb coalescing removes.
          if (coalesceResult) {
            recordRendererBreadcrumbTrace(
              args.name,
              coalesceResult.suppressedSinceLast > 0
                ? { ...data, suppressedSinceLast: coalesceResult.suppressedSinceLast }
                : data
            )
          }
        } else {
          recordCrashBreadcrumb(args.name, data)
          recordRendererBreadcrumbTrace(args.name, data)
        }
      }
    )

  ipcMain.removeHandler('crashReports:copyLatestDiagnostics')

  ipcMain.handle(
      'crashReports:copyLatestDiagnostics',
      async (_event, args?: CrashReportCopyDiagnosticsArgs) => {
        const report = await getRequestedCrashReport(store, args)
        const baseText = report
          ? formatCrashReportText(report, args?.notes)
          : buildUncapturedCrashReportText(args?.notes)
        try {
          clipboard.writeText(
            assertClipboardTextWriteWithinLimit(
              formatCrashReportCopyText(baseText, args?.submissionFailure)
            )
          )
        } catch (error) {
          if (isClipboardTextWriteTooLargeError(error)) {
            return { ok: false as const, error: 'Crash diagnostics are too large to copy safely.' }
          }
          throw error
        }
        return { ok: true as const }
      }
    )

  ipcMain.removeHandler('crashReports:recordRendererError')

  ipcMain.handle('crashReports:recordRendererError', async (_event, args: unknown) => {
      try {
        return await recordRendererErrorReport(store, args)
      } catch (error) {
        console.error('[crash-reporting] Failed to record renderer error report:', error)
        return { ok: false, error: 'Failed to record renderer error report.' }
      }
    })
}
