import { exec, spawn, type ChildProcess } from 'node:child_process'
import type { GlobalSettings, Repo, TuiAgent } from '../../shared/types'
import {
  buildCommitMessagePrompt,
  splitGeneratedCommitMessage,
  type CommitMessageDraftContext,
  type GeneratedCommitMessage
} from '../../shared/commit-message-generation'
import {
  buildPullRequestFieldsPrompt,
  parseGeneratedPullRequestFields,
  type GeneratedPullRequestFields,
  type PullRequestDraftContext
} from '../../shared/pull-request-generation'
import {
  cleanGeneratedCommitMessage,
  excerptAgentFailureOutput
} from '../../shared/commit-message-prompt'
import {
  captureAgentGenerationFailureOutput,
  type AgentGenerationFailureOutput
} from './agent-failure-output'
import {
  buildBranchNamePrompt,
  sanitizeBranchSlug,
  type BranchNameWorkContext
} from '../../shared/branch-name-from-work'
import {
  getCommitMessageAgentSpec,
  type CommitMessageAgentCapability,
  type CommitMessageModelCapability
} from '../../shared/commit-message-agent-spec'
import {
  planAgentBinary,
  planCommitMessageGeneration,
  type CommitMessagePlan
} from '../../shared/commit-message-plan'
import { LOCAL_COMMIT_MESSAGE_HOST_KEY } from '../../shared/commit-message-host-key'
import {
  resolveSourceControlAiForOperation,
  type ResolvedSourceControlAiGenerationParams
} from '../../shared/source-control-ai'
import type { SourceControlAiOperation } from '../../shared/source-control-ai-types'
import { formatLinkedIssueTemplateValue } from '../../shared/source-control-ai-action-variables'
import { renderSourceControlActionCommandTemplate } from '../../shared/source-control-ai-actions'
import { resolveCliCommand } from '../codex-cli/command'
import {
  getSpawnArgsForWindows,
  UnsafeWindowsBatchArgumentsError,
  WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR
} from '../win32-utils'
import { withMacTailscaleDnsHint } from '../network/macos-tailscale-dns-diagnostic'
import { wslAwareSpawn } from '../git/runner'

import { type GenerateCommitMessageParams, type GenerateCommitMessageResult, GENERATION_TIMEOUT_MS, MAX_AGENT_OUTPUT_BYTES } from './commit-message-generation-runtime-generation-timeout-ms-generate-commit-message-result'
import { type DiscoverCommitMessageModelsResult, type GeneratePullRequestFieldsResult, type RemoteCommitMessageExecResult, type TextGenerationOperation } from './commit-message-generation-runtime-discover-commit-message-models-result-text-generation-operation'
import { type CommitMessageGenerationTarget, type ResolveCommitMessageSettingsResult, type InternalTextGenerationResult, type CommitMessageModelDiscoveryLocalOptions } from './commit-message-generation-runtime-commit-message-generation-target-commit-message-model-discovery-local-options'
import { trimGeneratedCommitMessage, resolveCommitMessageSettings, resolveTextGenerationParams, formatAgentCliFailureMessage } from './commit-message-generation-runtime-trim-generated-commit-message-format-agent-cli-failure-message'
import { sanitizeAgentFailureDetail, userFacingUnsafeWindowsBatchArgs, toModelDiscoveryCapability, finalizeModelDiscoveryOutput } from './commit-message-generation-runtime-sanitize-agent-failure-detail-finalize-model-discovery-output'
import { planModelDiscovery, discoverCommitMessageModelsLocal, discoverCommitMessageModelsRemote, killProcessTree } from './commit-message-generation-runtime-plan-model-discovery-kill-process-tree'
import { cancelTokensByLane, WSL_LAUNCHER_ENV_KEYS, localLaneKey, cancelGenerateCommitMessageLocal } from './commit-message-generation-runtime-cancel-tokens-by-lane-cancel-generate-commit-message-local'
import { buildWslLauncherEnv, runLocalPlan, finalizeFromAgentOutput, runRemotePlan } from './commit-message-generation-runtime-build-wsl-launcher-env-run-remote-plan'
import { formatCommitMessageGenerationResult, generateCommitMessageFromContext, cancelGeneratePullRequestFieldsLocal, formatPullRequestFieldsGenerationResult } from './commit-message-generation-runtime-format-commit-message-generation-result-format-pull-request-fields-generation-result'

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
