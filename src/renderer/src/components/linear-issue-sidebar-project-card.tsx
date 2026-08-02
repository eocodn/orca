import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, FolderKanban, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getLinearProjectSearchRequestQuery } from '@/components/linear-project-search-query'
import { useAppStore } from '@/store'
import { linearListProjects, linearUpdateIssue } from '@/runtime/runtime-linear-client'
import type { LinearIssue, LinearProjectSummary } from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import { translate } from '@/i18n/i18n'

export function LinearIssueSidebarProjectCard({
  issue,
  onProjectChanged,
  sourceContext
}: {
  issue: LinearIssue
  onProjectChanged: (project: LinearProjectSummary) => void
  sourceContext?: TaskSourceContext | null
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const providerSettings = sourceContext ?? settings
  const patchLinearIssue = useAppStore((s) => s.patchLinearIssue)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [projects, setProjects] = useState<LinearProjectSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [savingProjectId, setSavingProjectId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const requestQuery = getLinearProjectSearchRequestQuery(query)
    if (requestQuery === null) {
      // Oversized pasted queries stay visible but must not reach provider IPC/RPC.
      setProjects([])
      setLoading(false)
      return
    }
    let cancelled = false
    const timeout = window.setTimeout(() => {
      setLoading(true)
      void linearListProjects(providerSettings, requestQuery, 20, issue.workspaceId)
        .then((result) => {
          if (!cancelled) {
            setProjects(result.items)
          }
        })
        .catch((error) => {
          if (!cancelled) {
            toast.error(
              error instanceof Error
                ? error.message
                : translate(
                    'auto.components.LinearIssueWorkspace.38b80780c2',
                    'Failed to load projects'
                  )
            )
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false)
          }
        })
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [issue.workspaceId, open, providerSettings, query])

  const handleSelectProject = useCallback(
    async (project: LinearProjectSummary) => {
      setSavingProjectId(project.id)
      try {
        const result = await linearUpdateIssue(
          providerSettings,
          issue.id,
          { projectId: project.id },
          issue.workspaceId
        )
        if (result.ok) {
          onProjectChanged(project)
          patchLinearIssue(issue.id, { project }, { sourceContext })
          toast.success(
            translate('auto.components.LinearIssueWorkspace.f9d4ef9807', 'Project updated')
          )
          setOpen(false)
        } else {
          toast.error(result.error)
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.LinearIssueWorkspace.8b5b593053',
                'Failed to update project'
              )
        )
      } finally {
        setSavingProjectId(null)
      }
    },
    [
      issue.id,
      issue.workspaceId,
      onProjectChanged,
      patchLinearIssue,
      providerSettings,
      sourceContext
    ]
  )

  return (
    <section className="rounded-xl border border-border/60 bg-card text-card-foreground shadow-xs">
      <div className="flex h-10 items-center gap-1 border-b border-border/50 px-4 text-sm font-medium text-muted-foreground">
        <span>{translate('auto.components.LinearIssueWorkspace.b51276c8d6', 'Project')}</span>
        <ChevronDown className="size-3.5" />
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="m-3 flex min-h-9 w-[calc(100%-1.5rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <FolderKanban className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {issue.project?.name ??
                translate('auto.components.LinearIssueWorkspace.519c3587f3', 'Add to project')}
            </span>
            <ChevronDown className="size-3.5 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <div className="space-y-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={translate(
                'auto.components.LinearIssueWorkspace.db3f269d98',
                'Search projects'
              )}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="max-h-64 overflow-y-auto scrollbar-sleek">
              {loading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  {translate('auto.components.LinearIssueWorkspace.937ba6ad9a', 'Loading projects')}
                </div>
              ) : projects.length > 0 ? (
                projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => void handleSelectProject(project)}
                    disabled={savingProjectId !== null}
                    className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-70"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full bg-muted"
                      style={project.color ? { backgroundColor: project.color } : undefined}
                    />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {savingProjectId === project.id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : issue.project?.id === project.id ? (
                      <Check className="size-3.5" />
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  {query.trim()
                    ? translate(
                        'auto.components.LinearIssueWorkspace.c11b4e3cc2',
                        'No projects found.'
                      )
                    : translate(
                        'auto.components.LinearIssueWorkspace.76ffd3c937',
                        'Search for a project to add.'
                      )}
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </section>
  )
}

