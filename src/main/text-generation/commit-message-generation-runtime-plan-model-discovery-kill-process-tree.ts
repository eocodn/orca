import { exec, spawn, type ChildProcess } from 'node:child_process'
import { getCommitMessageAgentSpec } from '../../shared/commit-message-agent-spec'
import {
  planAgentBinary,
  type CommitMessagePlan
} from '../../shared/commit-message-plan'
import { resolveCliCommand } from '../codex-cli/command'
import {
  getSpawnArgsForWindows,
  WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR
} from '../win32-utils'
import { wslAwareSpawn } from '../git/runner'
import { exec, spawn, type ChildProcess } from 'node:child_process'
import type { TuiAgent } from '../../shared/types'
import { GENERATION_TIMEOUT_MS, MAX_AGENT_OUTPUT_BYTES } from './commit-message-generation-runtime-generation-timeout-ms-generate-commit-message-result'
import type {
  DiscoverCommitMessageModelsResult,
  RemoteCommitMessageExecResult
} from './commit-message-generation-runtime-discover-commit-message-models-result-text-generation-operation'
import type { CommitMessageModelDiscoveryLocalOptions } from './commit-message-generation-runtime-commit-message-generation-target-commit-message-model-discovery-local-options'
import {
  userFacingUnsafeWindowsBatchArgs,
  toModelDiscoveryCapability,
  finalizeModelDiscoveryOutput
} from './commit-message-generation-runtime-sanitize-agent-failure-detail-finalize-model-discovery-output'
import { buildWslLauncherEnv } from './commit-message-generation-runtime-build-wsl-launcher-env-run-remote-plan'

export function planModelDiscovery(
  spec: NonNullable<ReturnType<typeof getCommitMessageAgentSpec>>,
  agentCommandOverride?: string
): { ok: true; plan: CommitMessagePlan } | { ok: false; error: string } {
  const modelDiscovery = spec.modelDiscovery
  if (!modelDiscovery) {
    return { ok: false, error: `${spec.label} does not support dynamic model discovery.` }
  }
  const command = planAgentBinary(modelDiscovery.binary, agentCommandOverride)
  if (!command.ok) {
    return command
  }
  return {
    ok: true,
    plan: {
      binary: command.binary,
      args: [...command.prefixArgs, ...modelDiscovery.args],
      stdinPayload: null,
      label: spec.label
    }
  }
}


export async function discoverCommitMessageModelsLocal(
  agentId: TuiAgent,
  env: NodeJS.ProcessEnv | undefined,
  agentCommandOverride?: string,
  options: CommitMessageModelDiscoveryLocalOptions = {}
): Promise<DiscoverCommitMessageModelsResult> {
  const spec = getCommitMessageAgentSpec(agentId)
  if (!spec) {
    return { success: false, error: `Agent "${agentId}" does not support AI commit messages.` }
  }

  if (spec.modelSource === 'static' || !spec.modelDiscovery) {
    return toModelDiscoveryCapability(spec)
  }

  return new Promise((resolve) => {
    let child: ChildProcess
    const spawnEnv = env ?? process.env
    try {
      const planned = planModelDiscovery(spec, agentCommandOverride)
      if (!planned.ok) {
        resolve({ success: false, error: planned.error })
        return
      }
      if (process.platform === 'win32' && options.wslDistro) {
        child = wslAwareSpawn(planned.plan.binary, planned.plan.args, {
          cwd: options.cwd,
          env: buildWslLauncherEnv(env),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          wslDistro: options.wslDistro,
          useWslLoginShell: true
        })
      } else {
        const resolvedBinary =
          process.platform === 'win32'
            ? resolveCliCommand(planned.plan.binary, {
                pathEnv: spawnEnv.PATH ?? spawnEnv.Path ?? null
              })
            : planned.plan.binary
        const { spawnCmd, spawnArgs } = getSpawnArgsForWindows(resolvedBinary, planned.plan.args)
        child = spawn(spawnCmd, spawnArgs, {
          env: spawnEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        })
      }
    } catch (error) {
      console.error('[commit-message] Failed to spawn model discovery:', error)
      resolve({
        success: false,
        error: `${spec.label} model discovery could not be started. Check the agent CLI configuration and try again.`
      })
      return
    }

    let stdout = ''
    let stderr = ''
    let outputLimitExceeded = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let detachChildListeners = (): void => {}
    const finish = (result: DiscoverCommitMessageModelsResult): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      detachChildListeners()
      resolve(result)
    }
    timer = setTimeout(() => {
      killProcessTree(child)
      finish({
        success: false,
        error: `${spec.label} model discovery timed out after ${GENERATION_TIMEOUT_MS / 1000}s.`
      })
    }, GENERATION_TIMEOUT_MS)

    const onData = (chunk: Buffer, append: (text: string) => void): void => {
      if (stdout.length + stderr.length + chunk.byteLength > MAX_AGENT_OUTPUT_BYTES) {
        outputLimitExceeded = true
        killProcessTree(child)
        finish({ success: false, error: `${spec.label} returned too much model data.` })
        return
      }
      append(chunk.toString('utf-8'))
    }

    const onStdoutData = (chunk: Buffer): void => onData(chunk, (text) => (stdout += text))
    const onStderrData = (chunk: Buffer): void => onData(chunk, (text) => (stderr += text))
    const onError = (error: Error): void => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        finish({
          success: false,
          error: `${spec.modelDiscovery?.binary ?? spec.binary} not found on PATH. Install ${spec.label} to discover models.`
        })
        return
      }
      finish({
        success: false,
        error: `${spec.label} model discovery failed to start. Check the agent CLI configuration and try again.`
      })
    }
    const onClose = (code: number | null): void => {
      if (outputLimitExceeded) {
        finish({ success: false, error: `${spec.label} returned too much model data.` })
        return
      }
      if (code !== 0) {
        finish(finalizeModelDiscoveryOutput(spec, stdout, stderr, code))
        return
      }
      finish(finalizeModelDiscoveryOutput(spec, stdout, stderr, code))
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
  })
}


