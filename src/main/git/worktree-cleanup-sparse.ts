import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, posix, resolve, win32 } from 'node:path'
import {
  branchHasNoUnmergedChangesOnAnyTarget,
  getBranchCleanupTargetRefs,
  refreshBranchCleanupTargetRefs
} from '../../shared/git-branch-cleanup'
import { resolveWorktreeAddBaseRef } from '../../shared/worktree-base-ref'
import { withSpan } from '../observability/tracer'
import type {
  GitWorktreeInfo,
  LocalBaseRefRefreshResult,
  LocalBaseRefUpdateSuggestion,
  RemoveWorktreeResult
} from '../../shared/types'
import { assertWorktreeUnlockedForRemoval } from '../../shared/worktree-removal'
import { isSubmoduleWorktreeRemovalRefusal } from '../../shared/worktree-submodule-removal'
import { decodeGitCQuotedPath } from '../../shared/git-cquoted-path'
import { parseGitRevListAheadBehindCounts } from '../../shared/git-rev-list-output'
import { parseWslUncPath } from '../../shared/wsl-paths'
import {
  hasUnsupportedRevParsePathFormatEcho,
  isUnsupportedRevParsePathFormatError,
  isUnsupportedWorktreeListZError
} from '../../shared/git-worktree-command-capabilities'
import { getLocalGitCapabilityCache } from './git-capability-state'
import { gitExecFileAsync, translateWslOutputPaths } from './runner'
import { resolveGitDir, runWithGitReadCacheInvalidation } from './status'
import { hasWorktreeBaseCommitRef } from './worktree-base-ref-probe'
import { type GitWorktreeExecOptions, type WorktreeRemovalPreflightOptions, WORKTREE_REMOVAL_PREFLIGHT_TIMEOUT_MS, gitExecOptions, normalizeLocalBranchRef } from './worktree-foundation'
import { parseWorktreeList } from './worktree-listing'
async function forceDeleteLocalBranch(
  repoPath: string,
  branchName: string,
  expectedHead: string,
  runGit: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }> = (
    args,
    cwd
  ) => gitExecFileAsync(args, { cwd })
): Promise<void> {
  if (!branchName || branchName.includes('\0')) {
    throw new Error('Invalid branch name')
  }
  if (!expectedHead) {
    throw new Error(
      `Cannot force-delete local branch "${branchName}" without the commit Git preserved.`
    )
  }
  if (await isLocalBranchCheckedOut(repoPath, branchName, runGit)) {
    throw new Error(`Local branch "${branchName}" is checked out in another worktree.`)
  }
  // Why: stale toast actions must not delete a branch that moved; `update-ref -d` deletes only if the ref still == expectedHead.
  try {
    await runGit(['update-ref', '-d', `refs/heads/${branchName}`, expectedHead], repoPath)
  } catch {
    throw new Error(
      `Local branch "${branchName}" changed after the workspace was deleted. Review it before deleting it.`
    )
  }
  if (await isLocalBranchCheckedOut(repoPath, branchName, runGit)) {
    try {
      await runGit(['update-ref', `refs/heads/${branchName}`, expectedHead, ''], repoPath)
    } catch (restoreError) {
      console.warn(
        `[git] Failed to restore local branch "${branchName}" after concurrent checkout`,
        restoreError
      )
    }
    throw new Error(`Local branch "${branchName}" is checked out in another worktree.`)
  }
  try {
    await runGit(['config', '--remove-section', `branch.${branchName}`], repoPath)
  } catch {
    // Best-effort parity with `git branch -D`; stale config is harmless.
  }
}

async function isLocalBranchCheckedOut(
  repoPath: string,
  branchName: string,
  runGit: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>
): Promise<boolean> {
  const { stdout } = await runGit(['worktree', 'list', '--porcelain'], repoPath)
  return parseWorktreeList(stdout).some(
    (worktree) => normalizeLocalBranchRef(worktree.branch) === branchName
  )
}

/**
 * Assert a worktree is clean enough for non-force removal.
 */
