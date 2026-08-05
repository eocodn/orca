import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const projectPath = (relativePath) => resolve(projectRoot, relativePath)
const readProjectFile = (relativePath) => readFileSync(projectPath(relativePath), 'utf8')

describe('external plugin marketplace removal contract', () => {
  it('removes marketplace implementation and packaged resources', () => {
    for (const relativePath of [
      'src/main/ipc/plugin-marketplaces.ts',
      'src/main/plugins/plugin-marketplace-fetch.ts',
      'src/main/plugins/plugin-marketplace-installer.ts',
      'src/main/plugins/plugin-marketplace-projection.ts',
      'src/main/plugins/plugin-marketplace-provenance.ts',
      'src/main/plugins/plugin-marketplace-service.ts',
      'src/main/plugins/plugin-marketplace-store.ts',
      'src/shared/plugins/plugin-marketplace.ts',
      'resources/plugins/launch/orca-marketplace.json'
    ]) {
      expect(existsSync(projectPath(relativePath)), relativePath).toBe(false)
    }
  })

  it('removes marketplace API, IPC, startup, and renderer references', () => {
    for (const relativePath of [
      'src/preload/preload-api-app.ts',
      'src/preload/preload-api-contract-ui.ts',
      'src/preload/api-plugins.ts',
      'src/main/ipc/plugins.ts',
      'src/main/ipc/register-core-handlers.ts',
      'src/main/main-process-ready-plugin-lifecycle.ts',
      'src/main/main-process-shutdown-lifecycle.ts',
      'src/main/main-process-startup-dependencies.ts',
      'src/main/main-process-startup-state.ts',
      'src/main/main-process-window-startup-lifecycle.ts',
      'src/renderer/src/components/settings/PluginSettingsOverview.tsx',
      'src/renderer/src/components/settings/PluginsSettingsSection.tsx',
      'src/renderer/src/components/settings/PluginSettingsRow.tsx'
    ]) {
      expect(readProjectFile(relativePath), relativePath).not.toMatch(/marketplace/i)
    }
    expect(
      existsSync(projectPath('src/renderer/src/components/settings/PluginMarketplaceBrowser.tsx'))
    ).toBe(false)
  })

  it('retains bundled bootstrap and local/git plugin host paths', () => {
    expect(readProjectFile('src/main/plugins/plugin-bundled-bootstrap.ts')).toContain(
      'bootstrapBundledPlugins'
    )
    expect(readProjectFile('src/main/ipc/plugins.ts')).toContain("kind: z.literal('local-path')")
    expect(readProjectFile('src/main/ipc/plugins.ts')).toContain("kind: z.literal('git')")
    expect(readProjectFile('src/main/plugins/plugin-service.ts')).toContain('PluginService')
  })

  it('removes packaged marketplace verifier dependency', () => {
    expect(readProjectFile('config/scripts/verify-packaged-plugin-resources.cjs')).not.toMatch(
      /marketplace/i
    )
  })
})
