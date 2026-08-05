import {
  buildNestedRepoImportActionTelemetry,
  type NestedRepoTelemetryRuntimeKind
} from '../../../../shared/nested-repo-telemetry'
import type { NestedRepoScanResult } from '../../../../shared/types'

export function trackNestedFolderOpen(args: {
  attemptId: string | null
  runtimeKind: NestedRepoTelemetryRuntimeKind | null
  connectionId: string | null
  scan: NestedRepoScanResult
  selectedCount: number
  getRuntimeKind: (connectionId: string | null) => NestedRepoTelemetryRuntimeKind
}): void {
  if (!args.attemptId) {
    return
  }
}