async function assertWorktreeCleanForRemoval(
  worktreePath: string,
  force = false,
  options: WorktreeRemovalPreflightOptions = {}
): Promise<void> {
  if (force) {
    return
  }

  const { ignoredUntrackedPaths = [], ...gitOptions } = options
  const useNullTerminatedStatus = ignoredUntrackedPaths.length > 0
  const { stdout } = await gitExecFileAsync(
    ['status', '--porcelain', ...(useNullTerminatedStatus ? ['-z'] : []), '--untracked-files=all'],
    {
      ...gitExecOptions(worktreePath, gitOptions),
      timeout: gitOptions.timeout ?? WORKTREE_REMOVAL_PREFLIGHT_TIMEOUT_MS
    }
  )
  // Why one parse feeds both: the clean verdict and the error text must never
  // disagree about which entries block removal.
  const blockingEntries = useNullTerminatedStatus
    ? getBlockingUntrackedStatusEntries(stdout, ignoredUntrackedPaths)
    : null
  if (blockingEntries ? blockingEntries.length === 0 : !stdout.trim()) {
    return
  }

  const error = new Error('Worktree has uncommitted or untracked changes.')
  // Why not the raw stdout: `-z` output is NUL-delimited and `.trim()` leaves
  // interior NULs, so attaching it verbatim put raw control bytes into the
  // user-facing removal error — and listed the tolerated shared link, the one
  // entry that is not the user's work and cannot be committed away.
  ;(error as Error & { stdout?: string }).stdout = blockingEntries
    ? blockingEntries.join('\n')
    : stdout
  throw error
}

/** The `git status --porcelain -z` entries that genuinely block removal:
 *  everything except the untracked shared links the caller tolerates. */
function getBlockingUntrackedStatusEntries(
  status: string,
  ignoredUntrackedPaths: readonly string[]
): string[] {
  const ignored = new Set(
    ignoredUntrackedPaths
      .map((entry) =>
        entry
          .trim()
          .replace(/^[\\/]+/, '')
          .replace(/\\/g, '/')
      )
      .filter((entry) => entry && !entry.split('/').includes('..'))
  )
  return status
    .split('\0')
    .filter(Boolean)
    .filter(
      (entry) => !(entry.startsWith('?? ') && ignored.has(entry.slice(3).replace(/\\/g, '/')))
    )
}

function translateWorktreePath(
  worktreePath: string,
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): string {
  const prefix = 'worktree '
  const translated = translateWslOutputPaths(`${prefix}${worktreePath}`, repoPath, options)
  return translated.startsWith(prefix) ? translated.slice(prefix.length) : worktreePath
}

async function detectSparseCheckout(worktreePath: string): Promise<boolean> {
  // Why: fs.stat the per-worktree gitdir's sparse-checkout pattern file instead of a per-poll `git sparse-checkout list` subprocess that regressed responsiveness (PR #1290);
  // this is the cheap fast-path gate before the enabled check below.
  try {
    const gitDir = await resolveGitDir(worktreePath)
    const stats = await stat(join(gitDir, 'info', 'sparse-checkout'))
    if (!stats.isFile() || stats.size === 0) {
      return false
    }
    // Why the extra config read: `git sparse-checkout disable` restores every file to the
    // working tree and sets core.sparseCheckout=false, but it deliberately LEAVES
    // <gitdir>/info/sparse-checkout in place so the checkout can be re-enabled with the same
    // patterns. A non-empty pattern file is therefore necessary but not sufficient — without
    // confirming core.sparseCheckout is actually on we would flag a fully-populated worktree as
    // sparse and show a misleading "files are not on disk" badge. This runs only for the rare
    // worktree that still has a non-empty pattern file, so it does not reintroduce the per-poll
    // subprocess fan-out PR #1290 removed, and it reads git's config files directly (no
    // subprocess) so it stays cheap and needs no exec options.
    return await isSparseCheckoutEnabled(gitDir)
  } catch {
    return false
  }
}

// Resolve the shared common gitdir for a (possibly linked) worktree gitdir. A linked worktree's
// gitdir holds a `commondir` file pointing at the repo's main `.git`; the main worktree's gitdir
// is itself the common dir.
async function resolveGitCommonDir(gitDir: string): Promise<string> {
  try {
    const raw = (await readFile(join(gitDir, 'commondir'), 'utf-8')).trim()
    if (raw.length > 0) {
      return isAbsolute(raw) ? raw : resolve(gitDir, raw)
    }
  } catch {
    // No `commondir` file: this gitdir is already the common dir.
  }
  return gitDir
}

