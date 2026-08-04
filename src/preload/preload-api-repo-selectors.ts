import type { TaskSourceContext } from '../shared/task-source-context'

export type GitLabRepoSelectorArgs = {
  repoPath: string
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
}

export type GitHubRepoSelectorArgs = GitLabRepoSelectorArgs