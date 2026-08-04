import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8')

describe('feature-wall completion orchestration removal contract', () => {
it('feature-wall completion no longer depends on orchestration skill detection', () => {
  const source = read('src/renderer/src/components/feature-wall/feature-wall-completion-progress.ts')
  expect(source).not.toMatch(/orchestrationSkillInstalled/)
})

it('feature-wall completion hook and session depth omit orchestration skill state', () => {
  for (const path of [
    'src/renderer/src/components/feature-wall/use-feature-wall-completion.ts',
    'src/renderer/src/components/feature-wall/use-feature-wall-session-depth.ts'
  ]) {
    expect(read(path)).not.toMatch(/orchestrationSkillInstalled/)
  }
})

it('persisted agent completion does not restore the removed orchestration step', () => {
  expect(
    read('src/renderer/src/components/feature-wall/feature-wall-completion-persistence.ts'),
  ).not.toMatch(/\['statuses', 'usage', 'orchestration'\]/)
})
})