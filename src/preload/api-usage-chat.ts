import type * as ApiExternal from "./api-types-external"
type MemorySnapshot = ApiExternal.MemorySnapshot; type ClaudeUsageBreakdownKind = ApiExternal.ClaudeUsageBreakdownKind; type ClaudeUsageBreakdownRow = ApiExternal.ClaudeUsageBreakdownRow; type ClaudeUsageDailyPoint = ApiExternal.ClaudeUsageDailyPoint; type ClaudeUsageRange = ApiExternal.ClaudeUsageRange; type ClaudeUsageScanState = ApiExternal.ClaudeUsageScanState; type ClaudeUsageScope = ApiExternal.ClaudeUsageScope; type ClaudeUsageSessionRow = ApiExternal.ClaudeUsageSessionRow; type ClaudeUsageSnapshot = ApiExternal.ClaudeUsageSnapshot; type ClaudeUsageSummary = ApiExternal.ClaudeUsageSummary; type CodexUsageBreakdownKind = ApiExternal.CodexUsageBreakdownKind; type CodexUsageBreakdownRow = ApiExternal.CodexUsageBreakdownRow; type CodexUsageDailyPoint = ApiExternal.CodexUsageDailyPoint; type CodexUsageRange = ApiExternal.CodexUsageRange; type CodexUsageScanState = ApiExternal.CodexUsageScanState; type CodexUsageScope = ApiExternal.CodexUsageScope; type CodexUsageSessionRow = ApiExternal.CodexUsageSessionRow; type CodexUsageSnapshot = ApiExternal.CodexUsageSnapshot; type CodexUsageSummary = ApiExternal.CodexUsageSummary; type OpenCodeUsageBreakdownKind = ApiExternal.OpenCodeUsageBreakdownKind; type OpenCodeUsageBreakdownRow = ApiExternal.OpenCodeUsageBreakdownRow; type OpenCodeUsageDailyPoint = ApiExternal.OpenCodeUsageDailyPoint; type OpenCodeUsageRange = ApiExternal.OpenCodeUsageRange; type OpenCodeUsageScanState = ApiExternal.OpenCodeUsageScanState; type OpenCodeUsageScope = ApiExternal.OpenCodeUsageScope; type OpenCodeUsageSessionRow = ApiExternal.OpenCodeUsageSessionRow; type OpenCodeUsageSnapshot = ApiExternal.OpenCodeUsageSnapshot; type OpenCodeUsageSummary = ApiExternal.OpenCodeUsageSummary; type AiVaultListArgs = ApiExternal.AiVaultListArgs; type AiVaultListResult = ApiExternal.AiVaultListResult; type AiVaultSubagentListArgs = ApiExternal.AiVaultSubagentListArgs; type AiVaultSubagentListResult = ApiExternal.AiVaultSubagentListResult; type AiVaultPrepareSessionResumeArgs = ApiExternal.AiVaultPrepareSessionResumeArgs; type AiVaultPrepareSessionResumeResult = ApiExternal.AiVaultPrepareSessionResumeResult; type AgentType = ApiExternal.AgentType; type NativeChatMessage = ApiExternal.NativeChatMessage; type NativeChatTurnLifecycle = ApiExternal.NativeChatTurnLifecycle; 

export type MemoryApi = {
  getSnapshot: () => Promise<MemorySnapshot>
}

export type ClaudeUsageApi = {
  getScanState: () => Promise<ClaudeUsageScanState>
  setEnabled: (args: { enabled: boolean }) => Promise<ClaudeUsageScanState>
  refresh: (args?: { force?: boolean }) => Promise<ClaudeUsageScanState>
  getSnapshot: (args: {
    scope: ClaudeUsageScope
    range: ClaudeUsageRange
    limit?: number
  }) => Promise<ClaudeUsageSnapshot>
  getSummary: (args: {
    scope: ClaudeUsageScope
    range: ClaudeUsageRange
  }) => Promise<ClaudeUsageSummary>
  getDaily: (args: {
    scope: ClaudeUsageScope
    range: ClaudeUsageRange
  }) => Promise<ClaudeUsageDailyPoint[]>
  getBreakdown: (args: {
    scope: ClaudeUsageScope
    range: ClaudeUsageRange
    kind: ClaudeUsageBreakdownKind
  }) => Promise<ClaudeUsageBreakdownRow[]>
  getRecentSessions: (args: {
    scope: ClaudeUsageScope
    range: ClaudeUsageRange
    limit?: number
  }) => Promise<ClaudeUsageSessionRow[]>
}

