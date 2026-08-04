import {
  buildCommitMessagePrompt,
  splitGeneratedCommitMessage,
  type CommitMessageDraftContext,
  type GeneratedCommitMessage
} from '../../shared/commit-message-generation'
import {
  planCommitMessageGeneration
} from '../../shared/commit-message-plan'
import {
  parseGeneratedPullRequestFields,
  type PullRequestDraftContext
} from '../../shared/pull-request-generation'
import { formatLinkedIssueTemplateValue } from '../../shared/source-control-ai-action-variables'
import { renderSourceControlActionCommandTemplate } from '../../shared/source-control-ai-actions'

import { runLocalPlan,runRemotePlan } from './commit-message-generation-runtime-build-wsl-launcher-env-run-remote-plan'
import { cancelTokensByLane,localLaneKey } from './commit-message-generation-runtime-cancel-tokens-by-lane-cancel-generate-commit-message-local'
import type { CommitMessageGenerationTarget,InternalTextGenerationResult } from './commit-message-generation-runtime-commit-message-generation-target-commit-message-model-discovery-local-options'
import type { GeneratePullRequestFieldsResult } from './commit-message-generation-runtime-discover-commit-message-models-result-text-generation-operation'
import { type GenerateCommitMessageParams,type GenerateCommitMessageResult } from './commit-message-generation-runtime-generation-timeout-ms-generate-commit-message-result'
import { trimGeneratedCommitMessage } from './commit-message-generation-runtime-trim-generated-commit-message-format-agent-cli-failure-message'

export function formatCommitMessageGenerationResult(
  result: InternalTextGenerationResult
): GenerateCommitMessageResult {
  if (!result.success) {
    // Keep the bulky local-only capture off the renderer-bound payload.
    return { success: false, error: result.error, canceled: result.canceled }
  }
  let commitMessage: GeneratedCommitMessage
  try {
    commitMessage = splitGeneratedCommitMessage(result.rawOutput)
  } catch {
    return { success: false, error: 'Generated commit message could not be parsed.' }
  }
  return {
    success: true,
    message: trimGeneratedCommitMessage(commitMessage.message),
    agentLabel: result.agentLabel
  }
}


export async function generateCommitMessageFromContext(
  context: CommitMessageDraftContext,
  params: GenerateCommitMessageParams,
  target: CommitMessageGenerationTarget
): Promise<GenerateCommitMessageResult> {
  const basePrompt = buildCommitMessagePrompt(context, '')
  const prompt =
    params.commandInputTemplate !== undefined
      ? renderSourceControlActionCommandTemplate(params.commandInputTemplate, {
          basePrompt,
          branch: context.branch ?? '(detached)',
          stagedFiles: context.stagedSummary,
          stagedPatch: context.stagedPatch,
          // Why: always pass the key so `{linkedIssue}` never survives as a literal token.
          linkedIssue: formatLinkedIssueTemplateValue(context.linkedIssue)
        })
      : buildCommitMessagePrompt(context, params.customPrompt ?? '')
  const planned = planCommitMessageGeneration(params, prompt)
  if (!planned.ok) {
    return { success: false, error: planned.error }
  }

  const internalResult =
    target.kind === 'remote'
      ? await runRemotePlan(planned.plan, target)
      : await runLocalPlan(
          planned.plan,
          target.cwd,
          target.env,
          'message',
          'commit-message',
          target.wslDistro
        )
  return formatCommitMessageGenerationResult(internalResult)
}


export function cancelGeneratePullRequestFieldsLocal(cwd: string): void {
  cancelTokensByLane.get(localLaneKey('pull-request-fields', cwd))?.()
}


export function formatPullRequestFieldsGenerationResult(
  result: InternalTextGenerationResult,
  context: PullRequestDraftContext
): GeneratePullRequestFieldsResult {
  if (!result.success) {
    // Keep the bulky local-only capture off the renderer-bound payload.
    return {
      success: false,
      error: result.error,
      canceled: result.canceled,
      branchChangedByPreparation: context.branchChangedByPreparation
    }
  }
  try {
    return {
      success: true,
      fields: parseGeneratedPullRequestFields(result.rawOutput, context),
      agentLabel: result.agentLabel,
      branchChangedByPreparation: context.branchChangedByPreparation
    }
  } catch {
    return {
      success: false,
      error: 'Generated pull request details could not be parsed.',
      branchChangedByPreparation: context.branchChangedByPreparation
    }
  }
}
