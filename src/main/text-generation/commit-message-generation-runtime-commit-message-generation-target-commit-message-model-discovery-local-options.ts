import type { AgentGenerationFailureOutput } from './agent-failure-output'
import type { CommitMessagePlan } from '../../shared/commit-message-plan'
import type { GenerateCommitMessageParams } from './commit-message-generation-runtime-generation-timeout-ms-generate-commit-message-result'
import type {
  RemoteCommitMessageExecResult,
  TextGenerationOperation
} from './commit-message-generation-runtime-discover-commit-message-models-result-text-generation-operation'

export type CommitMessageGenerationTarget =
  | { kind: 'local'; cwd: string; env?: NodeJS.ProcessEnv; wslDistro?: string }
  | {
      kind: 'remote'
      cwd: string
      execute: (
        plan: CommitMessagePlan,
        cwd: string,
        timeoutMs: number,
        operation: TextGenerationOperation
      ) => Promise<RemoteCommitMessageExecResult>
      missingBinaryLocation: string
    }


export type ResolveCommitMessageSettingsResult =
  | { ok: true; params: GenerateCommitMessageParams }
  | { ok: false; error: string }


export type InternalTextGenerationResult =
  | { success: true; rawOutput: string; agentLabel?: string }
  | {
      success: false
      error: string
      canceled?: boolean
      /** Bounded full CLI output for on-demand local display. Stripped from
       *  every renderer-bound result so it never crosses IPC wholesale. */
      failureOutput?: AgentGenerationFailureOutput
    }


export type CommitMessageModelDiscoveryLocalOptions = {
  cwd?: string
  wslDistro?: string
}
