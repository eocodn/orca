
export type RuntimeEnvironmentSubscriptionHandle = {
  unsubscribe: () => void
  sendBinary: (bytes: Uint8Array<ArrayBufferLike>) => void
}
import type {
  RuntimeMobileMarkdownRequest,
  RuntimeMobileMarkdownResponse
} from '../shared/mobile-markdown-document'
import type {
  DeveloperPermissionId,
  DeveloperPermissionRequestResult,
  DeveloperPermissionState
} from '../shared/developer-permissions-types'
import type {
  ComputerUsePermissionId,
  ComputerUsePermissionResetResult,
  ComputerUsePermissionSetupResult,
  ComputerUsePermissionStatusResult
} from '../shared/computer-use-permissions-types'
import type {
  ClaudeUsageBreakdownKind,
  ClaudeUsageBreakdownRow,
  ClaudeUsageDailyPoint,
  ClaudeUsageRange,
  ClaudeUsageScanState,
  ClaudeUsageScope,
  ClaudeUsageSessionRow,
  ClaudeUsageSnapshot,
  ClaudeUsageSummary
} from '../shared/claude-usage-types'
import type {
  CodexRateLimitResetResult,
  GrokAccountStatus,
  RateLimitRuntimeTarget,
  RateLimitState
} from '../shared/rate-limit-types'
import type {
  SpeechErrorEvent,
  SpeechLifecycleEvent,
  SpeechModelManifest,
  SpeechModelState,
  SpeechTranscriptEvent
} from '../shared/speech-types'
import type {
  WorkspaceSpaceAnalyzeResult,
  WorkspaceSpaceScanProgress
} from '../shared/workspace-space-types'
import type {
  WorkspacePortAdvertisedUrlChangedEvent,
  WorkspacePortKillRequest,
  WorkspacePortKillResult,
  WorkspacePortScanRequest,
  WorkspacePortScanResult
} from '../shared/workspace-ports'
import type { GhAuthDiagnostic } from '../shared/github-auth-types'
import type {
  CodexUsageBreakdownKind,
  CodexUsageBreakdownRow,
  CodexUsageDailyPoint,
  CodexUsageRange,
  CodexUsageScanState,
  CodexUsageScope,
  CodexUsageSessionRow,
  CodexUsageSnapshot,
  CodexUsageSummary
} from '../shared/codex-usage-types'
import type {
  OpenCodeUsageBreakdownKind,
  OpenCodeUsageBreakdownRow,
  OpenCodeUsageDailyPoint,
  OpenCodeUsageRange,
  OpenCodeUsageScanState,
  OpenCodeUsageScope,
  OpenCodeUsageSessionRow,
  OpenCodeUsageSnapshot,
  OpenCodeUsageSummary
} from '../shared/opencode-usage-types'
import type {
  AiVaultListArgs,
  AiVaultListResult,
  AiVaultSubagentListArgs,
  AiVaultSubagentListResult
} from '../shared/ai-vault-types'
import type {
  AiVaultPrepareSessionResumeArgs,
  AiVaultPrepareSessionResumeResult
} from '../shared/ai-vault-resume-preparation'
import type {
  AgentType,
  NativeChatMessage,
  NativeChatTurnLifecycle
} from '../shared/native-chat-types'
import type { TelemetryConsentState } from '../shared/telemetry-consent-types'
import type { AgentKind, LaunchSource, RequestKind } from '../shared/telemetry-events'
import type { AppStarSource } from '../shared/gh-star-source'
import type {
  RemoteWorkspaceChangedEvent,
  RemoteWorkspaceConnectedClient,
  RemoteWorkspacePatchResult,
  RemoteWorkspaceSnapshot
} from '../shared/remote-workspace-types'
import type {
  Automation,
  AutomationCreateInput,
  AutomationDispatchRequest,
  AutomationDispatchResult,
  ExternalAutomationCreateInput,
  ExternalAutomationActionInput,
  ExternalAutomationManager,
  ExternalAutomationRunsInput,
  ExternalAutomationRunsPage,
  ExternalAutomationUpdateInput,
  AutomationRun,
  AutomationPrecheckResult,
  AutomationUpdateInput
} from '../shared/automations-types'
import type {
  WorkspaceCleanupDismissArgs,
  WorkspaceCleanupLocalProcessArgs,
  WorkspaceCleanupLocalProcessResult,
  WorkspaceCleanupScanArgs,
  WorkspaceCleanupScanProgress,
  WorkspaceCleanupScanResult
} from '../shared/workspace-cleanup'
import type { KeybindingActionId, KeybindingFileSnapshot } from '../shared/keybindings'
