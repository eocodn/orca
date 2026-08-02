// Concrete surface implementation for ProjectViewWrapper.tsx
// Top-level Project-mode container; interaction states per the design doc.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink,
  RefreshCw,
  KanbanSquare,
  Map as MapIcon,
  Search,
  Table as TableIcon,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import GitHubItemDialog, { type GitHubItemDialogProjectOrigin } from '@/components/GitHubItemDialog'
import { GhAuthErrorHelp } from '@/components/github-project/GhAuthErrorHelp'
import { launchWorkItemDirect } from '@/lib/launch-work-item-direct'
import { useRepoSlugIndex } from '@/lib/repo-slug-index'
import { cn } from '@/lib/utils'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { projectViewCacheKey } from '@/store/slices/github'
import type {
  GetProjectViewTableResult,
  GitHubIssueType,
  GitHubProjectFieldMutationValue,
  GitHubProjectRow,
  GitHubProjectTable,
  GitHubProjectViewError,
  GitHubProjectViewSummary,
  ListProjectViewsResult
} from '../../../../shared/github-project-types'
import type { GitHubWorkItem } from '../../../../shared/types'
import ProjectPicker, { type ResolvedProjectSelection } from './ProjectPicker'
import ProjectViewList from './ProjectViewList'
import ProjectItemSlugDialog from './ProjectItemSlugDialog'
import {
  filterProjectTableRowsBySelectedRepos,
  resolveSelectedProjectRowRepo
} from './project-row-filtering'
import {
  resolveMissingRepoProjectDialogState,
  resolveRepoBackedProjectDialogState
} from './project-dialog-state'
import {
  getSelectedRepoFingerprint,
  getNextVisibleProjectTableCache,
  getVisibleProjectTable,
  type CachedVisibleProjectTable
} from './project-visible-table-cache'
import { translate } from '@/i18n/i18n'
import { buildTaskSourceContextFromRepo } from '../../../../shared/task-source-context'
import {
  githubProjectHost,
  githubProjectIdentityKey
} from '../../../../shared/github-project-identity'

import type { Props } from './project-view-wrapper-surface'
import { buildProjectWorkItem, listProjectViewsForRuntime, getProjectViewSourceScope } from './project-view-wrapper-surface'


type ProjectViewDialogContext = Record<string, any>

