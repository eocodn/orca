import type { GitLabRepoSelectorArgs } from './api-browser-emulator'

import type { LinearIssueAttributeFilter, ClassifiedError, GitLabAssignableUser, GitLabAuthDiagnostic, GitLabCommentResult, GitLabDiscussionResolveResult, GitLabIssueInfo, GitLabIssueUpdate, GitLabJobTraceResult, GitLabMRInlineCommentInput, GitLabMRReviewersUpdateResult, GitLabMRUpdate, GitLabProjectRef, GitLabRetryJobResult, GitLabTodo, GitLabViewer, GitLabWorkItem, GitLabWorkItemDetails, GetGitLabRateLimitResult, ListMergeRequestsResult, MRInfo, MRListState, JiraComment, JiraConnectionStatus, JiraCreateField, JiraCreateIssueArgs, JiraIssue, JiraIssueFilter, JiraIssueType, JiraProjectStatusOrder, JiraIssueUpdate, JiraPriority, JiraProject, JiraSiteSelection, JiraTransition, JiraUser, JiraViewer, LinearViewer, LinearCollectionResult, LinearConnectionStatus, LinearCustomViewModel, LinearCustomViewSummary, LinearWorkspaceSelection, LinearIssue, LinearIssueUpdate, LinearComment, LinearWorkflowState, LinearLabel, LinearMember, LinearProjectDetail, LinearProjectSummary, LinearTeam, TelemetryConsentState, DiagnosticsStatusPayload, DiagnosticsBundlePayload, DiagnosticsUploadPayload } from './preload-api-contract-types';export type PreloadApiLinear = {
  gl: {
    viewer: () => Promise<GitLabViewer | null>
    diagnoseAuth: () => Promise<GitLabAuthDiagnostic>
    rateLimit: (args?: {
      force?: boolean
      host?: string | null
    }) => Promise<GetGitLabRateLimitResult>
    projectSlug: (args: GitLabRepoSelectorArgs) => Promise<GitLabProjectRef | null>
    mrForBranch: (
      args: GitLabRepoSelectorArgs & {
        branch: string
        linkedMRIid?: number | null
      }
    ) => Promise<MRInfo | null>
    mr: (args: GitLabRepoSelectorArgs & { iid: number }) => Promise<MRInfo | null>
    listMRs: (
      args: GitLabRepoSelectorArgs & {
        state?: MRListState
        page?: number
        perPage?: number
        query?: string
      }
    ) => Promise<ListMergeRequestsResult>
    /** Combined MR + issue list filtered by state. Issues are skipped
     *  when state is 'merged' (issues don't merge). */
    listWorkItems: (
      args: GitLabRepoSelectorArgs & {
        state?: MRListState
        page?: number
        perPage?: number
        query?: string
      }
    ) => Promise<ListMergeRequestsResult>
    issue: (args: GitLabRepoSelectorArgs & { number: number }) => Promise<GitLabIssueInfo | null>
    listIssues: (
      args: GitLabRepoSelectorArgs & {
        state?: 'opened' | 'closed' | 'all'
        assignee?: string
        limit?: number
      }
    ) => Promise<{ items: GitLabWorkItem[]; error?: ClassifiedError }>
    createIssue: (
      args: GitLabRepoSelectorArgs & {
        title: string
        body: string
      }
    ) => Promise<{ ok: true; number: number; url: string } | { ok: false; error: string }>
    updateIssue: (
      args: GitLabRepoSelectorArgs & {
        number: number
        updates: GitLabIssueUpdate
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    addIssueComment: (
      args: GitLabRepoSelectorArgs & {
        number: number
        body: string
      }
    ) => Promise<GitLabCommentResult>
    listLabels: (args: GitLabRepoSelectorArgs) => Promise<string[]>
    listAssignableUsers: (args: GitLabRepoSelectorArgs) => Promise<GitLabAssignableUser[]>
    /** Cross-project user-scoped todos (gitlab.com/dashboard/todos). */
    todos: (args: GitLabRepoSelectorArgs) => Promise<GitLabTodo[]>
    /** Aggregated dialog payload — body + discussions + pipeline jobs. */
    workItemDetails: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        type: 'issue' | 'mr'
      }
    ) => Promise<GitLabWorkItemDetails | null>
    closeMR: (
      args: GitLabRepoSelectorArgs & {
        iid: number
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    reopenMR: (
      args: GitLabRepoSelectorArgs & {
        iid: number
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    mergeMR: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        method?: 'merge' | 'squash' | 'rebase'
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    updateMR: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        updates: GitLabMRUpdate
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    updateMRReviewers: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        reviewerIds: number[]
        projectRef?: GitLabProjectRef | null
      }
    ) => Promise<GitLabMRReviewersUpdateResult>
    addMRComment: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        body: string
      }
    ) => Promise<GitLabCommentResult>
    addMRInlineComment: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        input: GitLabMRInlineCommentInput
        projectRef?: GitLabProjectRef | null
      }
    ) => Promise<GitLabCommentResult>
    resolveMRDiscussion: (
      args: GitLabRepoSelectorArgs & {
        iid: number
        discussionId: string
        resolved: boolean
      }
    ) => Promise<GitLabDiscussionResolveResult>
    jobTrace: (
      args: GitLabRepoSelectorArgs & {
        jobId: number
        projectRef?: GitLabProjectRef | null
      }
    ) => Promise<GitLabJobTraceResult>
    retryJob: (
      args: GitLabRepoSelectorArgs & {
        jobId: number
        projectRef?: GitLabProjectRef | null
      }
    ) => Promise<GitLabRetryJobResult>
    workItemByPath: (
      args: GitLabRepoSelectorArgs & {
        host: string
        path: string
        iid: number
        type: 'issue' | 'mr'
      }
    ) => Promise<Omit<GitLabWorkItem, 'repoId'> | null>
  }
  linear: {
    connect: (args: {
      apiKey: string
    }) => Promise<{ ok: true; viewer: LinearViewer } | { ok: false; error: string }>
    disconnect: (args?: { workspaceId?: string }) => Promise<void>
    selectWorkspace: (args: {
      workspaceId: LinearWorkspaceSelection
    }) => Promise<LinearConnectionStatus>
    status: () => Promise<LinearConnectionStatus>
    testConnection: (args?: {
      workspaceId?: string
    }) => Promise<{ ok: true; viewer: LinearViewer } | { ok: false; error: string }>
    searchIssues: (args: {
      query: string
      limit?: number
      workspaceId?: LinearWorkspaceSelection
    }) => Promise<LinearIssue[]>
    listIssues: (args?: {
      filter?: 'assigned' | 'created' | 'all' | 'completed'
      limit?: number
      workspaceId?: LinearWorkspaceSelection
      attributeFilter?: LinearIssueAttributeFilter
    }) => Promise<LinearCollectionResult<LinearIssue>>
    createIssue: (args: {
      teamId: string
      title: string
      description?: string
      workspaceId?: string
      parentIssueId?: string
      projectId?: string | null
      stateId?: string
      priority?: number
      assigneeId?: string | null
      labelIds?: string[]
    }) => Promise<
      | { ok: true; id: string; identifier: string; title: string; url: string }
      | { ok: false; error: string }
    >
    getIssue: (args: { id: string; workspaceId?: string }) => Promise<LinearIssue | null>
    updateIssue: (args: {
      id: string
      updates: LinearIssueUpdate
      workspaceId?: string
    }) => Promise<{ ok: true } | { ok: false; error: string }>
    addIssueComment: (args: {
      issueId: string
      body: string
      workspaceId?: string
    }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
    issueComments: (args: { issueId: string; workspaceId?: string }) => Promise<LinearComment[]>
    listTeams: (args?: { workspaceId?: LinearWorkspaceSelection }) => Promise<LinearTeam[]>
    listProjects: (args?: {
      query?: string
      limit?: number
      workspaceId?: LinearWorkspaceSelection
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearProjectSummary>>
    createProject: (args: {
      name: string
      description?: string
      content?: string
      teamIds: string[]
      workspaceId?: string
      leadId?: string | null
      memberIds?: string[]
      labelIds?: string[]
      priority?: number
      startDate?: string
      targetDate?: string
    }) => Promise<{ ok: true; project: LinearProjectDetail } | { ok: false; error: string }>
    getProject: (args: {
      id: string
      workspaceId: string
      force?: boolean
    }) => Promise<LinearProjectDetail | null>
    listProjectIssues: (args: {
      projectId: string
      limit?: number
      workspaceId: string
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearIssue>>
    listCustomViews: (args: {
      model: LinearCustomViewModel
      limit?: number
      workspaceId?: LinearWorkspaceSelection
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearCustomViewSummary>>
    getCustomView: (args: {
      viewId: string
      model: LinearCustomViewModel
      workspaceId: string
      force?: boolean
    }) => Promise<LinearCustomViewSummary | null>
    listCustomViewIssues: (args: {
      viewId: string
      limit?: number
      workspaceId: string
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearIssue>>
    listCustomViewProjects: (args: {
      viewId: string
      limit?: number
      workspaceId: string
      force?: boolean
    }) => Promise<LinearCollectionResult<LinearProjectSummary>>
    teamStates: (args: { teamId: string; workspaceId?: string }) => Promise<LinearWorkflowState[]>
    teamLabels: (args: { teamId: string; workspaceId?: string }) => Promise<LinearLabel[]>
    teamMembers: (args: { teamId: string; workspaceId?: string }) => Promise<LinearMember[]>
  }
  jira: {
    connect: (args: {
      siteUrl: string
      email: string
      apiToken: string
      authType?: 'cloud' | 'server'
    }) => Promise<{ ok: true; viewer: JiraViewer } | { ok: false; error: string }>
    disconnect: (args?: { siteId?: string }) => Promise<void>
    selectSite: (args: { siteId: JiraSiteSelection }) => Promise<JiraConnectionStatus>
    status: () => Promise<JiraConnectionStatus>
    readStatus: () => Promise<JiraConnectionStatus>
    testConnection: (args?: {
      siteId?: string
    }) => Promise<{ ok: true; viewer: JiraViewer } | { ok: false; error: string }>
    searchIssues: (args: {
      jql: string
      limit?: number
      siteId?: JiraSiteSelection
      requestId?: string
    }) => Promise<JiraIssue[]>
    cancelSearchIssues: (args: { requestId: string }) => Promise<void>
    listIssues: (args?: {
      filter?: JiraIssueFilter
      limit?: number
      siteId?: JiraSiteSelection
    }) => Promise<JiraIssue[]>
    getIssue: (args: { key: string; siteId?: string }) => Promise<JiraIssue | null>
    lookupIssueSummary: (args: {
      key: string
      siteId: string
      requestId?: string
    }) => Promise<JiraIssue | null>
    cancelIssueSummary: (args: { requestId: string }) => Promise<void>
    createIssue: (
      args: JiraCreateIssueArgs
    ) => Promise<{ ok: true; id: string; key: string; url: string } | { ok: false; error: string }>
    updateIssue: (args: {
      key: string
      updates: JiraIssueUpdate
      siteId?: string
    }) => Promise<{ ok: true } | { ok: false; error: string }>
    addIssueComment: (args: {
      key: string
      body: string
      siteId?: string
    }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
    issueComments: (args: { key: string; siteId?: string }) => Promise<JiraComment[]>
    listProjects: (args?: { siteId?: JiraSiteSelection }) => Promise<JiraProject[]>
    listIssueTypes: (args: { projectIdOrKey: string; siteId?: string }) => Promise<JiraIssueType[]>
    listCreateFields: (args: {
      projectIdOrKey: string
      issueTypeId: string
      siteId?: string
    }) => Promise<JiraCreateField[]>
    listPriorities: (args?: { siteId?: string }) => Promise<JiraPriority[]>
    listAssignableUsers: (args: {
      key: string
      query?: string
      siteId?: string
    }) => Promise<JiraUser[]>
    listTransitions: (args: { key: string; siteId?: string }) => Promise<JiraTransition[]>
    getProjectStatusOrder: (args: {
      projectKey: string
      siteId?: string
    }) => Promise<JiraProjectStatusOrder>
  }
  starNag: {
    onShow: (
      callback: (payload?: { mode?: 'gh' | 'web'; surface?: 'card' | 'toast' }) => void
    ) => () => void
    onHide: (callback: () => void) => () => void
    dismiss: () => Promise<void>
    later: () => Promise<void>
    complete: () => Promise<void>
    disable: () => Promise<void>
    openWeb: () => Promise<void>
    starOrca: () => Promise<boolean>
    forceShow: () => Promise<void>
    agentValueMoment: () => Promise<{ status: 'ready'; mode: 'gh' | 'web' } | { status: 'skipped' }>
    showAgentValueMoment: () => Promise<void>
    onboardingCompleted: () => Promise<void>
  }
  /** Fire-and-forget track. Loose IPC typing on purpose — the main-side validator enforces;
   *  renderer sites should import `track<N>()` from lib/telemetry.ts, not reach here. */
  telemetryTrack: (name: string, props: Record<string, unknown>) => Promise<void>
  /** Flip the persisted opt-in preference. Subject to a per-session
   *  consent-mutation rate limit on the main side (≤5/session). */
  telemetrySetOptIn: (optedIn: boolean) => Promise<void>
  /** Diagnostic file controls (telemetry-error-tracking.md §User controls). Main does the FS/network
   *  work and retains upload payloads so the renderer can't read or substitute arbitrary bytes. */
  diagnostics: {
    getStatus: () => Promise<DiagnosticsStatusPayload>
    collectBundle: (lookbackMinutes?: number) => Promise<DiagnosticsBundlePayload>
    openBundlePreview: (bundleSubmissionId: string) => Promise<void>
    discardBundlePreview: (bundleSubmissionId: string) => Promise<void>
    uploadBundle: (bundleSubmissionId: string) => Promise<DiagnosticsUploadPayload>
    deleteBundle: (ticketId: string) => Promise<void>
  }
  /** Read-only effective consent state (+ reason if disabled) — env vars are main-side state the renderer can't read directly. */
  telemetryGetConsentState: () => Promise<TelemetryConsentState>
  /** Banner ✕ — persist `optedIn = true` silently. Separate channel from `telemetrySetOptIn`,
   *  whose `via` derivation would wrongly fire `telemetry_opted_in`. Same per-session rate limit. */
  telemetryAcknowledgeBanner: () => Promise<void>
}
