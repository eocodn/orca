import type { GitLabWorkItem } from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'

export type GitLabDialogRepoSelector = {
  repoPath: string
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
}

export type GitLabJobTraceState = {
  loading: boolean
  trace?: string
  error?: string
}

export type GitLabItemDialogProps = {
  item: GitLabWorkItem | null
  repoPath: string | null
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
  onClose: () => void
  onCreateWorkspace?: (item: GitLabWorkItem) => void
}
