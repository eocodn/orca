import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exec, execFile } from 'node:child_process'
import { getDefaultRepoHookSettings } from '../shared/constants'
import { getRuntimePathBasename } from '../shared/cross-platform-path'
import { resolveHookCommandSourcePolicy } from '../shared/hook-command-source-policy'
import { shouldWaitForSetupBeforeAgentStartup } from '../shared/setup-agent-startup-policy'
import { TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV } from '../shared/terminal-git-credential-guard'
import { parseOrcaYaml } from '../shared/orca-yaml'
import { gitExecFileSync, promptGuardShellEnv } from './git/runner'
import { isWslPath, parseWslPath, toWindowsWslPath, toLinuxPath } from './wsl'
import { addWorktreeSetupWslInteropEnv } from './pty/wsl-orca-env'
import type {
  HookCommandSourcePolicy,
  OrcaHooks,
  Repo,
  SetupDecision,
  SetupRunPolicy,
  WorktreeDefaultTabsLaunch,
  WorktreeSetupLaunch
} from '../shared/types'
import type { ProjectExecutionRuntimeResolution } from '../shared/project-execution-runtime'
import {
  getHookRuntimeTarget,
  getHookWslContext,
  getSetupEnvVars
} from './hook-runner-scripts'

const HOOK_TIMEOUT = 120_000 // 2 minutes

export type HookRuntimeTarget = {
  wslDistro?: string | null
}

function getHookShell(): string | undefined {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe'
  }

  return '/bin/bash'
}

export { parseOrcaYaml }

/**
 * Load hooks from orca.yaml in the given repo root.
 */
export function loadHooks(repoPath: string): OrcaHooks | null {
  const yamlPath = join(repoPath, 'orca.yaml')
  if (!existsSync(yamlPath)) {
    return null
  }

  try {
    const content = readFileSync(yamlPath, 'utf-8')
    return parseOrcaYaml(content)
  } catch {
    return null
  }
}

/**
 * Check whether an orca.yaml exists for a repo.
 */
export function hasHooksFile(repoPath: string): boolean {
  return existsSync(join(repoPath, 'orca.yaml'))
}

// Why: detect unrecognised keys so the UI can suggest an update instead of showing a "could not be parsed" error.
const RECOGNIZED_ORCA_YAML_KEYS = new Set([
  'scripts',
  'issueCommand',
  'defaultTabs',
  'environmentRecipes',
  'worktree'
])

/** True when `orca.yaml` has a top-level key this version of Orca does not handle. */
export function hasUnrecognizedOrcaYamlKeys(repoPath: string): boolean {
  try {
    const content = readFileSync(join(repoPath, 'orca.yaml'), 'utf-8')
    for (const line of iterateLfScriptLines(content)) {
      // Why: match bare `key:` at end-of-line too, since a mapping with a block value on the next line is valid YAML.
      const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(\s|$)/)
      if (m != null && !RECOGNIZED_ORCA_YAML_KEYS.has(m[1])) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

// ─── Issue command files ────────────────────────────────────────────────
// Why: `.orca/issue-command` is the per-user override; `orca.yaml` is the tracked project default.

const ORCA_DIR = '.orca'
const ISSUE_COMMAND_FILENAME = 'issue-command'

export function getIssueCommandFilePath(repoPath: string): string {
  return join(repoPath, ORCA_DIR, ISSUE_COMMAND_FILENAME)
}

export function getSharedIssueCommand(repoPath: string): string | null {
  return loadHooks(repoPath)?.issueCommand?.trim() || null
}

export type ResolvedIssueCommand = {
  localContent: string | null
  sharedContent: string | null
  effectiveContent: string | null
  localFilePath: string
  source: 'local' | 'shared' | 'none'
}

/**
 * Resolve the GitHub issue command using local override first, then tracked repo config.
 */
export function readIssueCommand(repoPath: string): ResolvedIssueCommand {
  const filePath = getIssueCommandFilePath(repoPath)
  let localContent: string | null = null

  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8').trim()
      localContent = content || null
    } catch {
      localContent = null
    }
  }

  const sharedContent = getSharedIssueCommand(repoPath)
  const effectiveContent = localContent ?? sharedContent

  return {
    localContent,
    sharedContent,
    effectiveContent,
    localFilePath: filePath,
    source: localContent ? 'local' : sharedContent ? 'shared' : 'none'
  }
}

/**
 * Write the per-user issue command override to `{repoRoot}/.orca/issue-command`.
 * Empty content deletes the override so the shared `orca.yaml` command applies again.
 */
export function writeIssueCommand(repoPath: string, content: string): void {
  const filePath = getIssueCommandFilePath(repoPath)
  const trimmed = content.trim()

  try {
    if (!trimmed) {
      rmSync(filePath, { force: true })
      return
    }

    const orcaDir = join(repoPath, ORCA_DIR)
    if (!existsSync(orcaDir)) {
      mkdirSync(orcaDir, { recursive: true })
    }
    ensureOrcaDirIgnored(repoPath)
    writeFileSync(filePath, `${trimmed}\n`, 'utf-8')
  } catch (err) {
    console.error('[hooks] Failed to write issue command:', err)
    // Why: re-throw so the IPC handler surfaces the write failure to the renderer's .catch().
    throw err
  }
}

