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

export function registerCrashReportLifecycleHandlers(store: CrashReportStore): void {
  ipcMain.removeHandler('crashReports:getLatestPending')

  ipcMain.handle('crashReports:getLatestPending', () => getLatestPendingReport(store))

  ipcMain.removeHandler('crashReports:getLatestReport')

  ipcMain.handle('crashReports:getLatestReport', () => getLatestSendableReport(store))

  ipcMain.removeHandler('crashReports:dismiss')

  ipcMain.handle('crashReports:dismiss', async (_event, args: { reportId: string }) => {
      if (inFlightSubmissions.has(args.reportId)) {
        return store.getById(args.reportId)
      }
      if (submittedReportIds.has(args.reportId)) {
        const report = await store.getById(args.reportId)
        return report ? { ...report, status: 'sent' as const } : null
      }
      return store.dismiss(args.reportId)
    })
}