// Whether core.sparseCheckout is actually enabled for this worktree. The value can live in the
// shared repo config or, when extensions.worktreeConfig is on, in the worktree-local
// `config.worktree`; later files override earlier ones, matching git's config precedence.
async function isSparseCheckoutEnabled(gitDir: string): Promise<boolean> {
  const commonDir = await resolveGitCommonDir(gitDir)
  const sharedConfig = await readGitConfigText(join(commonDir, 'config'))
  const sharedFlag = parseCoreSparseCheckoutFlag(sharedConfig)
  // Git reads `config.worktree` only while extensions.worktreeConfig is on; without that gate a
  // stale worktree config left behind by an earlier sparse checkout overrides the real repo value.
  if (parseGitConfigFlag(sharedConfig, 'extensions', 'worktreeconfig') !== true) {
    return sharedFlag ?? false
  }
  const worktreeConfig = await readGitConfigText(join(gitDir, 'config.worktree'))
  return parseCoreSparseCheckoutFlag(worktreeConfig) ?? sharedFlag ?? false
}

async function readGitConfigText(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, 'utf-8')
  } catch {
    return ''
  }
}

// Read the effective `core.sparseCheckout` boolean from one git config file's text, or `undefined`
// when the plain `[core]` section does not set it. Kept as a pure, exported function so the
// git-config parsing edge cases can be unit tested without touching the filesystem. Only the last
// assignment wins, and a `[core "subsection"]` header is intentionally not treated as `[core]`.
function parseCoreSparseCheckoutFlag(configContent: string): boolean | undefined {
  return parseGitConfigFlag(configContent, 'core', 'sparsecheckout')
}

// A section header may be followed on the same line by further headers and then one assignment
// (`[core] sparseCheckout = true` is legal git config); the value runs to end of line, so at most
// one assignment can share a line and the last header before it decides the section.
const GIT_CONFIG_SECTION_HEADER = /^\[\s*([A-Za-z0-9.-]+)(\s+"(?:[^"\\]|\\.)*")?\s*\]/
const GIT_CONFIG_ASSIGNMENT = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/

// `section` and `key` must be lowercase: git config names are case-insensitive.
function parseGitConfigFlag(
  configContent: string,
  section: string,
  key: string
): boolean | undefined {
  let inSection = false
  let value: boolean | undefined
  for (const rawLine of configContent.split(/\r?\n/)) {
    let rest = stripGitConfigComment(rawLine).trim()
    for (
      let header = rest.match(GIT_CONFIG_SECTION_HEADER);
      header;
      header = rest.match(GIT_CONFIG_SECTION_HEADER)
    ) {
      inSection = header[1].toLowerCase() === section && header[2] === undefined
      rest = rest.slice(header[0].length).trim()
    }
    if (!inSection || rest.length === 0) {
      continue
    }
    const assignment = rest.match(GIT_CONFIG_ASSIGNMENT)
    if (!assignment || assignment[1].toLowerCase() !== key) {
      continue
    }
    value = parseGitConfigBoolean(assignment[2])
  }
  return value
}

// Drop a trailing `#`/`;` comment that is not inside a double-quoted value.
function stripGitConfigComment(line: string): string {
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index - 1] !== '\\') {
      inQuotes = !inQuotes
    } else if ((char === '#' || char === ';') && !inQuotes) {
      return line.slice(0, index)
    }
  }
  return line
}

// Git treats a valueless boolean (`sparseCheckout` with no `=`) as true and only true/yes/on/1 as
// true otherwise; everything else (including the disable-written `false`) is false.
function parseGitConfigBoolean(raw: string | undefined): boolean {
  if (raw === undefined) {
    return true
  }
  const value = raw
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .toLowerCase()
  return value === 'true' || value === 'yes' || value === 'on' || value === '1'
}

export { forceDeleteLocalBranch, isLocalBranchCheckedOut, assertWorktreeCleanForRemoval, getBlockingUntrackedStatusEntries, translateWorktreePath, detectSparseCheckout, resolveGitCommonDir, isSparseCheckoutEnabled, readGitConfigText, parseCoreSparseCheckoutFlag, GIT_CONFIG_SECTION_HEADER, GIT_CONFIG_ASSIGNMENT, parseGitConfigFlag, stripGitConfigComment, parseGitConfigBoolean }

