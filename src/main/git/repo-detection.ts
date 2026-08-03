import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { gitExecFileSync, gitExecFileAsync } from './runner'
import type { BaseRefSearchResult } from '../../shared/types'
import { parseGitRevListAheadBehindCounts } from '../../shared/git-rev-list-output'
import { normalizeRuntimePathSeparators } from '../../shared/cross-platform-path'
import { isForEachRefExcludeUnsupportedError } from '../../shared/git-ref-command-capabilities'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { toWindowsWslPath } from '../wsl'
import { buildHostedRemoteCommitUrl, buildHostedRemoteFileUrl } from './hosted-remote-url'
import { getLocalGitCapabilityCache } from './git-capability-state'
type LocalGitExecOptions = {
  wslDistro?: string
}

type LocalDefaultBaseRefGitOptions = {
  cwd: string
  wslDistro?: string
}

const DEFAULT_BASE_REF_PROBE_TIMEOUT_MS = 15_000

type GitRepoProbeResult = 'repo' | 'not-repo' | 'indeterminate'
type GitMarkerScanResult = { status: 'valid'; rootPath: string } | { status: 'absent' | 'invalid' }

function gitExecOptions(
  cwd: string,
  options: LocalGitExecOptions = {}
): { cwd: string; wslDistro?: string } {
  return options.wslDistro ? { cwd, wslDistro: options.wslDistro } : { cwd }
}

/**
 * Ordered probe list for a repo's default base ref when no origin/HEAD symbolic-ref is set.
 * `returnAs` is the short-name format the UI expects (as `for-each-ref --format=%(refname:short)` renders it).
 * Shared local/SSH so both resolve identical defaults.
 */
const DEFAULT_BASE_REF_PROBES: readonly { ref: string; returnAs: string }[] = [
  { ref: 'refs/remotes/origin/main', returnAs: 'origin/main' },
  { ref: 'refs/remotes/origin/master', returnAs: 'origin/master' },
  { ref: 'refs/heads/main', returnAs: 'main' },
  { ref: 'refs/heads/master', returnAs: 'master' }
]

/**
 * Walk DEFAULT_BASE_REF_PROBES in order, returning the first ref `hasRef` confirms, or null.
 * Abstracts the existence test so local and SSH paths share one authoritative probe ordering.
 */
async function resolveDefaultBaseRefFromProbes(
  hasRef: (ref: string) => Promise<boolean>
): Promise<string | null> {
  for (const { ref, returnAs } of DEFAULT_BASE_REF_PROBES) {
    if (await hasRef(ref)) {
      return returnAs
    }
  }
  return null
}

/** Check if a path is a valid git repository (regular or bare). */
function isGitRepo(path: string): boolean {
  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return false
    }
  } catch {
    return false
  }

  // Ask git directly first — authoritative for work trees, linked worktrees, submodules, and bare repos.
  const gitProbeResult = probeGitRepo(path)
  if (gitProbeResult === 'repo') {
    return true
  }
  if (gitProbeResult === 'not-repo') {
    return false
  }

  // Why: rev-parse can fail for reasons unrelated to repo-ness (spawn hiccup, config error); fall back to a
  // validated `.git` marker instead of downgrading a real repo to a plain folder (the spurious "Open as Folder" bug).
  const markerScan = scanGitMarkerSync(path)
  if (markerScan.status === 'valid' && !warnedMarkerFallbackThisSession) {
    // Why: warn once per session; the folder scanner calls isGitRepo for many paths and would otherwise flood logs.
    warnedMarkerFallbackThisSession = true
    console.warn('[isGitRepo] git rev-parse could not confirm repo; accepted via .git marker', {
      path
    })
  }
  return markerScan.status === 'valid'
}

let warnedMarkerFallbackThisSession = false

/**
 * Tri-state git probe: only a clean pair of negative answers is a definitive
 * non-repo. Spawn/config failures stay indeterminate so marker fallback can run.
 */
