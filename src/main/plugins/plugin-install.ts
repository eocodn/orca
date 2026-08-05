import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  PLUGIN_MANIFEST_FILENAME,
  isQualifiedPluginKey
} from '../../shared/plugins/plugin-manifest'
import {
  isAllowedPluginGitUrl,
  removePluginLock
} from '../../shared/plugins/plugin-install-lockfile'
import { readPluginLockfile, writePluginLockfile } from './plugin-install-lockfile-store'
import {
  inspectPluginInstallTree,
  installStagedPluginTree,
  type PluginInstallResult
} from './plugin-install-staging'
import { checkoutPluginGitSource } from './plugin-git-repository'
import { readPluginCurrentPointer } from './plugin-current-pointer'

export type { PluginInstallResult } from './plugin-install-staging'

export {
  PLUGIN_LOCKFILE_MAX_BYTES,
  pluginLockfilePath,
  readPluginLockfile
} from './plugin-install-lockfile-store'

/**
 * Plugin installer, v0 sources: local path + git URL `#ref`. Git operations
 * shell out to SYSTEM git (execFile, argv arrays — never a shell string, and
 * never a vendored checkout: private repos must work with the user's
 * existing credential helpers and SSH remotes). No script execution during
 * install, ever — the installer copies files, nothing more.
 *
 * Installs land in immutable hash-addressed dirs behind an atomic pointer
 * swap; the previous version dir is kept for one-step rollback.
 */

const pluginMutationChains = new Map<string, Promise<void>>()

async function serializePluginMutation<T>(
  pluginsDir: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = pluginMutationChains.get(pluginsDir) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(operation)
  const settled = run.then(
    () => undefined,
    () => undefined
  )
  pluginMutationChains.set(pluginsDir, settled)
  try {
    return await run
  } finally {
    if (pluginMutationChains.get(pluginsDir) === settled) {
      pluginMutationChains.delete(pluginsDir)
    }
  }
}

export async function installPluginFromLocalPath(input: {
  pluginsDir: string
  sourcePath: string
  hostVersion: string
  blockedPluginReason?: (pluginKey: string) => string | null
}): Promise<PluginInstallResult> {
  return serializePluginMutation(input.pluginsDir, async () => {
    if (!existsSync(join(input.sourcePath, PLUGIN_MANIFEST_FILENAME))) {
      return { ok: false, error: `no ${PLUGIN_MANIFEST_FILENAME} found in ${input.sourcePath}` }
    }
    return installStagedPluginTree({
      pluginsDir: input.pluginsDir,
      stagingDir: input.sourcePath,
      hostVersion: input.hostVersion,
      source: { kind: 'local-path', path: input.sourcePath },
      resolvedCommit: null,
      blockedPluginReason: input.blockedPluginReason
    })
  })
}

export async function installBundledPlugin(input: {
  pluginsDir: string
  sourcePath: string
  hostVersion: string
  expectedPluginKey: string
  blockedPluginReason?: (pluginKey: string) => string | null
}): Promise<PluginInstallResult> {
  return serializePluginMutation(input.pluginsDir, () =>
    installStagedPluginTree({
      pluginsDir: input.pluginsDir,
      stagingDir: input.sourcePath,
      hostVersion: input.hostVersion,
      source: { kind: 'bundled', bundleId: input.expectedPluginKey },
      resolvedCommit: null,
      expectedPluginKey: input.expectedPluginKey,
      repairCorruptedVersion: true,
      blockedPluginReason: input.blockedPluginReason
    })
  )
}

export async function installPluginFromGit(input: {
  pluginsDir: string
  url: string
  /** `#ref` suffix: branch, tag, or full commit SHA. Empty = default branch. */
  ref: string
  hostVersion: string
  blockedPluginReason?: (pluginKey: string) => string | null
}): Promise<PluginInstallResult> {
  if (!isAllowedPluginGitUrl(input.url)) {
    return { ok: false, error: 'plugin Git URL must use HTTPS or SSH' }
  }
  return serializePluginMutation(input.pluginsDir, async () => {
    const stagingDir = await mkdtemp(join(tmpdir(), 'orca-plugin-install-'))
    try {
      const ref = input.ref.trim()
      const resolvedCommit = await checkoutPluginGitSource({
        url: input.url,
        ref,
        destination: stagingDir,
        workingDirectory: tmpdir()
      })
      return await installStagedPluginTree({
        pluginsDir: input.pluginsDir,
        stagingDir,
        hostVersion: input.hostVersion,
        source: { kind: 'git', url: input.url, ref },
        resolvedCommit,
        blockedPluginReason: input.blockedPluginReason
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      await rm(stagingDir, { recursive: true, force: true })
    }
  })
}

/** Restores the single retained immutable predecessor. The old consent
 * fingerprint becomes current again, so enablement still fails closed until
 * the user has approved those exact bytes. */
/** Removes the install dir, the plugin's data dir, and the lock entry. */
export async function removeInstalledPlugin(input: {
  pluginsDir: string
  pluginsDataDir: string
  pluginKey: string
}): Promise<void> {
  await serializePluginMutation(input.pluginsDir, async () => {
    if (!isQualifiedPluginKey(input.pluginKey)) {
      throw new Error(`invalid qualified plugin key: ${input.pluginKey}`)
    }
    await removeResolvedPluginDirectory(input.pluginsDir, input.pluginKey)
    await removeResolvedPluginDirectory(input.pluginsDataDir, input.pluginKey)
    await writePluginLockfile(
      input.pluginsDir,
      removePluginLock(await readPluginLockfile(input.pluginsDir), input.pluginKey)
    )
  })
}

async function removeResolvedPluginDirectory(rootDir: string, pluginKey: string): Promise<void> {
  let rootReal: string
  let targetReal: string
  try {
    rootReal = await realpath(resolve(rootDir))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  try {
    targetReal = await realpath(resolve(rootDir, pluginKey))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  const fromRoot = relative(rootReal, targetReal)
  if (
    fromRoot.length === 0 ||
    isAbsolute(fromRoot) ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error(`refusing to remove plugin path outside ${rootReal}`)
  }
  await rm(resolve(rootDir, pluginKey), { recursive: true, force: true })
}
