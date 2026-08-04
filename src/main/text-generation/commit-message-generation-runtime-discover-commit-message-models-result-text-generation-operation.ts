import {
  type CommitMessageAgentCapability,
  type CommitMessageModelCapability
} from '../../shared/commit-message-agent-spec'
import {
  type GeneratedPullRequestFields
} from '../../shared/pull-request-generation'


export type DiscoverCommitMessageModelsResult =
  | {
      success: true
      capability: CommitMessageAgentCapability
      models: CommitMessageModelCapability[]
      defaultModelId: string
    }
  | { success: false; error: string }


export type GeneratePullRequestFieldsResult =
  | {
      success: true
      fields: GeneratedPullRequestFields
      agentLabel?: string
      branchChangedByPreparation?: boolean
    }
  | { success: false; error: string; canceled?: boolean; branchChangedByPreparation?: boolean }


export type RemoteCommitMessageExecResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  canceled?: boolean
  spawnError?: string
}


export type TextGenerationOperation = 'commit-message' | 'pull-request-fields' | 'branch-name'