function probeGitRepo(path: string): GitRepoProbeResult {
  let sawFailure = false

  try {
    const insideWorkTree = gitExecFileSync(['rev-parse', '--is-inside-work-tree'], {
      cwd: path
    }).trim()
    if (insideWorkTree === 'true') {
      return 'repo'
    }
    if (insideWorkTree !== 'false') {
      return 'indeterminate'
    }
  } catch {
    sawFailure = true
  }

  try {
    const bareRepo = gitExecFileSync(['rev-parse', '--is-bare-repository'], {
      cwd: path
    }).trim()
    if (bareRepo === 'true') {
      return 'repo'
    }
    if (bareRepo !== 'false') {
      return 'indeterminate'
    }
  } catch {
    sawFailure = true
  }

  return sawFailure ? 'indeterminate' : 'not-repo'
}

function getGitRepoRoot(path: string): string {
  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return path
    }
    const insideWorkTree = gitExecFileSync(['rev-parse', '--is-inside-work-tree'], {
      cwd: path
    }).trim()
    if (insideWorkTree === 'true') {
      const root = gitExecFileSync(['rev-parse', '--show-toplevel'], {
        cwd: path
      }).trim()
      return normalizeGitRepoRootForInputPath(path, root)
    }
  } catch {
    // Fall through to preserving the original path.
  }
  const markerScan = scanGitMarkerSync(path)
  if (markerScan.status === 'valid') {
    return normalizeGitRepoRootForInputPath(path, markerScan.rootPath)
  }
  return path
}

function canonicalizeGitDirPath(path: string): string {
  return resolveRealPathSync(path) ?? path
}

/**
 * Main-checkout path when `path` is a *linked* worktree, else null (main worktree, bare repo,
 * non-repo, or any git failure). A linked worktree's `--git-dir` is `<common>/worktrees/<name>`
 * while the main worktree's equals `--git-common-dir`; comparing the two from one invocation is
 * git's own canonical test and avoids symlink-canonicalization mismatches. Baseline-safe: both
 * flags long predate Git 2.25, and a relative answer resolves against `path` as old Git reports it.
 */
function getLinkedWorktreeMainRepoRoot(path: string): string | null {
  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return null
    }
    if (gitExecFileSync(['rev-parse', '--is-inside-work-tree'], { cwd: path }).trim() !== 'true') {
      return null
    }
    const [gitDir, commonDir] = gitExecFileSync(['rev-parse', '--git-dir', '--git-common-dir'], {
      cwd: path
    })
      .split('\n')
      .map((line) => line.trim())
    if (!gitDir || !commonDir) {
      return null
    }
    // Why realpath both: git answers one flag absolutely (already symlink-resolved) and the other
    // relative to cwd, so a repo under a symlinked root (macOS /var -> /private/var) compares
    // unequal on raw strings and a main checkout gets misread as a linked worktree.
    const absoluteCommonDir = canonicalizeGitDirPath(resolve(path, commonDir))
    if (canonicalizeGitDirPath(resolve(path, gitDir)) === absoluteCommonDir) {
      return null
    }
    // A bare/separate git dir has no adjacent working checkout to point at.
    if (basename(absoluteCommonDir) !== '.git') {
      return null
    }
    // Re-resolve through getGitRepoRoot so the returned path matches the canonical form
    // add-project stores for the main checkout (symlinks resolved the way git reports them).
    return getGitRepoRoot(dirname(absoluteCommonDir))
  } catch {
    return null
  }
}

function normalizeGitRepoRootForInputPath(inputPath: string, rootPath: string): string {
  const inputWsl = parseWslUncPath(inputPath)
  if (inputWsl && rootPath.startsWith('/')) {
    // Why: WSL git reports Linux-native roots; persist the UNC path so later git calls keep routing through the WSL runner.
    return toWindowsWslPath(rootPath, inputWsl.distro)
  }
  return normalizeRuntimePathSeparators(rootPath)
}

/**
 * Filesystem-only fallback check for genuine Git metadata when git can't answer cleanly. Strict enough to
 * reject a garbage `.git` file (validation from 18ed7b27d): accepts a `.git` dir/file with real gitdir shape
 * or a bare-repo root (HEAD + objects/ + refs/, not a worktree admin dir).
 */
