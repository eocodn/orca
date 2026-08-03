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
import { formatCommitMessageGenerationResult, generateCommitMessageFromContext, cancelGeneratePullRequestFieldsLocal, formatPullRequestFieldsGenerationResult } from './commit-message-generation-runtime-format-commit-message-generation-result-format-pull-request-fields-generation-result'
import { type GenerateBranchNameResult, generatePullRequestFieldsFromContext, generateBranchNameFromContext } from './commit-message-generation-runtime-generate-pull-request-fields-from-context-generate-branch-name-from-context'

export function buildWslLauncherEnv(explicitEnv: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of WSL_LAUNCHER_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  for (const [key, value] of Object.entries(explicitEnv ?? {})) {
    if (value !== undefined && value !== process.env[key]) {
      env[key] = value
    }
  }
  return env
}


export async function runLocalPlan(
  plan: CommitMessagePlan,
  cwd: string,
  env: NodeJS.ProcessEnv | undefined,
  emptyResultName = 'message',
  operation: TextGenerationOperation = 'commit-message',
  wslDistro?: string
): Promise<InternalTextGenerationResult> {
  const { binary, args, stdinPayload, label } = plan
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      const spawnEnv = env ?? process.env
      if (process.platform === 'win32' && wslDistro) {
        child = wslAwareSpawn(binary, args, {
          cwd,
          env: buildWslLauncherEnv(env),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          wslDistro,
          useWslLoginShell: true
        })
      } else {
        const resolvedBinary =
          process.platform === 'win32'
            ? resolveCliCommand(binary, { pathEnv: spawnEnv.PATH ?? spawnEnv.Path ?? null })
            : binary
        const { spawnCmd, spawnArgs } = getSpawnArgsForWindows(resolvedBinary, args)
        child = spawn(spawnCmd, spawnArgs, {
          cwd,
          env: spawnEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        })
      }
    } catch (error) {
      if (error instanceof UnsafeWindowsBatchArgumentsError) {
        resolve({
          success: false,
          error: userFacingUnsafeWindowsBatchArgs(label)
        })
        return
      }
      console.error('[commit-message] Failed to spawn local generator:', error)
      resolve({
        success: false,
        error: `${label} could not be started. Check the agent command in Settings and try again.`
      })
      return
    }

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let outputLimitExceeded = false
    let settled = false
    let canceledByUser = false
    const laneKey = localLaneKey(operation, cwd)
    let cancelToken: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let detachChildListeners = (): void => {}
    const finalize = (result: InternalTextGenerationResult): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      detachChildListeners()
      if (cancelToken && cancelTokensByLane.get(laneKey) === cancelToken) {
        cancelTokensByLane.delete(laneKey)
      }
      resolve(result)
    }

    cancelToken = () => {
      canceledByUser = true
      killProcessTree(child)
      // Why: cancellation is a user-visible UI command; do not wait for a
      // wedged agent CLI to emit `close` before the request leaves loading.
      finalize({ success: false, error: 'Generation canceled.', canceled: true })
    }
    cancelTokensByLane.set(laneKey, cancelToken)

    timer = setTimeout(() => {
      killProcessTree(child)
      finalize({
        success: false,
        error: `Generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s.`
      })
    }, GENERATION_TIMEOUT_MS)

    const onStdoutData = (chunk: Buffer): void => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > MAX_AGENT_OUTPUT_BYTES) {
        outputLimitExceeded = true
        killProcessTree(child)
        return
      }
      stdout += chunk.toString('utf-8')
    }
    const onStderrData = (chunk: Buffer): void => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > MAX_AGENT_OUTPUT_BYTES) {
        outputLimitExceeded = true
        killProcessTree(child)
        return
      }
      stderr += chunk.toString('utf-8')
    }
    const onError = (error: Error): void => {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        finalize({
          success: false,
          error: `${binary} not found on PATH. Install ${label} to use AI commit messages.`
        })
        return
      }
      console.error('[commit-message] Local generator failed after spawn:', error)
      finalize({
        success: false,
        error: `${label} failed to start. Check the agent command in Settings and try again.`
      })
    }
    const onClose = (code: number | null): void => {
      if (canceledByUser) {
        finalize({ success: false, error: 'Generation canceled.', canceled: true })
        return
      }
      if (outputLimitExceeded) {
        finalize({
          success: false,
          error: `${label} CLI command produced too much output. Check the agent CLI configuration and try again.`
        })
        return
      }
      finalizeFromAgentOutput({
        code,
        stdout,
        stderr,
        label,
        emptyResultName,
        finalize,
        includeStdoutDetail: operation !== 'branch-name'
      })
    }
    child.stdout?.on('data', onStdoutData)
    child.stderr?.on('data', onStderrData)
    child.on('error', onError)
    child.on('close', onClose)
    detachChildListeners = () => {
      child.stdout?.off?.('data', onStdoutData)
      child.stderr?.off?.('data', onStderrData)
      child.off?.('error', onError)
      child.off?.('close', onClose)
    }

    child.stdin?.end(stdinPayload ?? undefined)
  })
}


