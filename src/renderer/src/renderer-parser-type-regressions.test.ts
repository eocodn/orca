import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const rendererRoot = resolve(repositoryRoot, 'src/renderer/src')

const targetFiles = [
  'components/browser-pane/browser-pane-surface.tsx',
  'components/activity/activity-prototype-page-orchestration.tsx',
  'components/settings/repository-hooks-surface.tsx',
  'components/settings/repository-hooks-model-repository-hooks-section-props.ts',
  'components/github-project/project-view-wrapper-view.tsx',
  'app-shell-page-startup-effects.ts'
] as const

function readTarget(relativePath: (typeof targetFiles)[number]): string {
  return readFileSync(resolve(rendererRoot, relativePath), 'utf8')
}

describe('remaining renderer parser/type boundaries', () => {
  it.each(targetFiles)('parses %s without syntax diagnostics', (relativePath) => {
    const fileName = resolve(rendererRoot, relativePath)
    const sourceFile = ts.createSourceFile(
      fileName,
      readTarget(relativePath),
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )

    expect(sourceFile.parseDiagnostics, relativePath).toEqual([])
  })

  it('typechecks every remaining renderer parser/type target', () => {
    const configPath = resolve(repositoryRoot, 'config/tsconfig.web.json')
    const config = ts.readConfigFile(configPath, (path) => readFileSync(path, 'utf8'))
    expect(config.error).toBeUndefined()

    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      dirname(configPath),
      { noEmit: true },
      configPath
    )
    const rootNames = targetFiles.map((relativePath) => resolve(rendererRoot, relativePath))
    const targetPaths = new Set(rootNames)
    const program = ts.createProgram(rootNames, {
      ...parsed.options,
      composite: false,
      incremental: false,
      noEmit: true
    })
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file && targetPaths.has(diagnostic.file.fileName))

    expect(
      diagnostics.map((diagnostic) => {
        const position = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
        return {
          code: diagnostic.code,
          file: diagnostic.file!.fileName,
          line: position.line + 1,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
        }
      })
    ).toEqual([])
  })

  it('preserves the split-boundary contracts that the parser accepts too leniently', () => {
    expect(readTarget('components/browser-pane/browser-pane-surface.tsx')).toContain(
      "import { RemoteBrowserPagePane } from './browser-pane-remote-surface';"
    )
    expect(readTarget('components/settings/repository-hooks-surface.tsx')).not.toMatch(
      /}\s+type\s+{/u
    )
    expect(
      readTarget('components/settings/repository-hooks-model-repository-hooks-section-props.ts')
    ).toContain(
      "from './repository-hooks-model-get-parse-error-fixes'"
    )
    expect(readTarget('components/github-project/project-view-wrapper-view.tsx')).toMatch(
      /const \{[^}]*\bloading\b[^}]*\} = controller/su
    )
    expect(readTarget('app-shell-page-startup-effects.ts')).toContain(
      '}, [actions, setOnboarding, setOnboardingLoaded])'
    )
  })
})
