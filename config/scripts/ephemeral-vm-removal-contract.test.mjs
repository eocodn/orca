import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const sourceRoots = ['src', 'mobile', 'packages', 'docs', '.github', 'assets']
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
})