export async function discoverCommitMessageModelsRemote(
  agentId: TuiAgent,
  cwd: string,
  execute: (
    plan: CommitMessagePlan,
    cwd: string,
    timeoutMs: number
  ) => Promise<RemoteCommitMessageExecResult>,
  agentCommandOverride?: string
): Promise<DiscoverCommitMessageModelsResult> {
  const spec = getCommitMessageAgentSpec(agentId)
  if (!spec) {
    return { success: false, error: `Agent "${agentId}" does not support AI commit messages.` }
  }
  if (spec.modelSource === 'static' || !spec.modelDiscovery) {
    return toModelDiscoveryCapability(spec)
  }
  const planned = planModelDiscovery(spec, agentCommandOverride)
  if (!planned.ok) {
    return { success: false, error: planned.error }
  }
  let result: RemoteCommitMessageExecResult
  try {
    result = await execute(planned.plan, cwd, GENERATION_TIMEOUT_MS)
  } catch (error) {
    console.error('[commit-message] Remote model discovery request failed:', error)
    return {
      success: false,
      error: `${spec.label} model discovery could not be reached on the remote PATH. Try again after the SSH connection recovers.`
    }
  }
  if (result.spawnError) {
    if (result.spawnError === WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR) {
      return { success: false, error: userFacingUnsafeWindowsBatchArgs(spec.label) }
    }
    if (/ENOENT/i.test(result.spawnError)) {
      return {
        success: false,
        error: `${planned.plan.binary} not found on the remote PATH. Install ${spec.label} there.`
      }
    }
    console.error('[commit-message] Remote model discovery spawn failed:', result.spawnError)
    return {
      success: false,
      error: `${spec.label} model discovery could not be started on the remote PATH. Check the agent command there and try again.`
    }
  }
  if (result.canceled) {
    return { success: false, error: 'Model discovery canceled.' }
  }
  if (result.timedOut) {
    return {
      success: false,
      error: `${spec.label} model discovery timed out after ${GENERATION_TIMEOUT_MS / 1000}s.`
    }
  }
  return finalizeModelDiscoveryOutput(spec, result.stdout, result.stderr, result.exitCode)
}

// Why: on Windows, npm-installed CLIs like `claude` and `codex` are usually
// `.cmd` shims. We route those through cmd.exe so Node can launch them, and
// `child.kill()` would only terminate the wrapper. `taskkill /T /F` walks the
// process tree from the wrapper PID and force-kills every descendant, which is
// what users expect when they hit "stop generating".

export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) {
    return
  }
  if (process.platform === 'win32') {
    exec(`taskkill /pid ${pid} /T /F`, () => {
      // Best-effort; the spawn's `close` listener fires once the tree exits.
    })
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // The child may have already exited between the in-flight check and the
    // kill - that race is benign and can be ignored.
  }
}

// Keying by operation plus `local:${cwd}` keeps local cancellation independent
// from SSH worktrees and from other generation features in the same worktree.