export function finalizeFromAgentOutput(args: {
  code: number | null
  stdout: string
  stderr: string
  label: string
  emptyResultName: string
  finalize: (result: InternalTextGenerationResult) => void
  includeLocalMacDnsHint?: boolean
  includeStdoutDetail?: boolean
}): void {
  const {
    code,
    stdout,
    stderr,
    label,
    emptyResultName,
    finalize,
    includeLocalMacDnsHint,
    includeStdoutDetail
  } = args
  if (code !== 0) {
    console.error('[commit-message] Generator failed:', {
      label,
      exitCode: code,
      stdout,
      stderr
    })
    finalize({
      success: false,
      error: formatAgentCliFailureMessage(label, stdout, stderr, code, {
        includeLocalMacDnsHint,
        includeStdoutDetail
      }),
      failureOutput: captureAgentGenerationFailureOutput(label, code, stdout, stderr) ?? undefined
    })
    return
  }
  const cleaned = cleanGeneratedCommitMessage(stdout)
  if (!cleaned) {
    // stdout is the (empty) result here, not diagnostics, so only stderr is
    // excerpted. The run exited 0, so this stays "returned an empty result"
    // rather than misreporting a command failure.
    const detail = sanitizeAgentFailureDetail(excerptAgentFailureOutput('', stderr))
    if (detail) {
      console.error('[commit-message] Generator returned no stdout but wrote to stderr:', {
        label,
        exitCode: code,
        stdout,
        stderr
      })
    }
    finalize({
      success: false,
      error: detail
        ? `${label} returned an empty ${emptyResultName}. CLI output: ${detail}`
        : `${label} returned an empty ${emptyResultName}.`,
      failureOutput: captureAgentGenerationFailureOutput(label, code, stdout, stderr) ?? undefined
    })
    return
  }
  finalize({
    success: true,
    rawOutput: cleaned,
    agentLabel: label
  })
}


export async function runRemotePlan(
  plan: CommitMessagePlan,
  target: Extract<CommitMessageGenerationTarget, { kind: 'remote' }>,
  emptyResultName = 'message',
  operation: TextGenerationOperation = 'commit-message'
): Promise<InternalTextGenerationResult> {
  const { binary, label } = plan
  let result: RemoteCommitMessageExecResult
  try {
    result = await target.execute(plan, target.cwd, GENERATION_TIMEOUT_MS, operation)
  } catch (error) {
    console.error('[commit-message] Remote generator request failed:', error)
    return {
      success: false,
      error: `${label} could not be reached on the ${target.missingBinaryLocation}. Try again after the SSH connection recovers.`
    }
  }
  if (result.spawnError) {
    if (result.spawnError === WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR) {
      return {
        success: false,
        error: userFacingUnsafeWindowsBatchArgs(label)
      }
    }
    if (/ENOENT/i.test(result.spawnError)) {
      return {
        success: false,
        error: `${binary} not found on the ${target.missingBinaryLocation}. Install ${label} there.`
      }
    }
    console.error('[commit-message] Remote generator spawn failed:', result.spawnError)
    return {
      success: false,
      error: `${label} could not be started on the ${target.missingBinaryLocation}. Check the agent command there and try again.`
    }
  }
  if (result.canceled) {
    return { success: false, error: 'Generation canceled.', canceled: true }
  }
  if (result.timedOut) {
    return {
      success: false,
      error: `Generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s.`
    }
  }

  return new Promise((resolve) => {
    finalizeFromAgentOutput({
      code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      label,
      emptyResultName,
      finalize: resolve,
      // Why: remote agent output reflects the SSH target, not this Mac's DNS.
      includeLocalMacDnsHint: false,
      // Branch failures persist into synced metadata; stdout may echo the prompt.
      includeStdoutDetail: operation !== 'branch-name'
    })
  })
}
