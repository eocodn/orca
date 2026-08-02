import { createHash } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const RESTRICTED_ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'CODEX_HOME',
  'ORCA_CODEX_HOME',
  'ORCA_CODEX_SYSTEM_DEFAULT_REAL_HOME',
  'ORCA_E2E_HOME_DIR',
  'ORCA_E2E_USER_DATA_DIR',
  'ORCA_USER_DATA_PATH',
  'ZDOTDIR',
  'ORCA_ORIG_ZDOTDIR',
  'BASH_ENV',
  'ENV',
  'ELECTRON_RUN_AS_NODE'
]
function samePath(left, right) {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function isWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function resolveRealPath(candidate) {
  try {
    return await realpath(candidate)
  } catch {
    // Why: containment guards must still run for paths that do not exist yet.
    return candidate
  }
}

export function createValidationEnv(inheritedEnv, layout, options = {}) {
  const env = { ...inheritedEnv }
  for (const key of RESTRICTED_ENV_KEYS) {
    delete env[key]
  }
  return {
    ...env,
    HOME: layout.homeDir,
    USERPROFILE: layout.homeDir,
    NODE_ENV: 'development',
    ORCA_E2E_HOME_DIR: layout.homeDir,
    ORCA_E2E_USER_DATA_DIR: layout.userDataDir,
    ORCA_USER_DATA_PATH: layout.userDataDir,
    // Why: flag OFF pins every codex spawn to an explicit managed CODEX_HOME,
    // so native codex never resolves the OS profile — the only Windows
    // configuration where strict zero-event containment is reachable. It also
    // exercises the emergency kill-switch lane users fall back to.
    ORCA_CODEX_SYSTEM_DEFAULT_REAL_HOME: options.systemDefaultRealHome === 'off' ? '0' : '1'
  }
}

export async function createValidationLayout(options = {}) {
  const primaryHome = path.resolve(options.primaryHome ?? os.homedir())
  const envTempParent = process.env.ORCA_CODEX_VALIDATION_TEMP_PARENT?.trim()
  const tempParent = path.resolve(options.tempParent ?? (envTempParent || os.tmpdir()))
  // Why: guards must compare canonical paths — a symlinked temp parent must
  // not smuggle the disposable root inside the primary home.
  const [primaryHomeReal, tempParentReal] = await Promise.all([
    resolveRealPath(primaryHome),
    resolveRealPath(tempParent)
  ])
  // Why: on Windows the default %TEMP% lives inside %USERPROFILE%, which the
  // disposable-home guard below rightly refuses. Fail before creating anything
  // and point at the overrides instead of aborting with an opaque guard error.
  if (samePath(tempParentReal, primaryHomeReal) || isWithin(tempParentReal, primaryHomeReal)) {
    throw new Error(
      `Refusing to place the disposable validation root inside the primary home (${primaryHome}). ` +
        'Pass --temp-parent <dir> or set ORCA_CODEX_VALIDATION_TEMP_PARENT to a directory outside it.'
    )
  }
  const tempRoot = await mkdtemp(path.join(tempParent, 'orca-codex-real-'))
  const homeDir = path.join(tempRoot, 'home')
  const userDataDir = path.join(tempRoot, 'user-data')
  await Promise.all([
    mkdir(homeDir, { recursive: true, mode: 0o700 }),
    mkdir(userDataDir, { recursive: true, mode: 0o700 })
  ])
  const homeDirReal = await resolveRealPath(homeDir)
  if (samePath(primaryHomeReal, homeDirReal) || isWithin(homeDirReal, primaryHomeReal)) {
    throw new Error('Refusing to place the disposable validation home inside the primary home')
  }
  return { primaryHome, tempRoot, homeDir, userDataDir }
}

async function seedCompletedProfile(layout) {
  // Why: the validation is about account routing, so first-run education and
  // telemetry overlays must not obscure the account controls under test.
  const profile = {
    settings: {
      telemetry: {
        optedIn: true,
        installId: '00000000-0000-4000-8000-000000000000',
        existedBeforeTelemetryRelease: false
      }
    },
    onboarding: { flowVersion: 2, closedAt: 1, outcome: 'completed', lastCompletedStep: 3 },
    ui: { contextualToursAutoEligible: false, projectOrderManualDefaultNoticeDismissed: true }
  }
  await writeFile(
    path.join(layout.userDataDir, 'orca-data.json'),
    `${JSON.stringify(profile, null, 2)}\n`
  )
}

async function installCodexConfigTemplate(layout, templatePath) {
  if (!templatePath) {
    return
  }
  const resolvedTemplate = await realpath(path.resolve(templatePath))
  const primaryCodexHome = path.join(layout.primaryHome, '.codex')
  // Why: validation must never bootstrap itself from the user's live Codex
  // configuration, even when a caller passes that path accidentally.
  if (isWithin(resolvedTemplate, primaryCodexHome)) {
    throw new Error('Refusing to copy a config template from the primary ~/.codex')
  }
  await mkdir(path.join(layout.homeDir, '.codex'), { recursive: true, mode: 0o700 })
  await copyFile(resolvedTemplate, path.join(layout.homeDir, '.codex', 'config.toml'))
}

async function fingerprintFile(filePath) {
  try {
    const stat = await lstat(filePath)
    if (!stat.isFile()) {
      return { exists: true, type: stat.isSymbolicLink() ? 'symlink' : 'other' }
    }
    const contents = await readFile(filePath)
    return {
      exists: true,
      type: 'file',
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: createHash('sha256').update(contents).digest('hex')
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false }
    }
    throw error
  }
}

async function inventoryTree(rootPath) {
  const entries = []
  async function visit(absolutePath, relativePath) {
    const stat = await lstat(absolutePath)
    const type = stat.isDirectory()
      ? 'directory'
      : stat.isFile()
        ? 'file'
        : stat.isSymbolicLink()
          ? 'symlink'
          : 'other'
    entries.push({ path: relativePath || '.', type, size: stat.size, mtimeMs: stat.mtimeMs })
    if (type !== 'directory') {
      return
    }
    const children = await readdir(absolutePath)
    children.sort((left, right) => left.localeCompare(right))
    for (const child of children) {
      await visit(
        path.join(absolutePath, child),
        relativePath ? path.join(relativePath, child) : child
      )
    }
  }
  try {
    await visit(rootPath, '')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }
    throw error
  }
  return entries
}

async function snapshotManagedHomes(userDataDir) {
  const accountsRoot = path.join(userDataDir, 'codex-accounts')
  let accountNames = []
  try {
    accountNames = (await readdir(accountsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
  return Promise.all(
    accountNames.map(async (accountId) => {
      const homePath = path.join(accountsRoot, accountId, 'home')
      return {
        accountId,
        homePath,
        inventory: await inventoryTree(homePath),
        auth: await fingerprintFile(path.join(homePath, 'auth.json'))
      }
    })
  )
}

export async function snapshotValidationState(layout) {
  const throwawayCodexHome = path.join(layout.homeDir, '.codex')
  return {
    capturedAt: new Date().toISOString(),
    throwawayCodex: {
      auth: await fingerprintFile(path.join(throwawayCodexHome, 'auth.json')),
      config: await fingerprintFile(path.join(throwawayCodexHome, 'config.toml')),
      hooks: await fingerprintFile(path.join(throwawayCodexHome, 'hooks.json'))
    },
    managedHomes: await snapshotManagedHomes(layout.userDataDir),
    sharedRuntimeAuth: await fingerprintFile(
      path.join(layout.userDataDir, 'codex-runtime-home', 'home', 'auth.json')
    )
  }
}

