import { TaskPageJiraIssueDialog } from './task-page-jira-issue-dialog'
import { TaskPageGitHubIssueDialog } from './task-page-github-issue-dialog'
import { TaskPageLinearProjectDialog } from './task-page-linear-project-dialog'
import { TaskPageLinearIssueDialog } from './task-page-linear-issue-dialog'
import { JiraConnectDialog } from '@/components/jira-connect-dialog'
import { LinearApiKeyDialog } from '@/components/linear-api-key-dialog'
import GitLabItemDialog from '@/components/GitLabItemDialog'
import { resolveUserRepoSwitchReset } from '@/components/task-page-new-issue-draft'
import { isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import type React from 'react'
import type { TaskPageController } from './use-task-page-controller'

type Props = { controller: TaskPageController }

export function TaskPageDialogsView({ controller }: Props): React.JSX.Element {
  return (
    <>
      <TaskPageGitHubIssueDialog
        context={{
          newIssueOpen: controller.newIssueOpen,
          setNewIssueOpen: controller.setNewIssueOpen,
          newIssueSubmitting: controller.newIssueSubmitting,
          isScreenSubmitShortcut,
          handleCreateNewIssue: controller.handleCreateNewIssue,
          newIssueTargetRepo: controller.newIssueTargetRepo,
          newIssueSourcePreferenceChange: controller.setIssueSourcePreference,
          perRepoSourceState: controller.perRepoSourceState,
          selectedRepos: controller.selectedRepos,
          newIssueRepoId: controller.newIssueRepoId,
          onRepoChange: (repoId) => {
            controller.setNewIssueRepoId(repoId)
            const reset = resolveUserRepoSwitchReset()
            controller.setNewIssueLabels(reset.labels)
            controller.setNewIssueAssignees(reset.assignees)
          },
          newIssueTitle: controller.newIssueTitle,
          setNewIssueTitle: controller.setNewIssueTitle,
          newIssueBody: controller.newIssueBody,
          setNewIssueBody: controller.setNewIssueBody,
          newIssueRepoLabels: controller.newIssueRepoLabels,
          newIssueLabels: controller.newIssueLabels,
          setNewIssueLabels: controller.setNewIssueLabels,
          newIssueRepoAssignees: controller.newIssueRepoAssignees,
          newIssueAssignees: controller.newIssueAssignees,
          setNewIssueAssignees: controller.setNewIssueAssignees,
          submitShortcutLabel: controller.submitShortcutLabel
        }}
      />
      <TaskPageLinearProjectDialog
        context={{
          newLinearProjectOpen: controller.newLinearProjectOpen,
          setNewLinearProjectOpen: controller.setNewLinearProjectOpen,
          newLinearProjectSubmitting: controller.newLinearProjectSubmitting,
          isScreenSubmitShortcut,
          handleCreateNewLinearProject: controller.handleCreateNewLinearProject,
          availableTeams: controller.availableTeams,
          newLinearProjectTargetTeam: controller.newLinearProjectTargetTeam,
          setNewLinearProjectTeamId: controller.setNewLinearProjectTeamId,
          newLinearProjectName: controller.newLinearProjectName,
          setNewLinearProjectName: controller.setNewLinearProjectName,
          newLinearProjectDescription: controller.newLinearProjectDescription,
          setNewLinearProjectDescription: controller.setNewLinearProjectDescription,
          newLinearProjectPriority: controller.newLinearProjectPriority,
          setNewLinearProjectPriority: controller.setNewLinearProjectPriority,
          newLinearProjectMembers: controller.newLinearProjectMembers,
          newLinearProjectLeadId: controller.newLinearProjectLeadId,
          setNewLinearProjectLeadId: controller.setNewLinearProjectLeadId,
          newLinearProjectMemberIds: controller.newLinearProjectMemberIds,
          setNewLinearProjectMemberIds: controller.setNewLinearProjectMemberIds,
          newLinearProjectLabels: controller.newLinearProjectLabels,
          newLinearProjectLabelIds: controller.newLinearProjectLabelIds,
          setNewLinearProjectLabelIds: controller.setNewLinearProjectLabelIds,
          newLinearProjectStartDate: controller.newLinearProjectStartDate,
          setNewLinearProjectStartDate: controller.setNewLinearProjectStartDate,
          newLinearProjectTargetDate: controller.newLinearProjectTargetDate,
          setNewLinearProjectTargetDate: controller.setNewLinearProjectTargetDate,
          newLinearProjectContent: controller.newLinearProjectContent,
          setNewLinearProjectContent: controller.setNewLinearProjectContent,
          submitShortcutLabel: controller.submitShortcutLabel
        }}
      />
      <TaskPageLinearIssueDialog
        context={{
          newLinearIssueOpen: controller.newLinearIssueOpen,
          setNewLinearIssueOpen: controller.setNewLinearIssueOpen,
          newLinearIssueSubmitting: controller.newLinearIssueSubmitting,
          isScreenSubmitShortcut,
          handleCreateNewLinearIssue: controller.handleCreateNewLinearIssue,
          availableTeams: controller.availableTeams,
          newLinearIssueTargetTeam: controller.newLinearIssueTargetTeam,
          newLinearIssueTeamId: controller.newLinearIssueTeamId,
          setNewLinearIssueTeamId: controller.setNewLinearIssueTeamId,
          newLinearIssueTitle: controller.newLinearIssueTitle,
          setNewLinearIssueTitle: controller.setNewLinearIssueTitle,
          newLinearIssueBody: controller.newLinearIssueBody,
          setNewLinearIssueBody: controller.setNewLinearIssueBody,
          newLinearStates: controller.newLinearStates,
          newLinearIssueStateId: controller.newLinearIssueStateId,
          setNewLinearIssueStateId: controller.setNewLinearIssueStateId,
          newLinearMembers: controller.newLinearMembers,
          newLinearIssueAssigneeId: controller.newLinearIssueAssigneeId,
          setNewLinearIssueAssigneeId: controller.setNewLinearIssueAssigneeId,
          newLinearIssuePriority: controller.newLinearIssuePriority,
          setNewLinearIssuePriority: controller.setNewLinearIssuePriority,
          newLinearIssueProjects: controller.newLinearIssueProjects,
          newLinearIssueProjectsLoading: controller.newLinearIssueProjectsLoading,
          newLinearIssueProjectId: controller.newLinearIssueProjectId,
          setNewLinearIssueProjectId: controller.setNewLinearIssueProjectId,
          newLinearLabels: controller.newLinearLabels,
          newLinearIssueLabelIds: controller.newLinearIssueLabelIds,
          setNewLinearIssueLabelIds: controller.setNewLinearIssueLabelIds,
          submitShortcutLabel: controller.submitShortcutLabel
        }}
      />
      <TaskPageJiraIssueDialog
        context={{
          newJiraIssueOpen: controller.newJiraIssueOpen,
          setNewJiraIssueOpen: controller.setNewJiraIssueOpen,
          newJiraIssueSubmitting: controller.newJiraIssueSubmitting,
          isScreenSubmitShortcut,
          handleCreateNewJiraIssue: controller.handleCreateNewJiraIssue,
          newJiraIssueTargetProject: controller.newJiraIssueTargetProject,
          newJiraIssueProjectComboboxOpen: controller.newJiraIssueProjectComboboxOpen,
          handleNewJiraIssueProjectComboboxOpenChange:
            controller.handleNewJiraIssueProjectComboboxOpenChange,
          sortedAvailableJiraProjects: controller.sortedAvailableJiraProjects,
          includeJiraSiteNameInProjectLabel: controller.includeJiraSiteNameInProjectLabel,
          handleNewJiraIssueProjectTriggerKeyDown:
            controller.handleNewJiraIssueProjectTriggerKeyDown,
          newJiraIssueProjectCommandValue: controller.newJiraIssueProjectCommandValue,
          setNewJiraIssueProjectCommandValue: controller.setNewJiraIssueProjectCommandValue,
          newJiraIssueProjectSearchInputRef: controller.newJiraIssueProjectSearchInputRef,
          newJiraIssueProjectQuery: controller.newJiraIssueProjectQuery,
          setNewJiraIssueProjectQuery: controller.setNewJiraIssueProjectQuery,
          filteredNewJiraIssueProjects: controller.filteredNewJiraIssueProjects,
          newJiraIssueTargetProjectSelectionKey: controller.newJiraIssueTargetProjectSelectionKey,
          handleNewJiraIssueProjectSelect: controller.handleNewJiraIssueProjectSelect,
          newJiraIssueTargetType: controller.newJiraIssueTargetType,
          jiraIssueTypesLoading: controller.jiraIssueTypesLoading,
          availableJiraIssueTypes: controller.availableJiraIssueTypes,
          newJiraIssueTypeId: controller.newJiraIssueTypeId,
          setNewJiraIssueTypeId: controller.setNewJiraIssueTypeId,
          newJiraIssueTitle: controller.newJiraIssueTitle,
          setNewJiraIssueTitle: controller.setNewJiraIssueTitle,
          newJiraIssueBody: controller.newJiraIssueBody,
          setNewJiraIssueBody: controller.setNewJiraIssueBody,
          visibleJiraCreateFields: controller.visibleJiraCreateFields,
          newJiraIssueCustomFieldValues: controller.newJiraIssueCustomFieldValues,
          setNewJiraIssueCustomFieldValues: controller.setNewJiraIssueCustomFieldValues,
          submitShortcutLabel: controller.submitShortcutLabel,
          hasMissingJiraCreateField: controller.hasMissingJiraCreateField,
          jiraCreateFieldsLoading: controller.jiraCreateFieldsLoading,
          jiraCreateFieldsError: controller.jiraCreateFieldsError
        }}
      />
      <GitLabItemDialog
        item={controller.gitlabDialogItem}
        // Why: repoPath comes from the clicked item's own repo, not primaryRepo — the GitLab fetch is now multi-repo.
        repoPath={controller.gitlabDialogRepo?.path ?? null}
        repoId={controller.gitlabDialogItem?.repoId ?? null}
        sourceContext={controller.gitlabDialogSourceContext}
        onCreateWorkspace={(item) => {
          controller.setGitlabDialogItem(null)
          controller.handleUseGitLabItem(item)
        }}
        onClose={() => controller.setGitlabDialogItem(null)}
      />
      <LinearApiKeyDialog
        open={controller.linearConnectOpen}
        onOpenChange={controller.setLinearConnectOpen}
        workspace={controller.selectedLinearWorkspace}
        connectLabel={controller.selectedLinearWorkspace ? 'Update access' : 'Add Linear access'}
        onConnected={controller.handleLinearAccessConnected}
      />
      <JiraConnectDialog
        open={controller.jiraConnectOpen}
        onOpenChange={controller.setJiraConnectOpen}
      />
    </>
  )
}