function scanGitMarkerSync(path: string): GitMarkerScanResult {
  const realPath = resolveRealPathSync(path)
  if (realPath && realPath !== path) {
    const lexicalScan = scanGitMarkerAncestorsSync(path)
    const realPathScan = scanGitMarkerAncestorsSync(realPath)
    if (
      lexicalScan.status === 'valid' &&
      realPathScan.status === 'valid' &&
      pathsReferToSameEntry(lexicalScan.rootPath, realPathScan.rootPath)
    ) {
      // Why: preserve lexical spellings (/var vs /private/var), but let a cross-repo symlink bind to the real target like git.
      return lexicalScan
    }
    return realPathScan
  }
  return scanGitMarkerAncestorsSync(path)
}

function resolveRealPathSync(path: string): string | null {
  try {
    return realpathSync.native(path)
  } catch {
    try {
      return realpathSync(path)
    } catch {
      return null
    }
  }
}

function scanGitMarkerAncestorsSync(path: string): GitMarkerScanResult {
  for (const candidate of ancestorDirectories(path)) {
    if (!isInsideDotGitMarker(candidate, path)) {
      const worktreeMarker = scanWorktreeMarkerSync(candidate)
      if (worktreeMarker.status !== 'absent') {
        return worktreeMarker
      }
    }
    if (hasValidBareRepoMarkerSync(candidate)) {
      return { status: 'valid', rootPath: candidate }
    }
  }
  return { status: 'absent' }
}

function ancestorDirectories(path: string): string[] {
  const directories: string[] = []
  let current = path
  while (true) {
    directories.push(current)
    const parent = dirname(current)
    if (parent === current) {
      return directories
    }
    current = parent
  }
}

function isInsideDotGitMarker(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return false
  }
  const firstSegment = relativePath.split(/[\\/]+/)[0]
  if (firstSegment === '.git') {
    return true
  }
  if (firstSegment.toLowerCase() !== '.git') {
    return false
  }
  return pathsReferToSameEntry(join(rootPath, firstSegment), join(rootPath, '.git'))
}

function pathsReferToSameEntry(leftPath: string, rightPath: string): boolean {
  try {
    const leftStat = statSync(leftPath)
    const rightStat = statSync(rightPath)
    if (leftStat.ino !== 0 && leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino) {
      return true
    }
    const leftRealPath = normalizeRuntimePathSeparators(realpathSync.native(leftPath))
    const rightRealPath = normalizeRuntimePathSeparators(realpathSync.native(rightPath))
    return process.platform === 'win32'
      ? leftRealPath.toLowerCase() === rightRealPath.toLowerCase()
      : leftRealPath === rightRealPath
  } catch {
    return false
  }
}

function scanWorktreeMarkerSync(worktreePath: string): GitMarkerScanResult {
  const dotGit = join(worktreePath, '.git')
  let marker: ReturnType<typeof statSync>
  try {
    marker = statSync(dotGit)
  } catch {
    return { status: 'absent' }
  }

  if (marker.isDirectory()) {
    return hasValidGitDirectorySync(dotGit)
      ? { status: 'valid', rootPath: worktreePath }
      : { status: 'invalid' }
  }
  if (marker.isFile()) {
    let gitDir: string | null
    try {
      gitDir = parseGitdirFile(worktreePath, readFileSync(dotGit, 'utf8'))
    } catch {
      return { status: 'invalid' }
    }
    return gitDir !== null && hasValidGitDirectorySync(gitDir)
      ? { status: 'valid', rootPath: worktreePath }
      : { status: 'invalid' }
  }
  return { status: 'invalid' }
}

function parseGitdirFile(basePath: string, content: string): string | null {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  const match = firstLine.match(/^gitdir:\s*(.+?)\s*$/i)
  if (!match) {
    return null
  }
  return resolveGitMetadataPath(basePath, match[1])
}

