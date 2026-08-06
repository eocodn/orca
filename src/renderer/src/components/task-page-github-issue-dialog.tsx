import type React from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'
import IssueSourceSelector from '@/components/github/IssueSourceSelector'
import { sameGitHubOwnerRepo } from '@/components/github/IssueSourceIndicator'
import { GitHubMarkdownComposer } from '@/components/github/GitHubMarkdownComposer'
import {
  GitHubIssueAssigneeSelector,
  GitHubIssueLabelSelector
} from './task-page-github-issue-selectors'
import type { MetadataState } from '@/hooks/issue-metadata-state'
import type { IssueSourcePreference, GitHubAssignableUser, Repo } from '../../../shared/types'
import type { TaskPageRepoSourceState } from '@/components/task-page-cache-selectors'
import { translate } from '@/i18n/i18n'

type Setter<T> = React.Dispatch<React.SetStateAction<T>>

export type TaskPageGitHubIssueDialogContext = {
  newIssueOpen: boolean
  setNewIssueOpen: Setter<boolean>
  newIssueSubmitting: boolean
  isScreenSubmitShortcut: (event: React.KeyboardEvent) => boolean
  handleCreateNewIssue: () => Promise<void>
  newIssueTargetRepo: Repo | null
  newIssueSourcePreferenceChange: (
    repoId: string,
    repoPath: string,
    preference: IssueSourcePreference
  ) => Promise<void>
  perRepoSourceState: TaskPageRepoSourceState[]
  selectedRepos: Repo[]
  newIssueRepoId: string | null
  onRepoChange: (repoId: string) => void
  newIssueTitle: string
  setNewIssueTitle: Setter<string>
  newIssueBody: string
  setNewIssueBody: Setter<string>
  newIssueRepoLabels: MetadataState<string[]>
  newIssueLabels: string[]
  setNewIssueLabels: Setter<string[]>
  newIssueRepoAssignees: MetadataState<GitHubAssignableUser[]>
  newIssueAssignees: GitHubAssignableUser[]
  setNewIssueAssignees: Setter<GitHubAssignableUser[]>
  submitShortcutLabel: string
}

export function TaskPageGitHubIssueDialog({
  context
}: {
  context: TaskPageGitHubIssueDialogContext
}): React.JSX.Element {
  const {
    newIssueOpen,
    setNewIssueOpen,
    newIssueSubmitting,
    isScreenSubmitShortcut,
    handleCreateNewIssue,
    newIssueTargetRepo,
    newIssueSourcePreferenceChange,
    perRepoSourceState,
    selectedRepos,
    newIssueRepoId,
    onRepoChange,
    newIssueTitle,
    setNewIssueTitle,
    newIssueBody,
    setNewIssueBody,
    newIssueRepoLabels,
    newIssueLabels,
    setNewIssueLabels,
    newIssueRepoAssignees,
    newIssueAssignees,
    setNewIssueAssignees,
    submitShortcutLabel
  } = context

  const sourceEntry = newIssueTargetRepo
    ? perRepoSourceState.find((entry) => entry.repoId === newIssueTargetRepo.id)
    : undefined
  const issuesSlug = sourceEntry?.sources?.issues
    ? `${sourceEntry.sources.issues.owner}/${sourceEntry.sources.issues.repo}`
    : null
  const fallback = newIssueTargetRepo?.displayName ?? 'this repository'
  const canChooseIssueSource = Boolean(
    newIssueTargetRepo &&
    sourceEntry?.sources?.upstreamCandidate &&
    sourceEntry.sources.originCandidate &&
    !sameGitHubOwnerRepo(sourceEntry.sources.originCandidate, sourceEntry.sources.upstreamCandidate)
  )

  return (
    <Dialog
      open={newIssueOpen}
      onOpenChange={(open) => {
        if (!newIssueSubmitting) {
          setNewIssueOpen(open)
        }
      }}
    >
      <DialogContent
        className="sm:max-w-2xl"
        onKeyDown={(event) => {
          if (isScreenSubmitShortcut(event)) {
            event.preventDefault()
            void handleCreateNewIssue()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.TaskPage.d3d0998b7d', 'New GitHub issue')}
          </DialogTitle>
          <DialogDescription>
            {translate('auto.components.TaskPage.9f2b4c03a6', 'Filing in')}
            {issuesSlug ?? fallback}
          </DialogDescription>
          {canChooseIssueSource && newIssueTargetRepo && sourceEntry ? (
            <div className="mt-1">
              <IssueSourceSelector
                preference={newIssueTargetRepo.issueSourcePreference}
                origin={sourceEntry.sources.originCandidate}
                upstream={sourceEntry.sources.upstreamCandidate}
                disabled={newIssueSubmitting}
                suppressTooltip
                onChange={(next) => {
                  void newIssueSourcePreferenceChange(
                    newIssueTargetRepo.id,
                    newIssueTargetRepo.path,
                    next
                  )
                }}
              />
            </div>
          ) : null}
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {selectedRepos.length > 1 ? (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                {translate('auto.components.TaskPage.00022ec0ba', 'Project')}
              </label>
              <Select
                value={newIssueRepoId ?? undefined}
                onValueChange={onRepoChange}
                disabled={newIssueSubmitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedRepos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id}>
                      <RepoBadgeLabel name={repo.displayName} color={repo.badgeColor} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              {translate('auto.components.TaskPage.16cba35bee', 'Title')}
            </label>
            <Input
              autoFocus
              value={newIssueTitle}
              onChange={(event) => setNewIssueTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void handleCreateNewIssue()
                }
              }}
              placeholder={translate('auto.components.TaskPage.578f730c16', 'Short summary')}
              disabled={newIssueSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              {translate('auto.components.TaskPage.7f3f7b4c18', 'Description (optional, markdown)')}
            </label>
            <GitHubMarkdownComposer
              value={newIssueBody}
              onChange={setNewIssueBody}
              placeholder={translate('auto.components.TaskPage.34d97ca682', "What's going on?")}
              disabled={newIssueSubmitting}
              minHeightClassName="min-h-40"
              onSubmitShortcut={() => void handleCreateNewIssue()}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <GitHubIssueLabelSelector
              labels={newIssueRepoLabels.data}
              selectedLabels={newIssueLabels}
              loading={newIssueRepoLabels.loading}
              error={newIssueRepoLabels.error}
              disabled={newIssueSubmitting || !newIssueTargetRepo}
              onChange={setNewIssueLabels}
            />
            <GitHubIssueAssigneeSelector
              assignees={newIssueRepoAssignees.data}
              selectedAssignees={newIssueAssignees}
              loading={newIssueRepoAssignees.loading}
              error={newIssueRepoAssignees.error}
              disabled={newIssueSubmitting || !newIssueTargetRepo}
              onChange={setNewIssueAssignees}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {submitShortcutLabel} {translate('auto.components.TaskPage.fc0d8a1fa4', 'to submit.')}
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setNewIssueOpen(false)}
            disabled={newIssueSubmitting}
          >
            {translate('auto.components.TaskPage.ff69a30681', 'Cancel')}
          </Button>
          <Button
            onClick={() => void handleCreateNewIssue()}
            disabled={!newIssueTargetRepo || !newIssueTitle.trim() || newIssueSubmitting}
          >
            {newIssueSubmitting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                {translate('auto.components.TaskPage.8ff6fdc368', 'Creating…')}
              </>
            ) : (
              translate('auto.components.TaskPage.e15ba2d2eb', 'Create issue')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
