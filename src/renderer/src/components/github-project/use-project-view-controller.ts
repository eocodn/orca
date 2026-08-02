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
import { useProjectViewDialogController } from './project-view-dialog-controller'

export function useProjectViewController(selectedRepoIds: Props['selectedRepoIds']) {

const settings = useAppStore((s) => s.settings)
const projectViewCache = useAppStore((s) => s.projectViewCache)
const fetchProjectViewTable = useAppStore((s) => s.fetchProjectViewTable)
const updateProjectFieldValue = useAppStore((s) => s.updateProjectFieldValue)
const clearProjectFieldValue = useAppStore((s) => s.clearProjectFieldValue)
const patchProjectIssueOrPr = useAppStore((s) => s.patchProjectIssueOrPr)
const patchProjectRowIssueType = useAppStore((s) => s.patchProjectRowIssueType)
const addRepoFromStore = useAppStore((s) => s.addRepo)
const repos = useAppStore((s) => s.repos)
const { lookupSlug, ready: slugIndexReady } = useRepoSlugIndex()
const mountedRef = useMountedRef()

const activeProject = settings?.githubProjects?.activeProject ?? null
const projectViewSourceScope = useMemo(() => getProjectViewSourceScope(settings), [settings])
const lastViewByProject = useMemo(
  () => settings?.githubProjects?.lastViewByProject ?? {},
  [settings?.githubProjects?.lastViewByProject]
)

const [loading, setLoading] = useState(false)
const fetchRunIdRef = useRef(0)
const [error, setError] = useState<{
  error: GitHubProjectViewError
  totalCount?: number
} | null>(null)
const [parentDroppedToasted, setParentDroppedToasted] = useState<ReadonlySet<string>>(
  () => new Set()
)
// Why: cache view list per project so the tab strip doesn't flicker/refetch on re-render; keyed `ownerType:owner:number`.
const [viewListByProject, setViewListByProject] = useState<
  Record<string, GitHubProjectViewSummary[]>
>({})

// Why: ephemeral per-(project,view) search override, never persisted (design doc §"Out of scope"); `undefined` = use the view's filter as-is.
const [appliedQueryByView, setAppliedQueryByView] = useState<Record<string, string>>({})

const doFetch = useCallback(
  async (selection: ResolvedProjectSelection, force = false, queryOverride?: string) => {
    const runId = fetchRunIdRef.current + 1
    fetchRunIdRef.current = runId
    setLoading(true)
    setError(null)
    try {
      const res: GetProjectViewTableResult = await fetchProjectViewTable(
        {
          owner: selection.owner,
          ownerType: selection.ownerType,
          projectNumber: selection.projectNumber,
          host: githubProjectHost(selection.host),
          ...(selection.viewId ? { viewId: selection.viewId } : {}),
          ...(queryOverride !== undefined ? { queryOverride } : {})
        },
        { force }
      )
      if (!mountedRef.current || fetchRunIdRef.current !== runId) {
        return
      }
      if (!res.ok) {
        setError({ error: res.error, totalCount: res.totalCount })
      }
    } finally {
      // Why: an older overlapping fetch finishing first must not clear a newer refresh's loading indicator.
      if (mountedRef.current && fetchRunIdRef.current === runId) {
        setLoading(false)
      }
    }
  },
  [fetchProjectViewTable, mountedRef]
)

const handleSelect = useCallback(
  async (selection: ResolvedProjectSelection) => {
    await doFetch(selection, true)
  },
  [doFetch]
)

// Auto-fetch when activeProject exists and we don't have cached data.
useEffect(() => {
  if (!activeProject) {
    return
  }
  const key = githubProjectIdentityKey(activeProject)
  const viewId = lastViewByProject[key]?.viewId
  if (!viewId) {
    return
  }
  const projectViewKey = `${projectViewSourceScope}:${key}:${viewId}`
  const queryOverride = appliedQueryByView[projectViewKey]
  const cacheKey = projectViewCacheKey(
    activeProject.ownerType,
    activeProject.owner,
    activeProject.number,
    viewId,
    queryOverride,
    projectViewSourceScope,
    activeProject.host
  )
  if (projectViewCache[cacheKey]?.data) {
    return
  }
  void doFetch(
    {
      owner: activeProject.owner,
      ownerType: activeProject.ownerType,
      projectNumber: activeProject.number,
      host: githubProjectHost(activeProject.host),
      viewId
    },
    false,
    queryOverride
  )
}, [
  activeProject,
  lastViewByProject,
  projectViewCache,
  doFetch,
  appliedQueryByView,
  projectViewSourceScope
])

// Load the view list once per project per session (small, rarely changes) so the tab strip can render.
useEffect(() => {
  if (!activeProject) {
    return
  }
  const projectKey = `${projectViewSourceScope}:${githubProjectIdentityKey(activeProject)}`
  if (viewListByProject[projectKey]) {
    return
  }
  let cancelled = false
  void listProjectViewsForRuntime(settings, {
    owner: activeProject.owner,
    ownerType: activeProject.ownerType,
    projectNumber: activeProject.number,
    host: githubProjectHost(activeProject.host)
  })
    .then((res) => {
      if (cancelled) {
        return
      }
      if (res.ok) {
        setViewListByProject((prev) => ({ ...prev, [projectKey]: res.views }))
      } else {
        console.warn('[project-view] listProjectViews failed:', res.error.message)
      }
    })
    .catch((err) => {
      if (cancelled) {
        return
      }
      // Why: swallow the IPC rejection (else unhandled/dev-tools red); fall back to the empty-tabs UI.
      console.warn('[project-view] listProjectViews threw:', err)
    })
  return () => {
    cancelled = true
  }
}, [activeProject, viewListByProject, settings, projectViewSourceScope])

const handleSwitchView = useCallback(
  async (viewId: string) => {
    if (!activeProject) {
      return
    }
    const projectKey = githubProjectIdentityKey(activeProject)
    const current = lastViewByProject[projectKey]?.viewId
    if (current === viewId) {
      return
    }
    // Why: read freshest settings via getState() so a concurrent pin/recent mutation isn't clobbered on write.
    const freshSettings = useAppStore.getState().settings
    const prevSettings = freshSettings?.githubProjects ?? {
      pinned: [],
      recent: [],
      lastViewByProject: {},
      activeProject: null
    }
    await useAppStore.getState().updateSettings({
      githubProjects: {
        ...prevSettings,
        lastViewByProject: {
          ...prevSettings.lastViewByProject,
          [projectKey]: { viewId }
        }
      }
    })
    await doFetch({
      owner: activeProject.owner,
      ownerType: activeProject.ownerType,
      projectNumber: activeProject.number,
      host: githubProjectHost(activeProject.host),
      viewId
    })
  },
  [activeProject, doFetch, lastViewByProject]
)

const currentProjectViewKey = useMemo(() => {
  if (!activeProject) {
    return null
  }
  const key = githubProjectIdentityKey(activeProject)
  const viewId = lastViewByProject[key]?.viewId
  if (!viewId) {
    return null
  }
  return `${projectViewSourceScope}:${key}:${viewId}`
}, [activeProject, lastViewByProject, projectViewSourceScope])

const currentAppliedOverride = currentProjectViewKey
  ? appliedQueryByView[currentProjectViewKey]
  : undefined

const currentCacheKey = useMemo(() => {
  if (!activeProject) {
    return null
  }
  const key = githubProjectIdentityKey(activeProject)
  const viewId = lastViewByProject[key]?.viewId
  if (!viewId) {
    return null
  }
  return projectViewCacheKey(
    activeProject.ownerType,
    activeProject.owner,
    activeProject.number,
    viewId,
    currentAppliedOverride,
    projectViewSourceScope,
    activeProject.host
  )
}, [activeProject, lastViewByProject, currentAppliedOverride, projectViewSourceScope])

const table: GitHubProjectTable | null = currentCacheKey
  ? (projectViewCache[currentCacheKey]?.data ?? null)
  : null
const selectedRepoFingerprint = useMemo(
  () => getSelectedRepoFingerprint(selectedRepoIds),
  [selectedRepoIds]
)
const filteredTable = useMemo(
  () =>
    table && slugIndexReady
      ? filterProjectTableRowsBySelectedRepos(table, lookupSlug, slugIndexReady, selectedRepoIds)
      : null,
  [table, slugIndexReady, lookupSlug, selectedRepoIds]
)
const lastFilteredTableRef = useRef<CachedVisibleProjectTable | null>(null)
// Why: ref-cache prevents a blank table while the slug index rebuilds, without forcing a second render.
lastFilteredTableRef.current = getNextVisibleProjectTableCache({
  currentCacheKey,
  selectedRepoFingerprint,
  sourceTable: table,
  slugIndexReady,
  filteredTable,
  previous: lastFilteredTableRef.current
})
const visibleTable = getVisibleProjectTable({
  currentCacheKey,
  selectedRepoFingerprint,
  slugIndexReady,
  filteredTable,
  cachedTable: lastFilteredTableRef.current
})

// Parent-dropped toast, once per table.
useEffect(() => {
  if (!table || !currentCacheKey || !table.parentFieldDropped) {
    return
  }
  if (parentDroppedToasted.has(currentCacheKey)) {
    return
  }
  toast.message(
    translate(
      'auto.components.github.project.ProjectViewWrapper.22df63c393',
      'Sub-issue data is unavailable for your token.'
    )
  )
  setParentDroppedToasted((prev) => {
    const next = new Set(prev)
    next.add(currentCacheKey)
    return next
  })
}, [table, currentCacheKey, parentDroppedToasted])

  const base = {
    selectedRepoIds,
    settings,
    projectViewCache,
    fetchProjectViewTable,
    updateProjectFieldValue,
    clearProjectFieldValue,
    patchProjectIssueOrPr,
    patchProjectRowIssueType,
    addRepoFromStore,
    repos,
    lookupSlug,
    slugIndexReady,
    mountedRef,
    activeProject,
    projectViewSourceScope,
    lastViewByProject,
    loading,
    setLoading,
    fetchRunIdRef,
    error,
    setError,
    parentDroppedToasted,
    setParentDroppedToasted,
    viewListByProject,
    setViewListByProject,
    appliedQueryByView,
    setAppliedQueryByView,
    doFetch,
    handleSelect,
    handleSwitchView,
    currentProjectViewKey,
    currentAppliedOverride,
    currentCacheKey,
    table,
    selectedRepoFingerprint,
    filteredTable,
    lastFilteredTableRef,
    visibleTable
  }
  const dialog = useProjectViewDialogController(base)
  return { ...base, ...dialog }
}

export type ProjectViewController = ReturnType<typeof useProjectViewController>
