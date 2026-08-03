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
import { planModelDiscovery, discoverCommitMessageModelsLocal, discoverCommitMessageModelsRemote, killProcessTree } from './commit-message-generation-runtime-plan-model-discovery-kill-process-tree'
import { cancelTokensByLane, WSL_LAUNCHER_ENV_KEYS, localLaneKey, cancelGenerateCommitMessageLocal } from './commit-message-generation-runtime-cancel-tokens-by-lane-cancel-generate-commit-message-local'
import { buildWslLauncherEnv, runLocalPlan, finalizeFromAgentOutput, runRemotePlan } from './commit-message-generation-runtime-build-wsl-launcher-env-run-remote-plan'
import { formatCommitMessageGenerationResult, generateCommitMessageFromContext, cancelGeneratePullRequestFieldsLocal, formatPullRequestFieldsGenerationResult } from './commit-message-generation-runtime-format-commit-message-generation-result-format-pull-request-fields-generation-result'
import { type GenerateBranchNameResult, generatePullRequestFieldsFromContext, generateBranchNameFromContext } from './commit-message-generation-runtime-generate-pull-request-fields-from-context-generate-branch-name-from-context'

export function sanitizeAgentFailureDetail(detail: string | null): string | null {
  // Cf covers bidi overrides (U+202E etc.) that could visually reorder the
  // persisted, client-synced detail.
  const trimmed = detail
    ?.replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!trimmed) {
    return null
  }
  // Why: agent stderr often includes local or SSH repo paths. Persisting those
  // into worktree metadata leaks environment details into synced renderer state.
  const redacted = trimmed
    .replace(
      /\\\\[^\s"'`<>\\]+\\(?:[^\s"'`<>\\]+(?:\s+[^\s"'`<>\\]+)*(?=\\)\\)*[^\s"'`<>\\]+/g,
      '[path]'
    )
    // Only backslashes may repeat: JSON provider bodies double them
    // (`C:\\Users\\name\\…`), while a URL's `://` must stay single so remedy
    // links like `https://…` survive redaction.
    .replace(
      /[A-Za-z]:(?:\\+|\/)(?:[^\s"'`<>\\/|:*?]+(?:\s+[^\s"'`<>\\/|:*?]+)*(?=[\\/])(?:\\+|\/))*[^\s"'`<>\\/|:*?]+/g,
      '[path]'
    )
    // Why: require ≥2 segments (one internal `/`) so provider remedy tokens like
    // `/login` survive while multi-segment paths (`/Users/name/repo`) still redact.
    // `=:,` prefixes catch key=/path value:/path list,/path shapes in provider bodies.
    .replace(
      /(^|[\s"'`(=:,])\/(?:[^\s"'`<>/]+(?:\s+[^\s"'`<>/]+)*(?=\/)\/)+[^\s"'`<>/]+/g,
      '$1[path]'
    )
  return redacted.length > 240 ? `${redacted.slice(0, 240).trimEnd()}...` : redacted
}


export function userFacingUnsafeWindowsBatchArgs(label: string): string {
  return `${label} cannot be run as a Windows batch command with the prompt in argv. Remove {prompt} so Orca sends the prompt on stdin.`
}


export function toModelDiscoveryCapability(
  spec: NonNullable<ReturnType<typeof getCommitMessageAgentSpec>>,
  models = spec.models,
  defaultModelId = spec.defaultModelId
): Extract<DiscoverCommitMessageModelsResult, { success: true }> {
  return {
    success: true,
    capability: {
      id: spec.id,
      label: spec.label,
      modelSource: spec.modelSource,
      defaultModelId,
      models
    },
    models,
    defaultModelId
  }
}


export function finalizeModelDiscoveryOutput(
  spec: NonNullable<ReturnType<typeof getCommitMessageAgentSpec>>,
  stdout: string,
  stderr: string,
  code: number | null
): DiscoverCommitMessageModelsResult {
  if (code !== 0) {
    console.error('[commit-message] Model discovery failed:', {
      label: spec.label,
      exitCode: code,
      stdout,
      stderr
    })
    return {
      success: false,
      error: formatAgentCliFailureMessage(spec.label, stdout, stderr, code)
    }
  }
  let models = spec.modelDiscovery?.parse(stdout) ?? []
  if (models.length === 0 && stderr.trim()) {
    // Why: Pi currently writes its successful `--list-models` table to stderr,
    // so exit code 0 must still allow stderr-backed discovery.
    models = spec.modelDiscovery?.parse(stderr) ?? []
  }
  if (models.length === 0) {
    if (spec.models.length > 0) {
      console.warn('[commit-message] Model discovery returned no models; using static fallback:', {
        label: spec.label
      })
      return toModelDiscoveryCapability(spec, spec.models, spec.defaultModelId)
    }
    return { success: false, error: `${spec.label} returned no available models.` }
  }
  const defaultModelId = models.some((model) => model.id === spec.defaultModelId)
    ? spec.defaultModelId
    : models[0].id
  return toModelDiscoveryCapability(spec, models, defaultModelId)
}
