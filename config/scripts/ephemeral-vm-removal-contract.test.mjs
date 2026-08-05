import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const sourceRoots = ['src', 'mobile', 'packages', 'docs', '.github', 'assets', 'resources']
const localeFiles = ['en', 'es', 'ja', 'ko', 'zh'].map((locale) =>
  join(root, 'src', 'renderer', 'src', 'i18n', 'locales', `${locale}.json`)
)
const removedLocaleKeys = new Set([
  'wakeEphemeralVmFailed',
  'ephemeralVmWorkspaceTarget',
  'ephemeralVm',
  'cloudVmWorkflow',
  'cloudVmWorkflowHelp',
  'EphemeralVmRecipeRow',
  'EphemeralVmRuntimesSection',
  'ephemeralVms',
  'EphemeralVmsPane',
  'ephemeralVmsExperimentalSetting',
  'PluginVmRecipeConsentPreview',
  'CloudVmSetupGuide'
])
const removedFileNames = [
  'ephemeral-vm',
  'cloud-vm',
  'CloudVm',
  'EphemeralVm',
  'vm.ts',
  'vm.test.ts'
]

function walk(path) {
  if (!existsSync(path)) return []
  const stat = statSync(path)
  if (stat.isFile()) return [path]
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    walk(join(path, entry.name))
  )
}

test('cloud and ephemeral VM production surfaces are removed', () => {
  const files = sourceRoots.flatMap((path) => walk(join(root, path)))
  const production = files.filter(
    (path) =>
      !path.includes('.test.') &&
      !path.endsWith('.d.ts') &&
      !path.includes('/renderer/src/i18n/locales/')
  )
  const stalePaths = production.filter((path) => {
    const name = path.split('/').at(-1) ?? ''
    return removedFileNames.some((token) => name.includes(token))
  })
  assert.deepEqual(stalePaths, [], stalePaths.map((path) => relative(root, path)).join('\n'))

  const staleReferences = production.flatMap((path) => {
    const text = readFileSync(path, 'utf8')
    return /ephemeral[ _-]?vm|cloud[ _-]?vm/i.test(text)
      ? [relative(root, path)]
      : []
  })
  assert.deepEqual(staleReferences, [], staleReferences.join('\n'))

  for (const path of localeFiles) {
    const locale = JSON.parse(readFileSync(path, 'utf8'))
    const staleKeys = []
    const visit = (value) => {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        if (removedLocaleKeys.has(key)) staleKeys.push(key)
        visit(child)
      }
    }
    visit(locale)
    assert.deepEqual(staleKeys, [], `${relative(root, path)}: ${staleKeys.join(', ')}`)
  }
})

test('cloud and ephemeral VM test surfaces are removed', () => {
  const files = sourceRoots
    .flatMap((path) => walk(join(root, path)))
    .filter(
      (path) =>
        (path.includes('.test.') || path.includes('.spec.')) && !path.endsWith('.d.ts')
    )
  const staleReferences = files.flatMap((path) => {
    const name = path.split('/').at(-1) ?? ''
    const text = readFileSync(path, 'utf8')
    return removedFileNames.some((token) => name.includes(token)) ||
      /ephemeral[ _-]?vm|cloud[ _-]?vm|vmRecipes?|environmentRecipes|OrcaVmRecipe/i.test(text)
      ? [relative(root, path)]
      : []
  })
  assert.deepEqual(staleReferences, [], staleReferences.join('\n'))
})
