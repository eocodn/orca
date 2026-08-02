import {
  acquire,
  release,
  extractExecError,
  ghExecFileAsync,
  repositoryRateLimitGuard,
  noteRepositoryRateLimitSpend,
  runGraphql,
  isValidOwnerSlug,
  assertSlug,
  assertPositiveInt,
  projectHostAuthenticationError,
  projectGhExecOptions,
  type GraphqlVars
} from './project-view/internals'
import {
  classifyProjectError,
  driftError,
  errorsIndicateParentField,
  rateLimitedError,
  type GhGraphqlErrorShape
} from './project-view/project-error-classification'
import type {
  GetProjectViewTableArgs,
  GetProjectViewTableResult,
  GitHubProjectField,
  GitHubProjectFieldValue,
  GitHubProjectIteration,
  GitHubProjectLabel,
  GitHubProjectOwnerType,
  GitHubProjectRow,
  GitHubProjectRowItemType,
  GitHubProjectSingleSelectOption,
  GitHubProjectSort,
  GitHubProjectSummary,
  GitHubProjectTable,
  GitHubProjectUser,
  GitHubProjectView,
  GitHubProjectViewError,
  GitHubProjectViewLayout,
  GitHubProjectViewSummary,
  ListAccessibleProjectsArgs,
  ListAccessibleProjectsResult,
  ListProjectViewsArgs,
  ListProjectViewsResult,
  ResolveProjectRefArgs,
  ResolveProjectRefResult
} from '../../shared/github-project-types'
export type RawProjectV2Field = {
  __typename?: string
  id?: string
  name?: string
  dataType?: string
  options?: { id?: string; name?: string; color?: string }[]
  configuration?: {
    iterations?: { id?: string; title?: string; startDate?: string; duration?: number }[]
    completedIterations?: {
      id?: string
      title?: string
      startDate?: string
      duration?: number
    }[]
  }
}

export function normalizeField(
  raw: RawProjectV2Field | null | undefined
): GitHubProjectField | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    return null
  }
  const dataType = raw.dataType ?? raw.__typename ?? ''
  if (raw.__typename === 'ProjectV2SingleSelectField' || dataType === 'SINGLE_SELECT') {
    const options: GitHubProjectSingleSelectOption[] = (raw.options ?? [])
      .map((o) =>
        typeof o.id === 'string' && typeof o.name === 'string'
          ? { id: o.id, name: o.name, color: o.color ?? '' }
          : null
      )
      .filter((o): o is GitHubProjectSingleSelectOption => o !== null)
    return { kind: 'single-select', id: raw.id, name: raw.name, dataType: 'SINGLE_SELECT', options }
  }
  if (raw.__typename === 'ProjectV2IterationField' || dataType === 'ITERATION') {
    const cfg = raw.configuration ?? {}
    const iterations: GitHubProjectIteration[] = []
    for (const it of cfg.completedIterations ?? []) {
      if (typeof it.id === 'string' && typeof it.title === 'string') {
        iterations.push({
          id: it.id,
          title: it.title,
          startDate: it.startDate ?? '',
          duration: typeof it.duration === 'number' ? it.duration : 0,
          completed: true
        })
      }
    }
    for (const it of cfg.iterations ?? []) {
      if (typeof it.id === 'string' && typeof it.title === 'string') {
        iterations.push({
          id: it.id,
          title: it.title,
          startDate: it.startDate ?? '',
          duration: typeof it.duration === 'number' ? it.duration : 0,
          completed: false
        })
      }
    }
    return { kind: 'iteration', id: raw.id, name: raw.name, dataType: 'ITERATION', iterations }
  }
  return { kind: 'field', id: raw.id, name: raw.name, dataType }
}

export type RawUser = {
  login?: string
  name?: string | null
  avatarUrl?: string | null
}

export function normalizeUser(raw: RawUser | null | undefined): GitHubProjectUser | null {
  if (!raw || typeof raw.login !== 'string') {
    return null
  }
  return {
    login: raw.login,
    name: raw.name ?? null,
    avatarUrl: raw.avatarUrl ?? null
  }
}

export type RawLabel = { name?: string; color?: string }

export function normalizeLabel(raw: RawLabel | null | undefined): GitHubProjectLabel | null {
  if (!raw || typeof raw.name !== 'string') {
    return null
  }
  return { name: raw.name, color: raw.color ?? '' }
}

export type RawFieldValue = {
  __typename?: string
  field?: RawProjectV2Field
  name?: string
  color?: string
  optionId?: string
  title?: string
  startDate?: string
  duration?: number
  iterationId?: string
  text?: string
  number?: number
  date?: string
  labels?: { nodes?: RawLabel[] }
  users?: { nodes?: RawUser[] }
}

