import type {
  JiraComment,
  JiraCreateField,
  JiraCreateFieldAllowedValue,
  JiraCreateIssueArgs,
  JiraCreateIssueResult,
  JiraIssue,
  JiraIssueFilter,
  JiraIssueType,
  JiraIssueUpdate,
  JiraMutationResult,
  JiraPriority,
  JiraProject,
  JiraProjectStatusOrder,
  JiraSite,
  JiraSiteSelection,
  JiraStatus,
  JiraTransition,
  JiraUser
} from '../../shared/types'
import {
  acquire,
  apiBasePath,
  clearToken,
  getClients,
  isAuthError,
  jiraRequest,
  release,
  type JiraClientForSite
} from './client'
import {
  adfToMarkdownText,
  collectAdfMediaAttrs,
  textToAdf,
  type AdfToMarkdownOptions,
  type JiraAdfMediaAttrs
} from './adf-markdown'
import {
  extractAttachmentContentIdsFromHtml,
  selectPreferredAttachmentIds,
  warnIfMediaResolutionIncomplete
} from './attachment-discovery'
import {
  createMediaMarkdownResolver,
  loadIssueImageAttachments,
  type MediaResolutionStats
} from './attachment-images'
import { JiraSummaryLookupError } from '../../shared/jira-summary-lookup'
import { mapJiraIssue } from './jira-issue-mappers'
const ISSUE_FIELDS = [
  'summary',
  'description',
  'project',
  'issuetype',
  'status',
  'assignee',
  'reporter',
  'priority',
  'labels',
  'created',
  'updated'
]

// Why: list/typeahead only need identity + metadata; description ADF parse is the hot-path cost.
const ISSUE_LIST_FIELDS = ISSUE_FIELDS.filter((field) => field !== 'description')

// Why: detail reads need attachment metadata so inline ADF media can be resolved
// to downloadable image content; list/search omit this for payload size.
const ISSUE_DETAIL_FIELDS = [...ISSUE_FIELDS, 'attachment']
// `created`/`updated` are required: mapJiraIssue falls back to "now" when they're absent,
// which would silently report the lookup time as the issue's timestamps.
const ISSUE_SUMMARY_FIELDS = ['summary', 'project', 'issuetype', 'status', 'created', 'updated']
const ISSUE_SUMMARY_TIMEOUT_MS = 30_000
const ISSUE_SEARCH_TIMEOUT_MS = 30_000

type JiraRecord = Record<string, unknown>

type JiraSearchResponse = {
  issues?: JiraRecord[]
}

type JiraPagedResponse<T> = {
  startAt?: number
  maxResults?: number
  total?: number
  isLast?: boolean
  values?: T[]
  issueTypes?: T[]
  comments?: T[]
  fields?: T[] | Record<string, T>
}

type JiraPageItemKey = 'values' | 'issueTypes' | 'comments'

function clampLimit(limit: number | undefined, fallback = 30): number {
  return Math.min(Math.max(1, Number.isFinite(limit) ? Number(limit) : fallback), 100)
}

type JiraIssueSearchFailure = {
  error: unknown
  auth: boolean
}

/** Run against one signal that trips on the caller's abort or the request deadline. */

export { ISSUE_FIELDS, ISSUE_LIST_FIELDS, ISSUE_DETAIL_FIELDS, ISSUE_SUMMARY_TIMEOUT_MS, ISSUE_SEARCH_TIMEOUT_MS, clampLimit }
export { type ISSUE_SUMMARY_FIELDS, type JiraRecord, type JiraSearchResponse, type JiraPagedResponse, type JiraPageItemKey, type JiraIssueSearchFailure }

