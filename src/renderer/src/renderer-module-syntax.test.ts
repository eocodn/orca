import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

describe('renderer module syntax boundaries', () => {
  it.each([
    'src/renderer/src/app-shell-page-orchestration.tsx',
    'src/renderer/src/components/browser-pane/browser-pane-remote-model-values.tsx',
    'src/renderer/src/components/github-item-dialog-actions.tsx',
    'src/renderer/src/components/github-item-dialog-cache.ts',
    'src/renderer/src/components/github-item-dialog-checks.tsx',
    'src/renderer/src/components/github-item-dialog-comments.tsx',
    'src/renderer/src/components/github-item-dialog-content.tsx',
    'src/renderer/src/components/github-item-dialog-conversation.tsx',
    'src/renderer/src/components/github-item-dialog-edit.tsx',
    'src/renderer/src/components/github-item-dialog-files.tsx',
    'src/renderer/src/components/github-item-dialog-model.tsx',
    'src/renderer/src/components/github-item-dialog-mutations.ts',
    'src/renderer/src/components/github-item-dialog-reviewers.tsx',
    'src/renderer/src/components/github-item-dialog-source-indicator.tsx',
    'src/renderer/src/components/github-item-dialog-surface.tsx',
    'src/renderer/src/components/github-project/project-view-wrapper-view.tsx',
    'src/renderer/src/components/status-bar/workspace-space-manager-decision-model.ts',
    'src/renderer/src/hooks/use-composer-state-surface.ts',
    'src/renderer/src/hooks/use-ipc-events-surface.ts'
  ])('parses %s with its JSX-aware module extension', (relativePath) => {
    const filePath = resolve(repositoryRoot, relativePath)
    const source = ts.createSourceFile(
      filePath,
      readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )

    const parseDiagnostics = (
      source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
    ).parseDiagnostics

    expect(
      parseDiagnostics.map(
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