export function normalizeFieldValue(
  raw: RawFieldValue | null | undefined
): GitHubProjectFieldValue | null {
  if (!raw || !raw.field || typeof raw.field.id !== 'string') {
    return null
  }
  const fieldId = raw.field.id
  switch (raw.__typename) {
    case 'ProjectV2ItemFieldSingleSelectValue':
      if (typeof raw.optionId !== 'string') {
        return null
      }
      return {
        kind: 'single-select',
        fieldId,
        optionId: raw.optionId,
        name: raw.name ?? '',
        color: raw.color ?? ''
      }
    case 'ProjectV2ItemFieldIterationValue':
      if (typeof raw.iterationId !== 'string') {
        return null
      }
      return {
        kind: 'iteration',
        fieldId,
        iterationId: raw.iterationId,
        title: raw.title ?? '',
        startDate: raw.startDate ?? '',
        duration: typeof raw.duration === 'number' ? raw.duration : 0
      }
    case 'ProjectV2ItemFieldTextValue':
      return { kind: 'text', fieldId, text: raw.text ?? '' }
    case 'ProjectV2ItemFieldNumberValue':
      if (typeof raw.number !== 'number') {
        return null
      }
      return { kind: 'number', fieldId, number: raw.number }
    case 'ProjectV2ItemFieldDateValue':
      return { kind: 'date', fieldId, date: raw.date ?? '' }
    case 'ProjectV2ItemFieldLabelValue': {
      const labels = (raw.labels?.nodes ?? [])
        .map(normalizeLabel)
        .filter((l): l is GitHubProjectLabel => l !== null)
      return { kind: 'labels', fieldId, labels }
    }
    case 'ProjectV2ItemFieldUserValue': {
      const users = (raw.users?.nodes ?? [])
        .map(normalizeUser)
        .filter((u): u is GitHubProjectUser => u !== null)
      return { kind: 'users', fieldId, users }
    }
    case undefined:
    default:
      // Unknown __typename → forward-compat: drop silently, don't classify as drift (see design §Error Handling).
      return null
  }
}

export type RawContent = {
  __typename?: string
  id?: string
  number?: number
  title?: string
  body?: string
  url?: string
  state?: string
  stateReason?: string | null
  isDraft?: boolean
  repository?: { nameWithOwner?: string }
  assignees?: { nodes?: RawUser[] }
  labels?: { nodes?: RawLabel[] }
  parent?: { number?: number; title?: string; url?: string } | null
  issueType?: {
    id?: string
    name?: string
    color?: string | null
    description?: string | null
  } | null
}

export type RawItem = {
  id?: string
  type?: string
  updatedAt?: string
  content?: RawContent | null
  fieldValues?: {
    nodes?: RawFieldValue[]
    pageInfo?: { hasNextPage?: boolean }
  }
}

export type NormalizedItemOutcome =
  | { ok: true; row: GitHubProjectRow }
  | { ok: false; drift: GitHubProjectViewError }

export function mapItemType(raw: string | undefined, hasContent: boolean): GitHubProjectRowItemType {
  if (raw === 'ISSUE') {
    return 'ISSUE'
  }
  if (raw === 'PULL_REQUEST') {
    return 'PULL_REQUEST'
  }
  if (raw === 'DRAFT_ISSUE') {
    return 'DRAFT_ISSUE'
  }
  if (raw === 'REDACTED' || !hasContent) {
    return 'REDACTED'
  }
  // Unknown item type with content — treat as redacted rather than dropping.
  return 'REDACTED'
}

export function normalizeItem(raw: RawItem, position: number): NormalizedItemOutcome {
  if (!raw || typeof raw.id !== 'string') {
    return {
      ok: false,
      drift: driftError('item missing id', { path: ['items', 'nodes', position, 'id'] })
    }
  }
  if (raw.fieldValues?.pageInfo?.hasNextPage === true) {
    return {
      ok: false,
      drift: driftError('item field values exceeded single page', {
        path: ['items', 'nodes', position, 'fieldValues', 'pageInfo', 'hasNextPage']
      })
    }
  }
  const itemType = mapItemType(raw.type, raw.content !== null && raw.content !== undefined)
  const content = raw.content ?? null
  const assignees = (content?.assignees?.nodes ?? [])
    .map(normalizeUser)
    .filter((u): u is GitHubProjectUser => u !== null)
  const labels = (content?.labels?.nodes ?? [])
    .map(normalizeLabel)
    .filter((l): l is GitHubProjectLabel => l !== null)
  const parentIssue =
    content?.parent &&
    typeof content.parent.number === 'number' &&
    typeof content.parent.title === 'string' &&
    typeof content.parent.url === 'string'
      ? { number: content.parent.number, title: content.parent.title, url: content.parent.url }
      : null
  const issueType =
    content?.issueType &&
    typeof content.issueType.id === 'string' &&
    typeof content.issueType.name === 'string'
      ? {
          id: content.issueType.id,
          name: content.issueType.name,
          color: typeof content.issueType.color === 'string' ? content.issueType.color : null,
          description:
            typeof content.issueType.description === 'string' ? content.issueType.description : null
        }
      : null
  const fieldValuesByFieldId: Record<string, GitHubProjectFieldValue> = {}
  for (const fv of raw.fieldValues?.nodes ?? []) {
    const normalized = normalizeFieldValue(fv)
    if (normalized) {
      fieldValuesByFieldId[normalized.fieldId] = normalized
    }
  }
  const title =
    itemType === 'REDACTED'
      ? 'Restricted item'
      : typeof content?.title === 'string'
        ? content.title
        : ''
  const row: GitHubProjectRow = {
    id: raw.id,
    itemType,
    content: {
      number: typeof content?.number === 'number' ? content.number : null,
      title,
      body: typeof content?.body === 'string' ? content.body : null,
      url: typeof content?.url === 'string' ? content.url : null,
      state: typeof content?.state === 'string' ? content.state : null,
      stateReason: typeof content?.stateReason === 'string' ? content.stateReason : null,
      isDraft: typeof content?.isDraft === 'boolean' ? content.isDraft : null,
      repository:
        typeof content?.repository?.nameWithOwner === 'string'
          ? content.repository.nameWithOwner
          : null,
      assignees,
      labels,
      parentIssue,
      issueType
    },
    fieldValuesByFieldId,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    position
  }
  return { ok: true, row }
}
