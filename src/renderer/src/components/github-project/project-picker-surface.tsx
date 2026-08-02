// Concrete surface implementation for ProjectPicker.tsx
// Why: the picker is the only v1 entry point for switching projects (no
// header tab strip). Pinned + Recent come from settings; Browse all lazy-loads
// from `listAccessibleProjects` and is cached for 5 minutes. Paste-to-add
// accepts org/user project URLs and `owner/number` shorthand.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import type {
  GitHubProjectOwnerType,
  GitHubProjectSettings,
  GitHubProjectSummary,
  GitHubProjectViewError,
  GitHubProjectViewSummary
} from '../../../../shared/github-project-types'
import {
  hasBoundedGitHubProjectRefInputText,
  isGitHubProjectRefInputTooLarge
} from '../../../../shared/github-project-ref-input'
import { filterGitHubProjectPickerProjects } from './github-project-picker-filter'
import {
  getProjectPickerBrowseCacheEntry,
  peekProjectPickerBrowseCacheEntry,
  rememberProjectPickerBrowseCacheEntry
} from './project-picker-browse-cache'
import { translate } from '@/i18n/i18n'
import {
  githubProjectHost,
  githubProjectIdentityKey
} from '../../../../shared/github-project-identity'
import {
  getProjectPickerBrowseHost,
  getProjectPickerRuntimeScope,
  listAccessibleProjectsForRuntime,
  listProjectViewsForRuntime,
  resolveProjectRefForRuntime
} from './project-picker-runtime'
import {
  GITHUB_PROJECT_REF_INPUT_TOO_LARGE_ERROR,
  parseProjectInput
} from './project-picker-input'
import {
  AuthErrorBanner,
  PartialFailuresBanner,
  PickerRow,
  Section,
  ViewPickStep
} from './project-picker-presentational'

export { getProjectPickerBrowseHost } from './project-picker-runtime'
export { parseProjectInput } from './project-picker-input'

export type ResolvedProjectSelection = {
  owner: string
  ownerType: GitHubProjectOwnerType
  projectNumber: number
  host?: string
  viewId?: string
}

type Props = {
  activeProject: {
    owner: string
    ownerType: GitHubProjectOwnerType
    number: number
    host?: string
    title?: string
  } | null
  onSelect: (selection: ResolvedProjectSelection) => void
}

