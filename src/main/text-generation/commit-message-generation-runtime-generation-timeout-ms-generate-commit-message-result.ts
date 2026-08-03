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

import { type DiscoverCommitMessageModelsResult, type GeneratePullRequestFieldsResult, type RemoteCommitMessageExecResult, type TextGenerationOperation } from './commit-message-generation-runtime-discover-commit-message-models-result-text-generation-operation'
import { type CommitMessageGenerationTarget, type ResolveCommitMessageSettingsResult, type InternalTextGenerationResult, type CommitMessageModelDiscoveryLocalOptions } from './commit-message-generation-runtime-commit-message-generation-target-commit-message-model-discovery-local-options'
import { trimGeneratedCommitMessage, resolveCommitMessageSettings, resolveTextGenerationParams, formatAgentCliFailureMessage } from './commit-message-generation-runtime-trim-generated-commit-message-format-agent-cli-failure-message'
import { sanitizeAgentFailureDetail, userFacingUnsafeWindowsBatchArgs, toModelDiscoveryCapability, finalizeModelDiscoveryOutput } from './commit-message-generation-runtime-sanitize-agent-failure-detail-finalize-model-discovery-output'
import { planModelDiscovery, discoverCommitMessageModelsLocal, discoverCommitMessageModelsRemote, killProcessTree } from './commit-message-generation-runtime-plan-model-discovery-kill-process-tree'
import { cancelTokensByLane, WSL_LAUNCHER_ENV_KEYS, localLaneKey, cancelGenerateCommitMessageLocal } from './commit-message-generation-runtime-cancel-tokens-by-lane-cancel-generate-commit-message-local'
import { buildWslLauncherEnv, runLocalPlan, finalizeFromAgentOutput, runRemotePlan } from './commit-message-generation-runtime-build-wsl-launcher-env-run-remote-plan'
import { formatCommitMessageGenerationResult, generateCommitMessageFromContext, cancelGeneratePullRequestFieldsLocal, formatPullRequestFieldsGenerationResult } from './commit-message-generation-runtime-format-commit-message-generation-result-format-pull-request-fields-generation-result'
import { type GenerateBranchNameResult, generatePullRequestFieldsFromContext, generateBranchNameFromContext } from './commit-message-generation-runtime-generate-pull-request-fields-from-context-generate-branch-name-from-context'

export const GENERATION_TIMEOUT_MS = 60_000

export const MAX_AGENT_OUTPUT_BYTES = 4 * 1024 * 1024


export type GenerateCommitMessageParams = ResolvedSourceControlAiGenerationParams


export type GenerateCommitMessageResult =
  | { success: true; message: string; agentLabel?: string }
  | { success: false; error: string; canceled?: boolean }