function resolveGitMetadataPath(basePath: string, rawPath: string): string | null {
  const value = rawPath.trim()
  if (!value) {
    return null
  }
  const baseWsl = parseWslUncPath(basePath)
  if (baseWsl && value.startsWith('/')) {
    return toWindowsWslPath(value, baseWsl.distro)
  }
  return isAbsolute(value) ? value : resolve(basePath, value)
}

function hasValidGitDirectorySync(gitDir: string): boolean {
  return hasValidCommonGitDirectorySync(gitDir) || hasValidLinkedWorktreeGitDirectorySync(gitDir)
}

function hasValidCommonGitDirectorySync(gitDir: string): boolean {
  try {
    return (
      statSync(join(gitDir, 'HEAD')).isFile() &&
      statSync(join(gitDir, 'objects')).isDirectory() &&
      statSync(join(gitDir, 'refs')).isDirectory()
    )
  } catch {
    return false
  }
}

function hasValidLinkedWorktreeGitDirectorySync(gitDir: string): boolean {
  try {
    if (!statSync(join(gitDir, 'HEAD')).isFile() || !statSync(join(gitDir, 'commondir')).isFile()) {
      return false
    }
    const commonDir = resolveGitMetadataPath(
      gitDir,
      readFileSync(join(gitDir, 'commondir'), 'utf8')
    )
    return commonDir !== null && hasValidCommonGitDirectorySync(commonDir)
  } catch {
    return false
  }
}

function hasValidBareRepoMarkerSync(path: string): boolean {
  return hasValidCommonGitDirectorySync(path) && !gitConfigDeclaresNonBare(path)
}

function gitConfigDeclaresNonBare(gitDir: string): boolean {
  try {
    const config = readFileSync(join(gitDir, 'config'), 'utf8')
    let inCoreSection = false
    for (const line of config.split(/\r?\n/)) {
      const section = line.match(/^\s*\[([^\]]+)\]/)
      if (section) {
        inCoreSection = section[1].trim().toLowerCase() === 'core'
        continue
      }
      const bare = line.match(/^\s*bare\s*=\s*(.*?)\s*$/i)
      if (inCoreSection && bare) {
        return isGitBooleanFalse(normalizeGitConfigValue(bare[1]))
      }
    }
    return false
  } catch {
    return false
  }
}

function normalizeGitConfigValue(value: string): string {
  const unescaped = stripGitConfigInlineComment(value).trim().replace(/\\"/g, '"')
  if (
    unescaped.length >= 2 &&
    ((unescaped.startsWith('"') && unescaped.endsWith('"')) ||
      (unescaped.startsWith("'") && unescaped.endsWith("'")))
  ) {
    return unescaped.slice(1, -1)
  }
  return unescaped
}

function stripGitConfigInlineComment(value: string): string {
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' || char === ';') {
      return value.slice(0, i)
    }
  }
  return value
}

function isGitBooleanFalse(value: string): boolean {
  return ['', 'false', 'no', 'off', '0'].includes(value.toLowerCase())
}

/** Get a human-readable name for the repo from its path. */

export { DEFAULT_BASE_REF_PROBE_TIMEOUT_MS, gitExecOptions, DEFAULT_BASE_REF_PROBES, resolveDefaultBaseRefFromProbes, isGitRepo, warnedMarkerFallbackThisSession, probeGitRepo, getGitRepoRoot, canonicalizeGitDirPath, getLinkedWorktreeMainRepoRoot, normalizeGitRepoRootForInputPath, scanGitMarkerSync, resolveRealPathSync, scanGitMarkerAncestorsSync, ancestorDirectories, isInsideDotGitMarker, pathsReferToSameEntry, scanWorktreeMarkerSync, parseGitdirFile, resolveGitMetadataPath, hasValidGitDirectorySync, hasValidCommonGitDirectorySync, hasValidLinkedWorktreeGitDirectorySync, hasValidBareRepoMarkerSync, gitConfigDeclaresNonBare, normalizeGitConfigValue, stripGitConfigInlineComment, isGitBooleanFalse }
export { type LocalGitExecOptions, type LocalDefaultBaseRefGitOptions, type GitRepoProbeResult, type GitMarkerScanResult }

