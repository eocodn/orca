import { toast } from 'sonner'
import { TaskPageLinearToolbar } from './task-page-linear-toolbar'
import { TaskPageProviderScopeControls } from './task-page-provider-scope-controls'
import { cn } from '@/lib/utils'
import { TaskPageJiraToolbar } from './task-page-jira-toolbar'
import { TaskPageGitLabToolbar } from './task-page-gitlab-toolbar'
import { TaskPageGitHubScopeToolbar } from './task-page-github-scope-toolbar'
import { TaskPageGitHubTaskToolbar } from './task-page-github-task-toolbar'
import { TaskPageGitHubSourceDivergence } from './task-page-github-source-divergence'
import { TaskPageSourceProviderToolbar } from './task-page-source-provider-toolbar'
import { translate } from '@/i18n/i18n'
import type React from 'react'
import type { TaskPageController } from './use-task-page-controller'

type Props = { controller: TaskPageController }

export function TaskPageToolbarView({ controller }: Props): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex-none flex flex-col gap-2',
        controller.taskPageListChromeHidden && 'hidden'
      )}
    >
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <TaskPageSourceProviderToolbar
              taskSource={controller.taskSource}
              visibleSourceOptions={controller.visibleSourceOptions}
              taskSourceAvailabilityNoticeByProvider={
                controller.taskSourceAvailabilityNoticeByProvider
              }
              taskSourceContextSummary={controller.taskSourceContextSummary}
              onClose={controller.closeTaskPage}
              onSourceChange={controller.handleTaskSourceChange}
            />
            <TaskPageProviderScopeControls
              showLinearScope={controller.taskSource === 'linear' && controller.linearConnected}
              linearScopeProps={{
                workspaces: controller.linearWorkspaces,
                selectedWorkspaceId: controller.selectedLinearWorkspaceId,
                teams: controller.linearTeamOptions,
                selectedTeamIds: controller.linearTeamSelection,
                teamSelectionIsStickyAll: controller.settings?.defaultLinearTeamSelection == null,
                onWorkspaceChange: controller.handleLinearWorkspaceChange,
                onTeamSelectionChange: controller.handleLinearTeamSelectionChange,
                onAddTeamAccess: () => controller.setLinearConnectOpen(true),
                onOpen: controller.handleLinearScopeOpen
              }}
              selectedLinearTeamForExternalLink={controller.selectedLinearTeamForExternalLink}
              showJiraSiteSelector={controller.taskSource === 'jira' && controller.jiraConnected}
              jiraSites={controller.jiraSites}
              selectedJiraSiteId={controller.selectedJiraSiteId}
              onJiraSiteChange={(value) => {
                controller.setSelectedJiraIssueKey(null)
                controller.setSelectedJiraIssueFallback(null)
                controller.setJiraIssues([])
                controller.setJiraError(null)
                controller.setJiraLoading(true)
                void controller.selectJiraSite(value).catch(() => {
                  toast.error(
                    translate('auto.components.TaskPage.d09b7631b7', 'Failed to switch Jira site.')
                  )
                })
              }}
              taskSourceAvailabilityNotice={controller.taskSourceAvailabilityNotice}
            />
          </div>

          {controller.taskSource === 'github' ? (
            <TaskPageGitHubScopeToolbar
              projectModeVisible={controller.projectModeVisible}
              githubModeButtons={controller.githubModeButtons}
              githubMode={controller.githubMode}
              activeGithubTaskKind={controller.activeGithubTaskKind}
              onModeChange={controller.handleGithubModeChange}
              groups={controller.taskPickerGroups}
              selected={controller.repoSelection}
              getRepoHostLabel={controller.getTaskPickerRepoHostLabel}
              onRepoSelectionChange={controller.handleTaskRepoSelectionChange}
              onSelectAll={controller.handleTaskSelectAll}
              selectedGitHubRepoExternalLink={controller.selectedGitHubRepoExternalLink}
              onOpenExternal={controller.openSelectedGithubRepo}
            />
          ) : null}

          {controller.taskSource === 'github' && controller.githubMode === 'items' ? (
            <TaskPageGitHubTaskToolbar
              activeGithubTaskKind={controller.activeGithubTaskKind}
              activeTaskPreset={controller.activeTaskPreset}
              onPresetSelect={controller.handleGithubPresetSelect}
              onSetDefaultTaskPreset={controller.handleSetDefaultTaskPreset}
              parsedTaskQuery={controller.appliedTaskQuery}
              loadedGitHubAuthorLogins={controller.loadedGitHubAuthorLogins}
              primaryGithubFilterSlug={controller.primaryGithubFilterSlug}
              settings={controller.settings}
              onPRFilterChange={controller.applyPRFilterChange}
              taskSearchInputRef={controller.taskSearchInputRef}
              taskSearchInput={controller.taskSearchInput}
              appliedTaskSearch={controller.appliedTaskSearch}
              onSearchChange={controller.handleTaskSearchChange}
              onSearchKeyDown={controller.handleTaskSearchKeyDown}
              onResetSearch={controller.handleResetGithubTaskSearch}
              newIssueTargetRepo={Boolean(controller.newIssueTargetRepo)}
              onCreateIssue={controller.handleCreateGithubIssueFromToolbar}
              githubTasksBusy={controller.githubTasksBusy}
              onRefresh={controller.handleRefreshGithubTasks}
            >
              <TaskPageGitHubSourceDivergence
                selectedRepos={controller.selectedRepos}
                perRepoSourceState={controller.perRepoSourceState}
                onIssueSourcePreferenceChange={controller.setIssueSourcePreference}
              />
            </TaskPageGitHubTaskToolbar>
          ) : controller.taskSource === 'linear' && controller.linearConnected ? (
            <TaskPageLinearToolbar
              linearModeOptions={controller.linearModeOptions}
              linearMode={controller.linearMode}
              onModeChange={controller.selectLinearMode}
              onCreate={controller.handleCreateLinearItem}
              onRefresh={() => controller.setLinearRefreshNonce((n) => n + 1)}
              availableTeams={controller.availableTeams}
              selectedLinearProject={controller.selectedLinearProject}
              linearLoading={controller.linearLoading}
              linearProjectsLoading={controller.linearProjectsLoading}
              linearProjectDetailLoading={controller.linearProjectDetailLoading}
              linearCustomViewsLoading={controller.linearCustomViewsLoading}
              linearCustomViewContentsLoading={controller.linearCustomViewContentsLoading}
              showAttributeFilters={controller.showLinearAttributeFilters}
              attributeFilter={controller.linearAttributeFilter}
              onAttributeFilterChange={controller.applyLinearAttributeFilter}
              workspaceId={controller.selectedLinearWorkspaceId ?? null}
              isAllWorkspaces={controller.selectedLinearWorkspaceId === 'all'}
              primaryTeam={controller.linearAttributePrimaryTeam}
              selectedTeamIds={[...controller.linearTeamSelection]}
              settings={controller.linearTaskSourceContext ?? controller.settings}
              linearSearchInput={controller.linearSearchInput}
              onLinearSearchChange={controller.setLinearSearchInput}
              onLinearSearchSubmit={controller.submitLinearSearch}
              onLinearSearchClear={controller.clearLinearSearch}
              linearProjectSearchInput={controller.linearProjectSearchInput}
              onLinearProjectSearchChange={controller.setLinearProjectSearchInput}
              onLinearProjectSearchClear={() => {
                controller.setLinearProjectSearchInput('')
                controller.setAppliedLinearProjectSearch('')
                controller.setLinearRefreshNonce((n) => n + 1)
              }}
            />
          ) : controller.taskSource === 'jira' && controller.jiraConnected ? (
            <TaskPageJiraToolbar
              jiraPresets={controller.jiraPresets}
              activeJiraPreset={controller.activeJiraPreset}
              onPresetChange={controller.selectJiraPreset}
              onCreate={controller.handleCreateJiraIssue}
              sortedAvailableJiraProjects={controller.sortedAvailableJiraProjects}
              jiraProjectsLoading={controller.jiraProjectsLoading}
              onRefresh={() => controller.setJiraRefreshNonce((n) => n + 1)}
              jiraLoading={controller.jiraLoading}
              jiraSearchInput={controller.jiraSearchInput}
              onSearchChange={controller.setJiraSearchInput}
              onSearchSubmit={controller.submitJiraSearch}
              onSearchClear={controller.clearJiraSearch}
            />
          ) : controller.taskSource === 'gitlab' ? (
            <TaskPageGitLabToolbar
              gitlabView={controller.gitlabView}
              onViewChange={controller.setGitlabView}
              gitLabIssueFilters={controller.gitLabIssueFilters}
              gitLabMRFilters={controller.gitLabMRFilters}
              activeGitlabFilter={controller.activeGitlabFilter}
              onFilterChange={controller.handleGitlabFilterChange}
              groups={controller.taskPickerGroups}
              selected={controller.repoSelection}
              getRepoHostLabel={controller.getTaskPickerRepoHostLabel}
              onRepoSelectionChange={controller.handleTaskRepoSelectionChange}
              onSelectAll={controller.handleTaskSelectAll}
              gitlabLoading={controller.gitlabLoading}
              gitlabTodosLoading={controller.gitlabTodosLoading}
              onRefresh={() => controller.setGitlabRefreshNonce((n) => n + 1)}
            />
          ) : null}
        </div>
      </section>
    </div>
  )
}