export default function ProjectPicker({ activeProject, onSelect }: Props): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const mountedRef = useMountedRef()
  const projectSettings: GitHubProjectSettings = useMemo(
    () =>
      settings?.githubProjects ?? {
        pinned: [],
        recent: [],
        lastViewByProject: {},
        activeProject: null
      },
    [settings?.githubProjects]
  )

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState<GitHubProjectViewError | null>(null)
  const browseHost = getProjectPickerBrowseHost(activeProject ?? projectSettings.activeProject)
  const browseCacheKey = getProjectPickerRuntimeScope(settings, browseHost)
  const activeBrowseCacheKeyRef = useRef(browseCacheKey)
  // Why: sync the ref after commit, not during render — a discarded concurrent
  // render must not publish a newer cache key that drops the committed tree's
  // in-flight browse request.
  useLayoutEffect(() => {
    activeBrowseCacheKeyRef.current = browseCacheKey
  }, [browseCacheKey])
  const browseCache = peekProjectPickerBrowseCacheEntry(browseCacheKey)
  const [browseProjects, setBrowseProjects] = useState<GitHubProjectSummary[]>(
    () => browseCache?.projects ?? []
  )
  // Why: partial-failures are cached alongside projects so dismissing the
  // popover and reopening within the 5min window doesn't flicker the
  // banner back. Populated only when discovery succeeded but a subset of
  // orgs failed (the 504 path the user reported).
  const [partialFailures, setPartialFailures] = useState<{ owner: string; message: string }[]>(
    () => browseCache?.partialFailures ?? []
  )
  const [pasteInput, setPasteInput] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [pasteBusy, setPasteBusy] = useState(false)

  // View-pick step state.
  const [viewPickFor, setViewPickFor] = useState<ResolvedProjectSelection | null>(null)
  const [viewList, setViewList] = useState<GitHubProjectViewSummary[]>([])
  const [viewLoading, setViewLoading] = useState(false)

  const loadBrowse = useCallback(async () => {
    const cacheKey = browseCacheKey
    const cached = getProjectPickerBrowseCacheEntry(cacheKey)
    if (cached) {
      setBrowseLoading(false)
      setBrowseError(null)
      setBrowseProjects(cached.projects)
      setPartialFailures(cached.partialFailures ?? [])
      return
    }
    setBrowseLoading(true)
    setBrowseError(null)
    setBrowseProjects([])
    setPartialFailures([])
    try {
      const res = await listAccessibleProjectsForRuntime(settings, browseHost)
      if (res.ok) {
        rememberProjectPickerBrowseCacheEntry(cacheKey, {
          projects: res.projects,
          partialFailures: res.partialFailures
        })
        // Why: runtime or active-host changes can leave the prior request in
        // flight; its scoped cache is useful, but its rows must not cross hosts.
        if (!mountedRef.current || activeBrowseCacheKeyRef.current !== cacheKey) {
          return
        }
        setBrowseProjects(res.projects)
        setPartialFailures(res.partialFailures ?? [])
      } else {
        if (!mountedRef.current || activeBrowseCacheKeyRef.current !== cacheKey) {
          return
        }
        setBrowseError(res.error)
      }
    } catch (err) {
      if (mountedRef.current && activeBrowseCacheKeyRef.current === cacheKey) {
        setBrowseError({
          type: 'unknown',
          message: err instanceof Error ? err.message : 'Failed to list projects'
        })
      }
    } finally {
      if (mountedRef.current && activeBrowseCacheKeyRef.current === cacheKey) {
        setBrowseLoading(false)
      }
    }
  }, [browseCacheKey, browseHost, mountedRef, settings])

  useEffect(() => {
    if (open && !viewPickFor) {
      void loadBrowse()
    }
  }, [open, viewPickFor, loadBrowse])

  const updateProjectSettings = useCallback(
    async (mutate: (prev: GitHubProjectSettings) => GitHubProjectSettings) => {
      const prev = projectSettings
      const next = mutate(prev)
      // Why: settings deep-merges only notifications; write the full
      // githubProjects object so sibling fields (pinned/recent/lastView/active)
      // are not clobbered by a partial write.
      await updateSettings({ githubProjects: next })
    },
    [projectSettings, updateSettings]
  )

  const commitSelection = useCallback(
    async (selection: ResolvedProjectSelection, title: string | null) => {
      const key = githubProjectIdentityKey({
        owner: selection.owner,
        ownerType: selection.ownerType,
        number: selection.projectNumber,
        host: selection.host
      })
      await updateProjectSettings((prev) => {
        const recent = [
          {
            owner: selection.owner,
            ownerType: selection.ownerType,
            number: selection.projectNumber,
            host: githubProjectHost(selection.host),
            lastOpenedAt: new Date().toISOString()
          },
          ...prev.recent.filter((r) => githubProjectIdentityKey(r) !== key)
        ].slice(0, 10)
        const lastViewByProject = { ...prev.lastViewByProject }
        if (selection.viewId) {
          lastViewByProject[key] = { viewId: selection.viewId }
        }
        return {
          ...prev,
          recent,
          lastViewByProject,
          activeProject: {
            owner: selection.owner,
            ownerType: selection.ownerType,
            number: selection.projectNumber,
            host: githubProjectHost(selection.host)
          }
        }
      })
      if (!mountedRef.current) {
        return
      }
      onSelect(selection)
      setOpen(false)
      setQuery('')
      setViewPickFor(null)
      void title
    },
    [mountedRef, onSelect, updateProjectSettings]
  )

  const handleChooseProject = useCallback(
    async (selection: {
      owner: string
      ownerType: GitHubProjectOwnerType
      number: number
      host?: string
      title?: string
      // Why: when the paste resolver parsed a /views/{n} URL, the caller
      // passes the view number through so we can skip the view-pick step
      // and commit directly once listProjectViews returns the matching id.
      viewNumber?: number
    }) => {
      const key = githubProjectIdentityKey(selection)
      const lastView = projectSettings.lastViewByProject[key]?.viewId
      // Why: an explicit viewNumber from the URL takes precedence over the
      // remembered last view — the user's intent (paste this exact view) wins
      // over the heuristic (re-open the last view they used).
      if (lastView && selection.viewNumber === undefined) {
        await commitSelection(
          {
            owner: selection.owner,
            ownerType: selection.ownerType,
            projectNumber: selection.number,
            host: githubProjectHost(selection.host),
            viewId: lastView
          },
          selection.title ?? null
        )
        return
      }
      // No prior view (or explicit viewNumber from URL) — load views.
      setViewPickFor({
        owner: selection.owner,
        ownerType: selection.ownerType,
        projectNumber: selection.number,
        host: githubProjectHost(selection.host)
      })
      setViewLoading(true)
      try {
        const res = await listProjectViewsForRuntime(settings, {
          owner: selection.owner,
          ownerType: selection.ownerType,
          projectNumber: selection.number,
          host: githubProjectHost(selection.host)
        })
        if (!mountedRef.current) {
          return
        }
        if (res.ok) {
          setViewList(res.views)
          if (selection.viewNumber !== undefined) {
            // Why: the URL pinned a specific view number — find its id and
            // commit directly, bypassing the view-pick step. If the number
            // doesn't match any view (deleted/renumbered), fall through to
            // the picker so the user can choose another view.
            const match = res.views.find((v) => v.number === selection.viewNumber)
            if (match) {
              await commitSelection(
                {
                  owner: selection.owner,
                  ownerType: selection.ownerType,
                  projectNumber: selection.number,
                  host: githubProjectHost(selection.host),
                  viewId: match.id
                },
                selection.title ?? null
              )
            }
          }
        } else {
          setViewList([])
          toast.error(res.error.message)
        }
      } catch (err) {
        // Why: IPC transport errors (channel disconnect, serialization
        // failure) propagate as rejected promises and would otherwise become
        // unhandled rejections — leaving the picker stuck on the view-pick
        // step with a perpetual spinner. Treat as an empty result and toast
        // a transport-level message so the user can retry or paste again.
        if (mountedRef.current) {
          setViewList([])
          toast.error(
            translate(
              'auto.components.github.project.ProjectPicker.44b2c6326b',
              'Failed to load views: {{value0}}',
              { value0: err instanceof Error ? err.message : String(err) }
            )
          )
        }
      } finally {
        if (mountedRef.current) {
          setViewLoading(false)
        }
      }
    },
    [commitSelection, mountedRef, projectSettings.lastViewByProject, settings]
  )

  const handlePaste = useCallback(async () => {
    if (isGitHubProjectRefInputTooLarge(pasteInput)) {
      setPasteError(GITHUB_PROJECT_REF_INPUT_TOO_LARGE_ERROR)
      return
    }
    const input = pasteInput.trim()
    const parsed = parseProjectInput(input)
    if (!parsed) {
      setPasteError('Expected a project URL or owner/number')
      return
    }
    setPasteError(null)
    setPasteBusy(true)
    try {
      const res = await resolveProjectRefForRuntime(settings, input, parsed.host)
      if (!mountedRef.current) {
        return
      }
      if (!res.ok) {
        setPasteError(res.error.message)
        return
      }
      setPasteInput('')
      await handleChooseProject({
        owner: res.owner,
        ownerType: res.ownerType,
        number: res.number,
        host: githubProjectHost(res.host ?? parsed.host),
        title: res.title,
        // Why: forward the parsed view number from /views/{n} URLs so the
        // chooser can skip the view-pick step and commit directly.
        ...(res.viewNumber !== undefined ? { viewNumber: res.viewNumber } : {})
      })
    } finally {
      if (mountedRef.current) {
        setPasteBusy(false)
      }
    }
  }, [handleChooseProject, mountedRef, pasteInput, settings])

  const canSubmitPasteInput = !pasteBusy && hasBoundedGitHubProjectRefInputText(pasteInput)

  const filteredBrowse = useMemo(() => {
    return filterGitHubProjectPickerProjects({
      projects: browseProjects,
      pinned: projectSettings.pinned,
      recent: projectSettings.recent,
      query
    })
  }, [browseProjects, projectSettings.pinned, projectSettings.recent, query])

  const buttonLabel = activeProject
    ? `${activeProject.owner} / ${activeProject.title ?? `#${activeProject.number}`}`
    : 'Choose a project'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 border-border/50 bg-transparent text-xs"
        >
          <span className="truncate">{buttonLabel}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        {viewPickFor ? (
          <ViewPickStep
            loading={viewLoading}
            views={viewList}
            onPick={async (view) => {
              await commitSelection({ ...viewPickFor, viewId: view.id }, null)
            }}
            onBack={() => setViewPickFor(null)}
          />
        ) : (
          <div className="flex flex-col">
            <div className="border-b border-border/50 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={translate(
                    'auto.components.github.project.ProjectPicker.f492e1b539',
                    'Search projects'
                  )}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>
            {browseError ? <AuthErrorBanner error={browseError} host={browseHost} /> : null}
            {!browseError && partialFailures.length > 0 ? (
              <PartialFailuresBanner failures={partialFailures} />
            ) : null}
            <div className="max-h-[340px] overflow-y-auto p-1 scrollbar-sleek">
              {projectSettings.pinned.length > 0 ? (
                <Section
                  label={translate(
                    'auto.components.github.project.ProjectPicker.707843206c',
                    'Pinned'
                  )}
                >
                  {projectSettings.pinned.map((p) => {
                    const key = githubProjectIdentityKey(p)
                    const knownGood = projectSettings.lastViewByProject[key]?.viewId != null
                    const match = browseProjects.find((bp) => githubProjectIdentityKey(bp) === key)
                    return (
                      <PickerRow
                        key={key}
                        title={match?.title ?? `#${p.number}`}
                        subtitle={`${p.owner}`}
                        zombie={!knownGood}
                        onClick={() =>
                          handleChooseProject({
                            owner: p.owner,
                            ownerType: p.ownerType,
                            number: p.number,
                            host: githubProjectHost(p.host),
                            title: match?.title
                          })
                        }
                        onRemovePin={async () => {
                          await updateProjectSettings((prev) => ({
                            ...prev,
                            pinned: prev.pinned.filter((x) => githubProjectIdentityKey(x) !== key)
                          }))
                        }}
                      />
                    )
                  })}
                </Section>
              ) : null}
              {projectSettings.recent.length > 0 ? (
                <Section
                  label={translate(
                    'auto.components.github.project.ProjectPicker.b3044b7a25',
                    'Recent'
                  )}
                >
                  {projectSettings.recent
                    .filter(
                      (r) =>
                        !projectSettings.pinned.some(
                          (p) => githubProjectIdentityKey(p) === githubProjectIdentityKey(r)
                        )
                    )
                    .map((r) => {
                      const key = githubProjectIdentityKey(r)
                      const match = browseProjects.find(
                        (bp) => githubProjectIdentityKey(bp) === key
                      )
                      const pinnable = projectSettings.lastViewByProject[key]?.viewId != null
                      return (
                        <PickerRow
                          key={key}
                          title={match?.title ?? `#${r.number}`}
                          subtitle={r.owner}
                          canPin={pinnable}
                          onPin={async () => {
                            await updateProjectSettings((prev) => ({
                              ...prev,
                              pinned: [
                                ...prev.pinned,
                                {
                                  owner: r.owner,
                                  ownerType: r.ownerType,
                                  number: r.number,
                                  host: githubProjectHost(r.host)
                                }
                              ].slice(0, 20)
                            }))
                          }}
                          onClick={() =>
                            handleChooseProject({
                              owner: r.owner,
                              ownerType: r.ownerType,
                              number: r.number,
                              host: githubProjectHost(r.host),
                              title: match?.title
                            })
                          }
                        />
                      )
                    })}
                </Section>
              ) : null}
              <Section
                label={
                  browseLoading
                    ? translate(
                        'auto.components.github.project.ProjectPicker.ba0ab9a117',
                        'Browse all (loading…)'
                      )
                    : translate(
                        'auto.components.github.project.ProjectPicker.b787682111',
                        'Browse all'
                      )
                }
              >
                {browseLoading ? (
                  <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                    <Loader className="size-3 animate-spin" />{' '}
                    {translate(
                      'auto.components.github.project.ProjectPicker.7b6d39627e',
                      'Loading…'
                    )}
                  </div>
                ) : null}
                {filteredBrowse.map((p) => (
                  <PickerRow
                    key={githubProjectIdentityKey(p)}
                    title={p.title}
                    subtitle={p.owner}
                    onClick={() =>
                      handleChooseProject({
                        owner: p.owner,
                        ownerType: p.ownerType,
                        number: p.number,
                        host: githubProjectHost(p.host),
                        title: p.title
                      })
                    }
                  />
                ))}
              </Section>
            </div>
            <div className="border-t border-border/50 p-2">
              <div className="flex gap-2">
                <Input
                  value={pasteInput}
                  onChange={(e) => {
                    const nextInput = e.target.value
                    setPasteInput(nextInput)
                    setPasteError(
                      isGitHubProjectRefInputTooLarge(nextInput)
                        ? GITHUB_PROJECT_REF_INPUT_TOO_LARGE_ERROR
                        : null
                    )
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handlePaste()
                    }
                  }}
                  placeholder={translate(
                    'auto.components.github.project.ProjectPicker.5113ecc298',
                    'Add by URL or owner/number'
                  )}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  onClick={() => void handlePaste()}
                  disabled={!canSubmitPasteInput}
                  className="h-8"
                >
                  {translate('auto.components.github.project.ProjectPicker.fce99a24a7', 'Add')}
                </Button>
              </div>
              {pasteError ? (
                <div className="mt-1 text-[11px] text-destructive">{pasteError}</div>
              ) : null}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