export function useProjectViewDialogController(context: ProjectViewDialogContext) {
  const {
    selectedRepoIds,
    repos,
    lookupSlug,
    slugIndexReady,
    table,
    currentCacheKey,
    patchProjectIssueOrPr,
    patchProjectRowIssueType,
    updateProjectFieldValue,
    clearProjectFieldValue,
    addRepoFromStore
  } = context
const selectedViewUrl = table
? `${table.project.url}/views/${table.selectedView.number ?? ''}`
: null

// Why: matched-repo rows open `GitHubItemDialog`, unmatched the slug dialog; `repoNotInOrca` drives the `repo-not-in-orca` modal.
const [dialogRepoItem, setDialogRepoItem] = useState<{
workItem: GitHubWorkItem
repoPath: string
repoId: string
origin: GitHubItemDialogProjectOrigin
} | null>(null)
// Why: slug dialog only serves unregistered-repo rows; the parent (not this dialog) owns the repo-not-in-orca "Start work" flow.
const [slugDialog, setSlugDialog] = useState<{
origin: GitHubItemDialogProjectOrigin
} | null>(null)
const [repoNotInOrca, setRepoNotInOrca] = useState<{
owner: string
repo: string
host?: string
url: string | null
} | null>(null)
const liveRepoIds = useMemo(() => new Set(repos.map((repo) => repo.id)), [repos])

const resolvedDialogRepoItem = resolveRepoBackedProjectDialogState(
dialogRepoItem,
liveRepoIds,
selectedRepoIds
)
if (resolvedDialogRepoItem !== dialogRepoItem) {
// Why: clear the repo-backed dialog when its repo leaves Orca, before the modal tree gets stale repo ids.
setDialogRepoItem(resolvedDialogRepoItem)
}
const resolvedDialogRepo = resolvedDialogRepoItem
? (repos.find((repo) => repo.id === resolvedDialogRepoItem.repoId) ?? null)
: null
const resolvedDialogSourceContext = resolvedDialogRepo
? buildTaskSourceContextFromRepo({
    provider: 'github',
    projectId: resolvedDialogRepo.id,
    repo: resolvedDialogRepo
  })
: null

const resolvedMissingRepoDialogs = resolveMissingRepoProjectDialogState({
slugIndexReady,
slugDialog,
repoNotInOrca,
lookupSlug,
selectedRepoIds
})
if (resolvedMissingRepoDialogs.slugDialog !== slugDialog) {
// Why: once a missing repo is registered, rows switch to the full repo-backed dialog, not the slug fallback.
setSlugDialog(resolvedMissingRepoDialogs.slugDialog)
}
if (resolvedMissingRepoDialogs.repoNotInOrca !== repoNotInOrca) {
setRepoNotInOrca(resolvedMissingRepoDialogs.repoNotInOrca)
}

const buildOrigin = useCallback(
(
  row: GitHubProjectRow,
  cacheKey: string,
  table: GitHubProjectTable
): GitHubItemDialogProjectOrigin | null => {
  if (row.itemType !== 'ISSUE' && row.itemType !== 'PULL_REQUEST') {
    return null
  }
  if (row.content.number == null || !row.content.repository) {
    return null
  }
  const [owner, repo] = row.content.repository.split('/')
  if (!owner || !repo) {
    return null
  }
  return {
    owner,
    repo,
    host: githubProjectHost(table.project.host),
    number: row.content.number,
    type: row.itemType === 'PULL_REQUEST' ? 'pr' : 'issue',
    projectId: table.project.id,
    projectItemId: row.id,
    cacheKey
  }
},
[]
)

const openProjectRowUrlWithToast = useCallback((row: GitHubProjectRow, message: string) => {
if (row.content.url) {
  void window.api.shell.openUrl(row.content.url)
}
toast.message(message)
}, [])

const handleOpenDialog = useCallback(
(row: GitHubProjectRow) => {
  if (!currentCacheKey || !table) {
    return
  }
  const origin = buildOrigin(row, currentCacheKey, table)
  if (!origin) {
    // Redacted / draft / missing slug — fall back to opening GitHub.
    if (row.content.url) {
      void window.api.shell.openUrl(row.content.url)
    }
    return
  }
  const resolution = resolveSelectedProjectRowRepo({
    row,
    lookupSlug,
    host: table.project.host,
    slugIndexReady,
    selectedRepoIds
  })
  if (resolution.status === 'loading') {
    openProjectRowUrlWithToast(
      row,
      translate(
        'auto.components.github.project.ProjectViewWrapper.f352abf7c3',
        'Repository list is updating.'
      )
    )
    return
  }
  if (resolution.status === 'selected_match') {
    const workItem = buildProjectWorkItem(row, resolution.repo.id, table.project.host)
    if (workItem) {
      setDialogRepoItem({
        workItem,
        repoPath: resolution.repo.path,
        repoId: resolution.repo.id,
        origin
      })
      return
    }
  }
  if (resolution.status === 'no_global_match') {
    // Unknown repo — use the simplified slug-mode dialog.
    setSlugDialog({ origin })
    return
  }
  if (resolution.status === 'unselected_match') {
    openProjectRowUrlWithToast(
      row,
      translate(
        'auto.components.github.project.ProjectViewWrapper.1ce21b8cff',
        'This item is outside the selected repositories.'
      )
    )
    return
  }
  if (resolution.status === 'ambiguous_selected_match') {
    openProjectRowUrlWithToast(
      row,
      translate(
        'auto.components.github.project.ProjectViewWrapper.030de75bc5',
        'This item matches multiple selected repositories.'
      )
    )
  }
},
[
  currentCacheKey,
  table,
  buildOrigin,
  lookupSlug,
  slugIndexReady,
  selectedRepoIds,
  openProjectRowUrlWithToast
]
)

const handleStartWork = useCallback(
(row: GitHubProjectRow) => {
  if (!currentCacheKey || !table) {
    return
  }
  const origin = buildOrigin(row, currentCacheKey, table)
  if (!origin) {
    return
  }
  const resolution = resolveSelectedProjectRowRepo({
    row,
    lookupSlug,
    host: table.project.host,
    slugIndexReady,
    selectedRepoIds
  })
  if (resolution.status === 'loading') {
    openProjectRowUrlWithToast(
      row,
      translate(
        'auto.components.github.project.ProjectViewWrapper.f352abf7c3',
        'Repository list is updating.'
      )
    )
    return
  }
  if (resolution.status === 'no_global_match') {
    setRepoNotInOrca({
      owner: origin.owner,
      repo: origin.repo,
      host: origin.host,
      url: row.content.url ?? null
    })
    return
  }
  if (resolution.status === 'unselected_match') {
    openProjectRowUrlWithToast(
      row,
      translate(
        'auto.components.github.project.ProjectViewWrapper.1ce21b8cff',
        'This item is outside the selected repositories.'
      )
    )
    return
  }
  if (resolution.status === 'ambiguous_selected_match') {
    openProjectRowUrlWithToast(
      row,
      translate(
        'auto.components.github.project.ProjectViewWrapper.030de75bc5',
        'This item matches multiple selected repositories.'
      )
    )
    return
  }
  if (resolution.status !== 'selected_match') {
    return
  }
  const workItem = buildProjectWorkItem(row, resolution.repo.id, table.project.host)
  if (!workItem) {
    return
  }
  // Why: issue #4756 changed only TaskPage's "Create workspace"; Project view stays on direct "start work now" launch.
  void launchWorkItemDirect({
    item: workItem,
    repoId: resolution.repo.id,
    launchSource: 'task_page',
    telemetrySource: 'sidebar',
    openModalFallback: () => {
      // Why: Project mode lacks the new-workspace composer, so when launch needs user input, open the URL instead of a silent no-op.
      if (row.content.url) {
        void window.api.shell.openUrl(row.content.url)
      }
    }
  })
},
[
  currentCacheKey,
  table,
  buildOrigin,
  lookupSlug,
  slugIndexReady,
  selectedRepoIds,
  openProjectRowUrlWithToast
]
)

const handleEditAssignees = useCallback(
async (row: GitHubProjectRow, add: string[], remove: string[]) => {
  if (!currentCacheKey) {
    return
  }
  const res = await patchProjectIssueOrPr(currentCacheKey, row.id, {
    ...(add.length ? { addAssignees: add } : {}),
    ...(remove.length ? { removeAssignees: remove } : {})
  })
  if (!res.ok) {
    toast.error(res.error.message)
  }
},
[currentCacheKey, patchProjectIssueOrPr]
)

const handleEditLabels = useCallback(
async (row: GitHubProjectRow, add: string[], remove: string[]) => {
  if (!currentCacheKey) {
    return
  }
  const res = await patchProjectIssueOrPr(currentCacheKey, row.id, {
    ...(add.length ? { addLabels: add } : {}),
    ...(remove.length ? { removeLabels: remove } : {})
  })
  if (!res.ok) {
    toast.error(res.error.message)
  }
},
[currentCacheKey, patchProjectIssueOrPr]
)

const handleEditIssueType = useCallback(
async (row: GitHubProjectRow, issueType: GitHubIssueType | null) => {
  if (!currentCacheKey) {
    return
  }
  const res = await patchProjectRowIssueType(currentCacheKey, row.id, issueType)
  if (!res.ok) {
    toast.error(res.error.message)
  }
},
[currentCacheKey, patchProjectRowIssueType]
)

const handleEditField = useCallback(
async (
  row: GitHubProjectRow,
  fieldId: string,
  value: GitHubProjectFieldMutationValue | null
) => {
  if (!currentCacheKey) {
    return
  }
  const result =
    value === null
      ? await clearProjectFieldValue(currentCacheKey, row.id, fieldId)
      : await updateProjectFieldValue(currentCacheKey, row.id, fieldId, value)
  if (!result.ok) {
    toast.error(result.error.message)
  }
},
[clearProjectFieldValue, currentCacheKey, updateProjectFieldValue]
)


  return { selectedViewUrl, dialogRepoItem, setDialogRepoItem, slugDialog, setSlugDialog, repoNotInOrca, setRepoNotInOrca, liveRepoIds, resolvedDialogRepoItem, resolvedDialogRepo, resolvedDialogSourceContext, resolvedMissingRepoDialogs, buildOrigin, openProjectRowUrlWithToast, handleOpenDialog, handleStartWork, handleEditAssignees, handleEditLabels, handleEditIssueType, handleEditField }
}
