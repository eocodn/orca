import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const scopedFragmentNames = [
  'browser-guest-ui-mac-command-modifiers-guest-wheel-zoom-direction.ts',
  'browser-guest-ui-recent-guest-wheel-zoom-by-guest-has-modifier.ts',
  'browser-guest-ui-resolve-guest-mouse-wheel-zoom-direction-setup-guest-shortcut-forwarding.ts',
  'browser-guest-ui-resolve-renderer-control-modifiers.ts',
  'browser-guest-ui-setup-guest-mouse-wheel-zoom-forwarding-resolve-renderer-web-contents.ts',
  'browser-profile-discovery.ts',
  'browser-screencast-frame.ts',
  'browser-screencast-image-size.ts',
  'browser-screencast-runner.ts',
  'browser-screencast-stream.ts'
] as const

describe('browser split fragments', () => {
  it('typecheck without syntax errors or orphan declarations', () => {
    const configPath = join(process.cwd(), 'config/tsconfig.node.json')
    const config = ts.readConfigFile(configPath, (path) => readFileSync(path, 'utf8'))
    expect(config.error).toBeUndefined()

    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      dirname(configPath),
      { noEmit: true, noUnusedLocals: true, noUnusedParameters: true },
      configPath
    )
    const rootNames = scopedFragmentNames.map((name) =>
      join(process.cwd(), 'src/main/browser', name)
    )
    const program = ts.createProgram(rootNames, {
      ...parsed.options,
      composite: false,
      incremental: false,
      noEmit: true,
      noUnusedLocals: true,
      noUnusedParameters: true
    })
    const scopedFiles = new Set(rootNames)
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => (diagnostic.file ? scopedFiles.has(diagnostic.file.fileName) : false))

    const summary = diagnostics.map((diagnostic) => {
      const position = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
      return {
        code: diagnostic.code,
        file: diagnostic.file!.fileName,
        line: position.line + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
      }
    })

    expect(summary).toEqual([])
  })
})