export type CodexUsageApi = {
  getScanState: () => Promise<CodexUsageScanState>
  setEnabled: (args: { enabled: boolean }) => Promise<CodexUsageScanState>
  refresh: (args?: { force?: boolean }) => Promise<CodexUsageScanState>
  getSnapshot: (args: {
    scope: CodexUsageScope
    range: CodexUsageRange
    limit?: number
  }) => Promise<CodexUsageSnapshot>
  getSummary: (args: {
    scope: CodexUsageScope
    range: CodexUsageRange
  }) => Promise<CodexUsageSummary>
  getDaily: (args: {
    scope: CodexUsageScope
    range: CodexUsageRange
  }) => Promise<CodexUsageDailyPoint[]>
  getBreakdown: (args: {
    scope: CodexUsageScope
    range: CodexUsageRange
    kind: CodexUsageBreakdownKind
  }) => Promise<CodexUsageBreakdownRow[]>
  getRecentSessions: (args: {
    scope: CodexUsageScope
    range: CodexUsageRange
    limit?: number
  }) => Promise<CodexUsageSessionRow[]>
}

export type OpenCodeUsageApi = {
  getScanState: () => Promise<OpenCodeUsageScanState>
  setEnabled: (args: { enabled: boolean }) => Promise<OpenCodeUsageScanState>
  refresh: (args?: { force?: boolean }) => Promise<OpenCodeUsageScanState>
  getSnapshot: (args: {
    scope: OpenCodeUsageScope
    range: OpenCodeUsageRange
    limit?: number
  }) => Promise<OpenCodeUsageSnapshot>
  getSummary: (args: {
    scope: OpenCodeUsageScope
    range: OpenCodeUsageRange
  }) => Promise<OpenCodeUsageSummary>
  getDaily: (args: {
    scope: OpenCodeUsageScope
    range: OpenCodeUsageRange
  }) => Promise<OpenCodeUsageDailyPoint[]>
  getBreakdown: (args: {
    scope: OpenCodeUsageScope
    range: OpenCodeUsageRange
    kind: OpenCodeUsageBreakdownKind
  }) => Promise<OpenCodeUsageBreakdownRow[]>
  getRecentSessions: (args: {
    scope: OpenCodeUsageScope
    range: OpenCodeUsageRange
    limit?: number
  }) => Promise<OpenCodeUsageSessionRow[]>
}

export type AiVaultApi = {
  listSessions: (args?: AiVaultListArgs) => Promise<AiVaultListResult>
  prepareSessionResume: (
    args: AiVaultPrepareSessionResumeArgs
  ) => Promise<AiVaultPrepareSessionResumeResult>
  /** Lists the Task subagent transcripts of one session, on demand. */
  listSubagentSessions: (args: AiVaultSubagentListArgs) => Promise<AiVaultSubagentListResult>
  /** Fires when any app window regains OS focus; returns an unsubscribe. */
  onWindowFocused: (callback: () => void) => () => void
}

// notFound marks a not-yet-on-disk miss (retry-worthy) vs a real read/parse error (#8401).
export type NativeChatReadSessionResult =
  | {
      messages: NativeChatMessage[]
      lifecycle?: NativeChatTurnLifecycle
    }
  | { error: string; notFound?: true }

/** Messages appended to a live-tailed transcript since the previous emit. */
export type NativeChatAppendedMessages = NativeChatMessage[]

export type NativeChatSubscriptionFrame =
  | {
      type: 'snapshot'
      messages: NativeChatMessage[]
      hasMore: boolean
      error?: string
      lifecycle?: NativeChatTurnLifecycle
    }
  | {
      type: 'replacement'
      messages: NativeChatMessage[]
      hasMore: boolean
      lifecycle?: NativeChatTurnLifecycle
    }
  | {
      type: 'appended'
      messages: NativeChatMessage[]
      lifecycle?: NativeChatTurnLifecycle
    }

/** Wire payload for the `nativeChat:appended` push channel. */
export type NativeChatAppendedPayload = {
  subscriptionId: string
  frame: NativeChatSubscriptionFrame
}

export type NativeChatSubscribeArgs = {
  /** Unique per-caller id, echoed on every append so multiple live panes in
   *  one renderer don't cross-talk. */
  subscriptionId: string
  agent: AgentType
  sessionId: string
  /** Authoritative transcript path from the agent hook (providerSession). */
  transcriptPath?: string
  /** First snapshot size; later readSession calls grow this for pagination. */
  limit?: number
}

export type NativeChatApi = {
  /** Read the on-disk transcript for an agent + session id, windowed to the most recent `limit`
   *  turns. `transcriptPath` is the hook-reported authoritative path, preferred over the id glob. */
  readSession: (
    agent: AgentType,
    sessionId: string,
    limit?: number,
    transcriptPath?: string
  ) => Promise<NativeChatReadSessionResult>
  /** Live-tail a transcript. The first frame is a bounded race-safe snapshot;
   *  later frames contain only newly appended messages. */
  subscribe: (
    args: NativeChatSubscribeArgs,
    onFrame: (frame: NativeChatSubscriptionFrame) => void
  ) => () => void
}
