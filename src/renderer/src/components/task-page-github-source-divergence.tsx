import IssueSourceIndicator, { sameGitHubOwnerRepo } from '@/components/github/IssueSourceIndicator'
import IssueSourceSelector, { issueSourceChipClass } from '@/components/github/IssueSourceSelector'
import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'
import type { TaskPageRepoSourceState } from '@/components/task-page-cache-selectors'
import type { GitHubOwnerRepo } from '../../../shared/types-linear-mutations'
import type { IssueSourcePreference, Repo } from '../../../shared/types-repository'

type TaskPageGitHubSourceDivergenceProps = {
  selectedRepos: readonly Pick<
    Repo,
    'id' | 'path' | 'displayName' | 'badgeColor' | 'issueSourcePreference'
  >[]
  perRepoSourceState: readonly TaskPageRepoSourceState[]
  onIssueSourcePreferenceChange: (
    repoId: string,
    repoPath: string,
    preference: IssueSourcePreference
  ) => void | Promise<void>
}

const hasDivergentSources = (
  state: TaskPageRepoSourceState
): state is TaskPageRepoSourceState & {
  sources: { issues: GitHubOwnerRepo; prs: GitHubOwnerRepo }
} =>
  !!state.sources?.issues &&
  !!state.sources.prs &&
  !sameGitHubOwnerRepo(state.sources.issues, state.sources.prs)

// Why: retain the selector after an upstream choice by checking raw candidates, not effective sources.
const hasUpstreamCandidateDivergence = (
  state: TaskPageRepoSourceState
): state is TaskPageRepoSourceState & {
  sources: { originCandidate: GitHubOwnerRepo; upstreamCandidate: GitHubOwnerRepo }
} =>
  !!state.sources?.originCandidate &&
  !!state.sources.upstreamCandidate &&
  !sameGitHubOwnerRepo(state.sources.originCandidate, state.sources.upstreamCandidate)

export function TaskPageGitHubSourceDivergence({
  selectedRepos,
  perRepoSourceState,
  onIssueSourcePreferenceChange
}: TaskPageGitHubSourceDivergenceProps): React.JSX.Element | null {
  const rows = perRepoSourceState.filter(
    (state) => hasUpstreamCandidateDivergence(state) || hasDivergentSources(state)
  )
  if (rows.length === 0) {
    return null
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {rows.map((state) => {
        const repo = selectedRepos.find((candidate) => candidate.id === state.repoId)
        const showRepoBadgeLabel = selectedRepos.length > 1 && repo
        const selectorRenderable = hasUpstreamCandidateDivergence(state)
        if (!selectorRenderable && hasDivergentSources(state)) {
          return (
            <IssueSourceIndicator
              key={state.repoId}
              issues={state.sources.issues}
              prs={state.sources.prs}
              localRepo={
                showRepoBadgeLabel && repo
                  ? { displayName: repo.displayName, color: repo.badgeColor }
                  : undefined
              }
            />
          )
        }
        if (!selectorRenderable || !repo) {
          return null
        }
        return (
          <div key={state.repoId} className={issueSourceChipClass}>
            {showRepoBadgeLabel ? (
              <RepoBadgeLabel
                name={repo.displayName}
                color={repo.badgeColor}
                badgeClassName="size-1.5"
                className="text-[10px] text-muted-foreground"
              />
            ) : null}
            <IssueSourceSelector
              preference={repo.issueSourcePreference}
              origin={state.sources.originCandidate}
              upstream={state.sources.upstreamCandidate}
              onChange={(next) => {
                void onIssueSourcePreferenceChange(repo.id, repo.path, next)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
