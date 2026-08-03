import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { transform } from 'esbuild'
import { describe, expect, it } from 'vitest'

const rendererModulePaths = [
  'app-shell-page-startup-effects.ts',
  'app-shell-page-shortcut-effects.ts',
  'components/browser-pane/browser-pane-surface.tsx'
]

describe('renderer parser module boundaries', () => {
  it.each(rendererModulePaths)('parses %s as a renderer module', async (relativePath) => {
    const sourcefile = resolve('src/renderer/src', relativePath)
    const source = await readFile(sourcefile, 'utf8')

    await expect(
      transform(source, {
        loader: extname(sourcefile) === '.tsx' ? 'tsx' : 'ts',
        sourcefile,
        format: 'esm'
      })
    ).resolves.toMatchObject({ code: expect.any(String) })
  })
})
