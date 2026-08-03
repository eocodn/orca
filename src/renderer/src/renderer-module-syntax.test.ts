import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

describe('renderer module syntax boundaries', () => {
  it.each([
    'src/renderer/src/app-shell-page-orchestration.tsx',
    'src/renderer/src/components/browser-pane/browser-pane-remote-model-values.tsx'
  ])('parses %s with its JSX-aware module extension', (relativePath) => {
    const filePath = resolve(repositoryRoot, relativePath)
    const source = ts.createSourceFile(
      filePath,
      readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )

    expect(
      source.parseDiagnostics.map(
        (diagnostic) =>
          `${diagnostic.start}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\\n')}`
      )
    ).toEqual([])
  })

  it.each([
    [
      'src/renderer/src/app-shell-page-view.tsx',
      './app-shell-page-orchestration',
      'src/renderer/src/app-shell-page-orchestration.tsx'
    ],
    [
      'src/renderer/src/components/browser-pane/browser-pane-remote-model-runtime-core.ts',
      './browser-pane-remote-model-values',
      'src/renderer/src/components/browser-pane/browser-pane-remote-model-values.tsx'
    ]
  ])('resolves %s -> %s to the JSX module boundary', (containingPath, specifier, targetPath) => {
    const containingFile = resolve(repositoryRoot, containingPath)
    const resolved = ts.resolveModuleName(
      specifier,
      containingFile,
      { moduleResolution: ts.ModuleResolutionKind.Bundler },
      ts.sys
    ).resolvedModule?.resolvedFileName

    expect(resolved).toBe(resolve(repositoryRoot, targetPath))
  })
})
