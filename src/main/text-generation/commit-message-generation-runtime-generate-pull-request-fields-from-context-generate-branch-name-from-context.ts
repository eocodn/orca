import {
  buildBranchNamePrompt,
  sanitizeBranchSlug,
  type BranchNameWorkContext
} from '../../shared/branch-name-from-work'
import {
  planCommitMessageGeneration
} from '../../shared/commit-message-plan'
import {
  buildPullRequestFieldsPrompt,
  type PullRequestDraftContext
} from '../../shared/pull-request-generation'
import { formatLinkedIssueTemplateValue } from '../../shared/source-control-ai-action-variables'
import { renderSourceControlActionCommandTemplate } from '../../shared/source-control-ai-actions'
import {
  captureAgentGenerationFailureOutput,
  type AgentGenerationFailureOutput
} from './agent-failure-output'

import { runLocalPlan,runRemotePlan } from './commit-message-generation-runtime-build-wsl-launcher-env-run-remote-plan'
import type { CommitMessageGenerationTarget } from './commit-message-generation-runtime-commit-message-generation-target-commit-message-model-discovery-local-options'
import type { GeneratePullRequestFieldsResult } from './commit-message-generation-runtime-discover-commit-message-models-result-text-generation-operation'
import { formatPullRequestFieldsGenerationResult } from './commit-message-generation-runtime-format-commit-message-generation-result-format-pull-request-fields-generation-result'
import { type GenerateCommitMessageParams } from './commit-message-generation-runtime-generation-timeout-ms-generate-commit-message-result'

export async function generatePullRequestFieldsFromContext(
  context: PullRequestDraftContext,
  params: GenerateCommitMessageParams,
  target: CommitMessageGenerationTarget
): Promise<GeneratePullRequestFieldsResult> {
  const basePrompt = buildPullRequestFieldsPrompt(context, '')
  const prompt =
    params.commandInputTemplate !== undefined
      ? renderSourceControlActionCommandTemplate(params.commandInputTemplate, {
          basePrompt,
          branch: context.branch ?? '(detached)',
          baseBranch: context.base,
          currentTitle: context.currentTitle,
          currentBody: context.currentBody,
          commitSummary: context.commitSummary,
          changedFiles: context.changeSummary,
          patch: context.patch,
          // Why: always pass the key so `{linkedIssue}` never survives as a literal token.
          linkedIssue: formatLinkedIssueTemplateValue(context.linkedIssue)
        })
      : buildPullRequestFieldsPrompt(context, params.customPrompt ?? '')
  const planned = planCommitMessageGeneration(params, prompt)
  if (!planned.ok) {
    return {
      success: false,
      error: planned.error,
      branchChangedByPreparation: context.branchChangedByPreparation
    }
  }

  const internalResult =
    target.kind === 'remote'
      ? await runRemotePlan(planned.plan, target, 'details', 'pull-request-fields')
      : await runLocalPlan(
          planned.plan,
          target.cwd,
          target.env,
          'details',
          'pull-request-fields',
          target.wslDistro
        )
  return formatPullRequestFieldsGenerationResult(internalResult, context)
}


export type GenerateBranchNameResult =
  | { success: true; slug: string; agentLabel?: string }
  | {
      success: false
      error: string
      canceled?: boolean
      failureOutput?: AgentGenerationFailureOutput
    }

/**
 * Generate a short kebab-case branch name from the work the agent is starting.
 * Reuses the commit-message generation plan + spawn machinery; only the prompt
 * and the post-processing (slug sanitization) differ.
 */

export async function generateBranchNameFromContext(
  context: BranchNameWorkContext,
  params: GenerateCommitMessageParams,
  target: CommitMessageGenerationTarget
): Promise<GenerateBranchNameResult> {
  const basePrompt = buildBranchNamePrompt(context)
  const prompt =
    params.commandInputTemplate !== undefined
      ? renderSourceControlActionCommandTemplate(params.commandInputTemplate, {
          basePrompt,
          firstPrompt: context.firstPrompt,
          assistantMessage: context.assistantMessage ?? ''
        })
      : buildBranchNamePrompt(context, params.customPrompt ?? '')
  const planned = planCommitMessageGeneration(params, prompt)
  if (!planned.ok) {
    return { success: false, error: planned.error }
  }

  const internalResult =
    target.kind === 'remote'
      ? await runRemotePlan(planned.plan, target, 'branch name', 'branch-name')
      : await runLocalPlan(
          planned.plan,
          target.cwd,
          target.env,
          'branch name',
          'branch-name',
          target.wslDistro
        )
  if (!internalResult.success) {
    return internalResult
  }
  const slug = sanitizeBranchSlug(internalResult.rawOutput)
  if (!slug) {
    return {
      success: false,
      error: 'Generated branch name was empty after sanitization.',
      // What the model actually returned is the whole diagnosis here.
      failureOutput:
        captureAgentGenerationFailureOutput(planned.plan.label, 0, internalResult.rawOutput, '') ??
        undefined
    }
  }
  return { success: true, slug, agentLabel: internalResult.agentLabel }
}
