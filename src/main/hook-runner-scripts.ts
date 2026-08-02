import { dirname } from 'node:path'
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { getRuntimePathBasename } from '../shared/cross-platform-path'
import { shouldWaitForSetupBeforeAgentStartup } from '../shared/setup-agent-startup-policy'
import { TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV } from '../shared/terminal-git-credential-guard'
import type { Repo, WorktreeSetupLaunch } from '../shared/types'
import type { ProjectExecutionRuntimeResolution } from '../shared/project-execution-runtime'
import { gitExecFileSync } from './git/runner'
import { isWslPath, parseWslPath, toWindowsWslPath, toLinuxPath } from './wsl'

export type HookRuntimeTarget = {
  wslDistro?: string | null
}

export function getSetupEnvVars(repo: Repo, worktreePath: string): Record<string, string> {
  return {
    ORCA_ROOT_PATH: repo.path,
    ORCA_WORKTREE_PATH: worktreePath,
    ORCA_WORKSPACE_NAME: getRuntimePathBasename(worktreePath),
    // Compat with conductor.json users
    CONDUCTOR_ROOT_PATH: repo.path,
    GHOSTX_ROOT_PATH: repo.path
  }
}

function getGitPath(cwd: string, relativePath: string, runtimeTarget?: HookRuntimeTarget): string {
  return gitExecFileSync(['rev-parse', '--git-path', relativePath], {
    cwd,
    ...(runtimeTarget?.wslDistro ? { wslDistro: runtimeTarget.wslDistro } : {})
  }).trim()
}

export function getHookRuntimeTarget(
  projectRuntime?: ProjectExecutionRuntimeResolution | HookRuntimeTarget
): HookRuntimeTarget | undefined {
  if (!projectRuntime) {
    return undefined
  }

  if ('status' in projectRuntime) {
    if (projectRuntime.status === 'repair-required') {
      return projectRuntime.repair.preferredRuntime.kind === 'wsl'
        ? { wslDistro: projectRuntime.repair.preferredRuntime.distro }
        : undefined
    }
    return projectRuntime.runtime.kind === 'wsl'
      ? { wslDistro: projectRuntime.runtime.distro }
      : undefined
  }

  return projectRuntime.wslDistro ? { wslDistro: projectRuntime.wslDistro } : undefined
}

export function getHookWslContext(
  cwd: string,
  runtimeTarget?: HookRuntimeTarget
): { distro: string | null; linuxPath: string } | null {
  const pathInfo = parseWslPath(cwd)
  if (pathInfo) {
    return pathInfo
  }

  const wslDistro = runtimeTarget?.wslDistro?.trim()
  if (!wslDistro) {
    return null
  }

  // Why: project runtime can route a Windows checkout through WSL, so hooks need the Linux view of the path.
  return {
    distro: wslDistro,
    linuxPath: toLinuxPath(cwd)
  }
}

export function buildWindowsRunnerScript(script: string): string {
  let runnerScript = '@echo off\r\nsetlocal EnableExtensions\r\n'

  for (const rawLine of iterateLfScriptLines(script)) {
    const command = rawLine.trim()
    if (!command) {
      runnerScript += '\r\n'
      continue
    }

    // Why: npm/pnpm are Windows batch files; `call` each line and bail on errorlevel for set -e fail-fast behavior.
    runnerScript += `call ${command}\r\nif errorlevel 1 exit /b %errorlevel%\r\n`
  }

  return runnerScript
}

export function* iterateLfScriptLines(script: string): Generator<string> {
  let lineStart = 0

  for (let index = 0; index < script.length; index++) {
    if (script.charCodeAt(index) !== 10) {
      continue
    }
    const lineEnd = index > lineStart && script.charCodeAt(index - 1) === 13 ? index - 1 : index
    yield script.slice(lineStart, lineEnd)
    lineStart = index + 1
  }

  if (lineStart <= script.length) {
    yield script.slice(lineStart)
  }
}

export function createSetupRunnerScript(
  repo: Repo,
  worktreePath: string,
  script: string,
  projectRuntime?: ProjectExecutionRuntimeResolution | HookRuntimeTarget
): WorktreeSetupLaunch {
  return createWorktreeRunnerScript(
    repo,
    worktreePath,
    script,
    'setup-runner',
    getHookRuntimeTarget(projectRuntime),
    shouldWaitForSetupBeforeAgentStartup(repo.hookSettings?.setupAgentStartupPolicy)
  )
}

