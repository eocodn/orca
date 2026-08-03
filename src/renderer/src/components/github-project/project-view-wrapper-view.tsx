import React from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import GitHubItemDialog from '@/components/GitHubItemDialog'
import { launchWorkItemDirect } from '@/lib/launch-work-item-direct'
import { cn } from '@/lib/utils'
import ProjectPicker from './ProjectPicker'
import ProjectViewList from './ProjectViewList'
import ProjectItemSlugDialog from './ProjectItemSlugDialog'
import { githubProjectHost, githubProjectIdentityKey } from '../../../../shared/github-project-identity'
import { translate } from '@/i18n/i18n'
import type { ProjectViewController } from './use-project-view-controller'
import { ErrorState, ProjectSearchInput, ProjectTableSkeleton, ViewTabStrip } from './project-view-wrapper-surface'

export function ProjectViewWrapperView(controller: ProjectViewController): React.JSX.Element {
  const { settings, projectViewCache, fetchProjectViewTable, updateProjectFieldValue, clearProjectFieldValue, patchProjectIssueOrPr, patchProjectRowIssueType, addRepoFromStore, repos, lookupSlug, slugIndexReady, mountedRef, activeProject, projectViewSourceScope, lastViewByProject, fetchRunIdRef, error, setError, parentDroppedToasted, setParentDroppedToasted, viewListByProject, setViewListByProject, appliedQueryByView, setAppliedQueryByView, doFetch, handleSelect, handleSwitchView, currentProjectViewKey, currentAppliedOverride, currentCacheKey, table, loading, selectedRepoFingerprint, filteredTable, lastFilteredTableRef, visibleTable, selectedViewUrl, dialogRepoItem, setDialogRepoItem, slugDialog, setSlugDialog, repoNotInOrca, setRepoNotInOrca, liveRepoIds, resolvedDialogRepoItem, resolvedDialogRepo, resolvedDialogSourceContext, resolvedMissingRepoDialogs, buildOrigin, openProjectRowUrlWithToast, handleOpenDialog, handleStartWork, handleEditAssignees, handleEditLabels, handleEditIssueType, handleEditField } = controller
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 flex-none flex-wrap items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-2">
        <ProjectPicker
          activeProject={
            activeProject && table
              ? {
                  owner: activeProject.owner,
                  ownerType: activeProject.ownerType,
                  number: activeProject.number,
                  host: githubProjectHost(activeProject.host),
                  title: table.project.title
                }
              : activeProject
                ? {
                    owner: activeProject.owner,
                    ownerType: activeProject.ownerType,
                    number: activeProject.number,
                    host: githubProjectHost(activeProject.host)
                  }
                : null
          }
          onSelect={handleSelect}
        />
        {currentProjectViewKey ? (
          // Why: keep search box mounted through refetches so it doesn't vanish; `key` resets input per (project, view).
          <ProjectSearchInput
            key={currentProjectViewKey}
            viewFilter={table?.selectedView.filter ?? ''}
            appliedOverride={appliedQueryByView[currentProjectViewKey]}
            onApply={(nextOverride) => {
              if (!activeProject) {
                return
              }
              const key = githubProjectIdentityKey(activeProject)
              const viewId = lastViewByProject[key]?.viewId
              if (!viewId) {
                return
              }
              setAppliedQueryByView((prev) => {
                const next = { ...prev }
                if (nextOverride === undefined) {
                  delete next[currentProjectViewKey]
                } else {
                  next[currentProjectViewKey] = nextOverride
                }
                return next
              })
              // Why: force-fetch on user apply so a re-typed or TTL-cached query doesn't silently no-op.
              void doFetch(
                {
                  owner: activeProject.owner,
                  ownerType: activeProject.ownerType,
                  projectNumber: activeProject.number,
                  host: githubProjectHost(activeProject.host),
                  viewId
                },
                true,
                nextOverride
              )
            }}
          />
        ) : null}
        {table ? (
          <>
            <span className="ml-auto rounded-full border border-border/50 bg-background px-2 py-0.5 text-[11px]">
              {visibleTable?.totalCount ?? table.totalCount}
            </span>
            {selectedViewUrl ? (
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => void window.api.shell.openUrl(selectedViewUrl)}
                aria-label={translate(
                  'auto.components.github.project.ProjectViewWrapper.fd15491034',
                  'Open view in GitHub'
                )}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 cursor-pointer disabled:pointer-events-auto disabled:cursor-wait"
              onClick={() => {
                if (!activeProject || !currentCacheKey) {
                  return
                }
                const key = githubProjectIdentityKey(activeProject)
                const viewId = lastViewByProject[key]?.viewId
                if (!viewId) {
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
                  true,
                  currentAppliedOverride
                )
              }}
              disabled={loading}
              aria-busy={loading}
              aria-label={
                loading
                  ? translate(
                      'auto.components.github.project.ProjectViewWrapper.a8fa0d2bf5',
                      'Refreshing'
                    )
                  : translate(
                      'auto.components.github.project.ProjectViewWrapper.71fb69926c',
                      'Refresh'
                    )
              }
              title={
                loading
                  ? translate(
                      'auto.components.github.project.ProjectViewWrapper.a8fa0d2bf5',
                      'Refreshing'
                    )
                  : translate(
                      'auto.components.github.project.ProjectViewWrapper.71fb69926c',
                      'Refresh'
                    )
              }
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            </Button>
          </>
        ) : null}
      </div>

      {activeProject
        ? (() => {
            const projectKey = githubProjectIdentityKey(activeProject)
            const scopedProjectKey = `${projectViewSourceScope}:${projectKey}`
            const views = viewListByProject[scopedProjectKey] ?? []
            const activeViewId = lastViewByProject[projectKey]?.viewId ?? null
            return (
              <ViewTabStrip
                views={views}
                activeViewId={activeViewId}
                onPick={(viewId) => void handleSwitchView(viewId)}
              />
            )
          })()
        : null}

      {!activeProject ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          {translate(
            'auto.components.github.project.ProjectViewWrapper.512fc171d6',
            'Choose a project to get started.'
          )}
        </div>
      ) : loading && !table ? (
        <ProjectTableSkeleton />
      ) : error ? (
        <ErrorState
          error={error.error}
          totalCount={error.totalCount}
          host={activeProject.host}
          onOpenInGitHub={() => {
            if (selectedViewUrl) {
              void window.api.shell.openUrl(selectedViewUrl)
            }
          }}
        />
      ) : visibleTable && resolvedDialogRepoItem ? (
        <GitHubItemDialog
          workItem={resolvedDialogRepoItem.workItem}
          repoPath={resolvedDialogRepoItem.repoPath}
          repoId={resolvedDialogRepoItem.repoId}
          sourceContext={resolvedDialogSourceContext}
          projectOrigin={resolvedDialogRepoItem.origin}
          backLabel={translate(
            'auto.components.github.project.ProjectViewWrapper.1aa7c952b9',
            'Project view'
          )}
          onUse={(item) => {
            const current = resolvedDialogRepoItem
            setDialogRepoItem(null)
            // Why: issue #4756 keeps project-view actions on the direct "start work now" path, not the TaskPage background-create flow.
            void launchWorkItemDirect({
              item,
              repoId: current.workItem.repoId,
              launchSource: 'task_page',
              telemetrySource: 'sidebar',
              openModalFallback: () => {
                if (item.url) {
                  void window.api.shell.openUrl(item.url)
                }
              }
            })
          }}
          onClose={() => setDialogRepoItem(null)}
        />
      ) : visibleTable ? (
        <ProjectViewList
          table={visibleTable}
          onOpenDialog={handleOpenDialog}
          onEditField={handleEditField}
          onEditAssignees={(row, add, remove) => void handleEditAssignees(row, add, remove)}
          onEditLabels={(row, add, remove) => void handleEditLabels(row, add, remove)}
          onEditIssueType={(row, issueType) => void handleEditIssueType(row, issueType)}
          onOpenInBrowser={(row) => {
            if (row.content.url) {
              void window.api.shell.openUrl(row.content.url)
            }
          }}
          onStartWork={handleStartWork}
          sourceSettings={settings}
        />
      ) : null}

      {/* Slug-only dialog for unadded-repo rows; Start-work lives in the parent's `repoNotInOrca` modal, not here (avoids a confusing duplicate button). */}
      <ProjectItemSlugDialog
        projectOrigin={resolvedMissingRepoDialogs.slugDialog?.origin ?? null}
        sourceSettings={settings}
        onClose={() => setSlugDialog(null)}
      />

      {/* repo-not-in-orca prompt: see design doc Interaction States. */}
      <Dialog
        open={resolvedMissingRepoDialogs.repoNotInOrca !== null}
        onOpenChange={(open) => !open && setRepoNotInOrca(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.github.project.ProjectViewWrapper.7037c8f5f1',
                'Repository not in Orca'
              )}
            </DialogTitle>
            <DialogDescription>
              {resolvedMissingRepoDialogs.repoNotInOrca
                ? translate(
                    'auto.components.github.project.ProjectViewWrapper.1850fceac8',
                    "{{value0}}/{{value1}} isn't added to Orca. Add it to start work, or open in GitHub.",
                    {
                      value0: resolvedMissingRepoDialogs.repoNotInOrca.owner,
                      value1: resolvedMissingRepoDialogs.repoNotInOrca.repo
                    }
                  )
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="ghost" onClick={() => setRepoNotInOrca(null)}>
              {translate('auto.components.github.project.ProjectViewWrapper.dffa899f36', 'Cancel')}
            </Button>
            {resolvedMissingRepoDialogs.repoNotInOrca?.url ? (
              <Button
                variant="outline"
                onClick={() => {
                  if (resolvedMissingRepoDialogs.repoNotInOrca?.url) {
                    void window.api.shell.openUrl(resolvedMissingRepoDialogs.repoNotInOrca.url)
                  }
                  setRepoNotInOrca(null)
                }}
              >
                {translate(
                  'auto.components.github.project.ProjectViewWrapper.23b87ba9f7',
                  'Open in GitHub'
                )}
              </Button>
            ) : null}
            <Button
              onClick={async () => {
                // Why: `addRepo` opens the OS folder picker (auto-clone is out of v1 scope); close the modal regardless so a cancelled picker doesn't trap the user.
                setRepoNotInOrca(null)
                await addRepoFromStore()
              }}
            >
              {translate(
                'auto.components.github.project.ProjectViewWrapper.840c268665',
                'Add repo'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
