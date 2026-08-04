// Crash report IPC handlers and renderer-report deduplication.
import { ipcMain } from 'electron'
import type { CrashReportStore } from '../crash-reporting/crash-report-store'

import {
  inFlightSubmissions,
  submittedReportIds,
  getLatestPendingReport,
  getLatestSendableReport
} from './crash-reporting-ipc-foundation'

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
