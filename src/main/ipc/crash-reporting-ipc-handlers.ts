export * from './crash-reporting-ipc-foundation'
import { registerCrashReportDiagnosticsHandlers } from './crash-reporting-diagnostics-ipc-handlers'
import { registerCrashReportLifecycleHandlers } from './crash-reporting-lifecycle-ipc-handlers'
import { registerCrashReportSubmissionHandlers } from './crash-reporting-submission-ipc-handlers'
import type { CrashReportStore } from '../crash-reporting/crash-report-store'

export function registerCrashReportingHandlers(store: CrashReportStore): void {
  registerCrashReportLifecycleHandlers(store)
  registerCrashReportDiagnosticsHandlers(store)
  registerCrashReportSubmissionHandlers(store)
}