/** Ensure `.orca` is in `.gitignore` so the per-user directory is never committed. */
function ensureOrcaDirIgnored(repoPath: string): void {
  const gitignorePath = join(repoPath, '.gitignore')
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8')
      if (/^\.orca\/?$/m.test(content)) {
        return
      }
      const separator = content.endsWith('\n') ? '' : '\n'
      writeFileSync(gitignorePath, `${content}${separator}.orca\n`, 'utf-8')
    } else {
      writeFileSync(gitignorePath, '.orca\n', 'utf-8')
    }
  } catch {
    console.warn('[hooks] Could not update .gitignore to exclude .orca')
  }
}

function getEffectiveHookScript(
  yamlScript: string | undefined,
  localScript: string | undefined,
  policy: HookCommandSourcePolicy
): string | undefined {
  const shared = yamlScript?.trim()
  const local = localScript?.trim()

  if (policy === 'local-only') {
    return local || undefined
  }

  if (policy === 'run-both') {
    return [shared, local].filter(Boolean).join('\n') || undefined
  }

  return shared || undefined
}

export function getEffectiveHooksFromConfig(
  repo: Repo,
  yamlHooks: OrcaHooks | null
): OrcaHooks | null {
  const localSetup = repo.hookSettings?.scripts.setup
  const localArchive = repo.hookSettings?.scripts.archive
  const rawPolicy = repo.hookSettings?.commandSourcePolicy
  const setupPolicy = resolveHookCommandSourcePolicy(rawPolicy, {
    hasLocalScript: Boolean(localSetup?.trim())
  })
  const archivePolicy = resolveHookCommandSourcePolicy(rawPolicy, {
    hasLocalScript: Boolean(localArchive?.trim())
  })
  const setup = getEffectiveHookScript(yamlHooks?.scripts.setup, localSetup, setupPolicy)
  const archive = getEffectiveHookScript(yamlHooks?.scripts.archive, localArchive, archivePolicy)

  if (!setup && !archive) {
    return null
  }

  // Why: committed `orca.yaml` and local Settings can coexist; the source policy decides which is authoritative.
  return {
    scripts: {
      ...(setup ? { setup } : {}),
      ...(archive ? { archive } : {})
    }
  }
}

export function getEffectiveHooks(repo: Repo, worktreePath?: string): OrcaHooks | null {
  const hooksRoot = worktreePath ?? repo.path
  return getEffectiveHooksFromConfig(repo, loadHooks(hooksRoot))
}

export function getEffectiveSetupRunPolicy(repo: Repo): SetupRunPolicy {
  return repo.hookSettings?.setupRunPolicy ?? getDefaultRepoHookSettings().setupRunPolicy!
}

export function shouldRunSetupForCreate(repo: Repo, decision: SetupDecision = 'inherit'): boolean {
  if (decision === 'run') {
    return true
  }
  if (decision === 'skip') {
    return false
  }

  const policy = getEffectiveSetupRunPolicy(repo)
  if (policy === 'ask') {
    throw new Error('Setup decision required for this repository')
  }

  return policy === 'run-by-default'
}

export function getDefaultTabCommandTrustContent(hooks: OrcaHooks | null): string {
  const commands = (hooks?.defaultTabs ?? [])
    .map((tab, index) => {
      const command = tab.command?.trim()
      if (!command) {
        return null
      }
      const label = tab.title ? ` ${tab.title}` : ''
      return `# defaultTabs[${index + 1}]${label}\n${command}`
    })
    .filter((entry): entry is string => entry !== null)
  return [hooks?.scripts.setup?.trim(), ...commands].filter(Boolean).join('\n\n')
}

export function getDefaultTabsLaunch(
  hooks: OrcaHooks | null,
  repo: Repo,
  decision: SetupDecision = 'inherit'
): WorktreeDefaultTabsLaunch | undefined {
  const tabs = hooks?.defaultTabs ?? []
  if (tabs.length === 0) {
    return undefined
  }
  const hasCommands = tabs.some((tab) => Boolean(tab.command?.trim()))
  const sharedCommandPolicy = resolveHookCommandSourcePolicy(
    repo.hookSettings?.commandSourcePolicy,
    {
      hasLocalScript: Boolean(repo.hookSettings?.scripts.setup?.trim())
    }
  )
  // Why: local-only repos may use shared tab titles/colors but must not run the committed orca.yaml commands.
  const canRunSharedCommands = sharedCommandPolicy !== 'local-only'
  const runCommands =
    hasCommands && canRunSharedCommands ? shouldRunSetupForCreate(repo, decision) : false
  return { tabs, runCommands }
}