export function getSetupRunnerEnvVars(repo: Repo, worktreePath: string): Record<string, string> {
  return {
    ...getSetupEnvVars(repo, worktreePath),
    // Why: the Setup terminal is unattended automation, so force the credential guard regardless of user opt-out.
    [TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]: 'guard'
  }
}

export function buildPosixRunnerScript(script: string): string {
  return `#!/usr/bin/env bash\nset -e\n${normalizeCrlfScriptLineEndings(script)}\n`
}

function normalizeCrlfScriptLineEndings(script: string): string {
  let crlfStart = script.indexOf('\r\n')
  if (crlfStart === -1) {
    return script
  }

  let normalized = script.slice(0, crlfStart)
  let chunkStart = crlfStart + 2
  normalized += '\n'
  crlfStart = script.indexOf('\r\n', chunkStart)

  while (crlfStart !== -1) {
    normalized += script.slice(chunkStart, crlfStart)
    normalized += '\n'
    chunkStart = crlfStart + 2
    crlfStart = script.indexOf('\r\n', chunkStart)
  }

  return `${normalized}${script.slice(chunkStart)}`
}

export function createIssueCommandRunnerScript(
  repo: Repo,
  worktreePath: string,
  command: string,
  projectRuntime?: ProjectExecutionRuntimeResolution | HookRuntimeTarget
): WorktreeSetupLaunch {
  // Why: writing long commands into a runner script avoids the PTY line editor wrapping/truncating them.
  return createWorktreeRunnerScript(
    repo,
    worktreePath,
    command,
    'issue-command-runner',
    getHookRuntimeTarget(projectRuntime)
  )
}

function createWorktreeRunnerScript(
  repo: Repo,
  worktreePath: string,
  script: string,
  runnerBaseName: 'setup-runner' | 'issue-command-runner',
  runtimeTarget?: HookRuntimeTarget,
  waitForAgentStartup?: boolean
): WorktreeSetupLaunch {
  const envVars = getSetupRunnerEnvVars(repo, worktreePath)
  // Why: WSL worktrees are Linux fs even though process.platform is 'win32'; use bash for WSL, .cmd for native Windows.
  const wslWorktree = isWslPath(worktreePath) || Boolean(runtimeTarget?.wslDistro)
  const useWindowsFormat = process.platform === 'win32' && !wslWorktree
  // Why: linked worktrees use a `.git` file, so resolve the real per-worktree gitdir via git rev-parse --git-path.
  const gitRelPath = useWindowsFormat ? `orca/${runnerBaseName}.cmd` : `orca/${runnerBaseName}.sh`
  let runnerScriptPath = getGitPath(worktreePath, gitRelPath, runtimeTarget)

  // Why: git runs inside WSL and returns a Linux path; convert to a UNC path so the Windows fs calls can reach it.
  if (wslWorktree) {
    const wslInfo = getHookWslContext(worktreePath, runtimeTarget)
    if (wslInfo?.distro) {
      runnerScriptPath = toWindowsWslPath(runnerScriptPath.trim(), wslInfo.distro)
    }
  }

  mkdirSync(dirname(runnerScriptPath), { recursive: true })

  if (useWindowsFormat) {
    writeFileSync(runnerScriptPath, buildWindowsRunnerScript(script), 'utf-8')
  } else {
    writeFileSync(runnerScriptPath, buildPosixRunnerScript(script), 'utf-8')
    // Why: chmod over a UNC path to the WSL filesystem sets the execute bit correctly inside WSL.
    chmodSync(runnerScriptPath, 0o755)
  }

  // Why: setup script runs inside WSL bash, so translate the Windows UNC env-var paths to Linux paths.
  if (wslWorktree) {
    for (const key of Object.keys(envVars)) {
      envVars[key] = toLinuxPath(envVars[key])
    }
  }

  return {
    runnerScriptPath,
    envVars,
    ...(waitForAgentStartup === true ? { waitForAgentStartup: true } : {})
  }
}
