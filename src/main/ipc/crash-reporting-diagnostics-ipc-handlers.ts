// Crash report IPC handlers and renderer-report deduplication.
import os from 'node:os'
import { app, clipboard, ipcMain } from 'electron'
import {
  type CrashReportBreadcrumbData,
  type CrashReportCopyDiagnosticsArgs,
  type CrashReportDiagnosticBundle,
  type ReactErrorBoundaryReportArgs,
  type ReactErrorBoundaryReportResult,
  type CrashReportSubmitArgs,
  type CrashReportSubmitResult,
  formatCrashReportText,
  formatUncapturedCrashReportText,
  sanitizeCrashReportDetails,
  sanitizeCrashReportString
} from '../../shared/crash-reporting'
import { submitFeedback } from './feedback'
import type { CrashReportStore } from '../crash-reporting/crash-report-store'
import {
  getCrashBreadcrumbSnapshot,
  recordCoalescedCrashBreadcrumb,
  recordCrashBreadcrumb
} from '../crash-reporting/crash-breadcrumb-store'
import { startSpan } from '../observability/tracer'
import {
  diagnosticBundleForReportOnlyRetry,
  prepareCrashDiagnosticBundle,
  resolveSubmittedDiagnosticBundle
} from '../crash-reporting/crash-feedback-diagnostic-bundle'
import {
  assertClipboardTextWriteWithinLimit,
  isClipboardTextWriteTooLargeError
} from '../../shared/clipboard-text'
import { formatCrashReportCopyText } from '../crash-reporting/crash-report-copy-text'
import { TERMINAL_WEBGL_DIAGNOSTIC_BREADCRUMB } from '../../shared/terminal-webgl-diagnostics'

import { inFlightSubmissions, submittedReportIds, recentRendererErrorReportKeys, RENDERER_ERROR_DEDUPE_MS, MAX_RENDERER_ERROR_KEY_AGE_MS, MAX_RECENT_RENDERER_ERROR_REPORT_KEYS, MAX_SUBMITTED_REPORT_IDS, REACT_ERROR_BOUNDARY_SURFACES, stringField, nullableStringField, normalizeRendererErrorReportArgs, pruneRendererErrorReportKeys, getRendererErrorReportKey, rememberSubmittedReportId, recordRendererErrorReport, _resetRendererErrorReportDedupeForTests, _getCrashReportingStateSizesForTests, getLatestPendingReport, getLatestSendableReport, getRequestedCrashReport, sanitizeRendererBreadcrumbData, recordRendererBreadcrumbTrace, buildUncapturedCrashReportText, COALESCED_RENDERER_BREADCRUMB_NAMES, RENDERER_BREADCRUMB_COALESCE_MS, NAME_ONLY_COALESCED_BREADCRUMB_NAMES, rendererBreadcrumbCoalesceKey } from './crash-reporting-ipc-foundation'

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