export function getSetupCommandSource(
  repo: Repo,
  worktreePath?: string
): { source: 'yaml' | 'local' | 'both'; command: string } | null {
  const hooksRoot = worktreePath ?? repo.path
  const yamlHooks = loadHooks(hooksRoot)
  const yamlSetup = yamlHooks?.scripts.setup?.trim()
  const localSetup = repo.hookSettings?.scripts.setup?.trim()
  const rawPolicy = repo.hookSettings?.commandSourcePolicy
  const policy = resolveHookCommandSourcePolicy(rawPolicy, {
    hasLocalScript: Boolean(localSetup)
  })

  if (policy === 'local-only') {
    return localSetup ? { source: 'local', command: localSetup } : null
  }

  if (policy === 'run-both' && yamlSetup && localSetup) {
    return { source: 'both', command: `${yamlSetup}\n${localSetup}` }
  }

  if (yamlSetup) {
    return { source: 'yaml', command: yamlSetup }
  }

  return null
}

export {
  getSetupRunnerEnvVars,
  createSetupRunnerScript,
  createIssueCommandRunnerScript,
  buildWindowsRunnerScript,
  buildPosixRunnerScript
} from './hook-runner-scripts'
/**
 * Run a named hook script in the given working directory.
 */
export function runHook(
  hookName: 'setup' | 'archive',
  cwd: string,
  repo: Repo,
  hooksPath?: string,
  projectRuntime?: ProjectExecutionRuntimeResolution | HookRuntimeTarget
): Promise<{ success: boolean; output: string }> {
  const hooks = getEffectiveHooks(repo, hooksPath)
  const script = hooks?.scripts[hookName]

  if (!script) {
    return Promise.resolve({ success: true, output: '' })
  }

  const runtimeTarget = getHookRuntimeTarget(projectRuntime)
  const wslInfo = getHookWslContext(cwd, runtimeTarget)

  if (wslInfo) {
    // Why: use execFile to bypass cmd.exe, which mangles single-quote escaping of %, ^, &, |, etc.
    const escapedCwd = wslInfo.linuxPath.replace(/'/g, "'\\''")
    const escapedScript = script.replace(/'/g, "'\\''")
    const bashCmd = `cd '${escapedCwd}' && ${escapedScript}`
    // Why: hook scripts run inside WSL, so translate the ORCA_* Windows UNC paths to Linux paths.
    const envVars = getSetupEnvVars(repo, cwd)
    const wslEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(envVars)) {
      wslEnv[key] = toLinuxPath(value)
    }
    const hookEnv: NodeJS.ProcessEnv = { ...process.env, ...wslEnv }
    // Why: wsl.exe only imports Windows env vars named in WSLENV; without
    // registering them the setup vars never reach the guest (#9206).
    addWorktreeSetupWslInteropEnv(hookEnv)

    return new Promise((resolve) => {
      let child: ReturnType<typeof execFile> | null = null
      let settled = false

      const finish = (error: Error | null, stdout = '', stderr = ''): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        if (error) {
          console.error(`[hooks] ${hookName} hook failed in ${cwd}:`, error.message)
          resolve({
            success: false,
            output: `${stdout}\n${stderr}\n${error.message}`.trim()
          })
        } else {
          console.log(`[hooks] ${hookName} hook completed in ${cwd}`)
          resolve({
            success: true,
            output: `${stdout}\n${stderr}`.trim()
          })
        }
      }

      // Why: execFile's timeout only signals wsl.exe; force-unblock after HOOK_TIMEOUT if no callback arrives.
      const timeout = setTimeout(() => {
        child?.kill()
        finish(new Error(`Hook timed out after ${HOOK_TIMEOUT}ms.`))
      }, HOOK_TIMEOUT)

      try {
        const distroArgs = wslInfo.distro ? ['-d', wslInfo.distro] : []
        child = execFile(
          'wsl.exe',
          [...distroArgs, '--', 'bash', '-c', bashCmd],
          {
            timeout: HOOK_TIMEOUT,
            encoding: 'utf-8',
            // Why: same unattended-git guard as the non-WSL branch below
            // (issue #7652) — WSL repos are the likeliest to hit the GCM
            // popup, and the guard's WSLENV registration is what carries it
            // across the wsl.exe boundary. Wrap hookEnv (not a fresh env) so
            // the setup-var WSLENV entries registered above (#9206) are kept —
            // promptGuardShellEnv appends its own keys to the existing WSLENV.
            env: promptGuardShellEnv(hookEnv)
          },
          (error, stdout, stderr) => {
            finish(error ?? null, stdout, stderr)
          }
        )
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  return new Promise((resolve) => {
    exec(
      script,
      {
        cwd,
        timeout: HOOK_TIMEOUT,
        shell: getHookShell(),
        // Why: hooks run unattended; block Git Credential Manager's interactive prompt while keeping cached auth (issue #7652).
        env: promptGuardShellEnv({
          ...process.env,
          ...getSetupEnvVars(repo, cwd)
        })
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error(`[hooks] ${hookName} hook failed in ${cwd}:`, error.message)
          resolve({
            success: false,
            output: `${stdout}\n${stderr}\n${error.message}`.trim()
          })
        } else {
          console.log(`[hooks] ${hookName} hook completed in ${cwd}`)
          resolve({
            success: true,
            output: `${stdout}\n${stderr}`.trim()
          })
        }
      }
    )
  })
}
