import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isOfficialPluginIdentity } from '../../shared/plugins/plugin-trust'
import { bootstrapBundledPlugins, resolveBundledPluginRoot } from './plugin-bundled-bootstrap'
import { inspectPluginInstallTree } from './plugin-install-staging'

const launchRoot = join(process.cwd(), 'resources', 'plugins', 'launch')
const temporaryRoots: string[] = []

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('Phase 1 launch plugin content', () => {
  it('lists and validates the release-indexed plugin packs', async () => {
    const index = (await readJson(join(launchRoot, 'bundled-plugins.json'))) as {
      plugins: { pluginKey: string; path: string }[]
    }
    const localPluginDirectories = (await readdir(launchRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(index.plugins.map((plugin) => plugin.path).sort()).toEqual(
      localPluginDirectories.filter((directory) =>
        index.plugins.some((plugin) => plugin.path === directory)
      )
    )

    const contributionKinds = new Set<string>()
    for (const listing of index.plugins) {
      const inspection = await inspectPluginInstallTree({
        rootDir: join(launchRoot, listing.path),
        hostVersion: '1.4.0',
        expectedPluginKey: listing.pluginKey
      })
      expect(
        inspection,
        `${listing.pluginKey} must pass the production install inspection`
      ).toMatchObject({
        ok: true
      })
      if (!inspection.ok) {
        continue
      }
      const contributes = inspection.manifest.contributes
      if (contributes.languagePacks.length > 0) {
        contributionKinds.add('language')
      }
      if (contributes.vmRecipes.length > 0) {
        contributionKinds.add('vm-recipe')
      }
      if (contributes.commands.length > 0 && contributes.keybindings.length > 0) {
        contributionKinds.add('command-keybinding')
      }
    }
    expect(contributionKinds).toEqual(new Set(['command-keybinding']))
  })

  it('publishes every bundled pack only when its release hash matches exact bytes', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'orca-launch-content-'))
    temporaryRoots.push(userDataPath)

    const result = await bootstrapBundledPlugins({
      root: launchRoot,
      userDataPath,
      hostVersion: '1.4.0'
    })

    expect(result.errors).toEqual([])
    expect(result.installed.length).toBeGreaterThanOrEqual(1)
    expect(result.installed.every(isOfficialPluginIdentity)).toBe(true)
  })

  it('boots release-indexed content from the packaged resources layout', async () => {
    const resourcesPath = await mkdtemp(join(tmpdir(), 'orca-packaged-resources-'))
    const userDataPath = await mkdtemp(join(tmpdir(), 'orca-packaged-user-data-'))
    temporaryRoots.push(resourcesPath, userDataPath)
    const packagedRoot = join(resourcesPath, 'plugins', 'launch')
    await cp(launchRoot, packagedRoot, { recursive: true })

    const result = await bootstrapBundledPlugins({
      root: resolveBundledPluginRoot({
        isPackaged: true,
        resourcesPath,
        appPath: join(resourcesPath, 'app.asar')
      }),
      userDataPath,
      hostVersion: '1.4.0'
    })

    expect(result.errors).toEqual([])
    expect(result.installed).toEqual(['stablyai.orca-navigation-shortcuts'])
  })
})
