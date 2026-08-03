import { dirname, relative, resolve, sep } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

const daemonFragmentFiles = [
  'daemon-health-core.ts',
  'daemon-process-identity.ts',
  'daemon-server-connections.ts',
  'daemon-server-foundation.ts',
  'daemon-server-protocol.ts',
  'daemon-server-shutdown.ts',
  'daemon-lifecycle-adoption-process.ts',
  'daemon-lifecycle-cleanup.ts',
  'daemon-lifecycle-event.ts',
  'daemon-lifecycle-init.ts',
  'daemon-lifecycle-launcher-process.ts',
  'daemon-lifecycle-manager.ts',
  'daemon-lifecycle-process.ts',
  'daemon-lifecycle-restart.ts',
  'daemon-lifecycle-state.ts',
  'daemon-lifecycle-support.ts'
]

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} ${message}`
}

describe('daemon fragment strict diagnostics', () => {
  it('has no syntax or unused declaration diagnostics', () => {
    const configPath = resolve('config/tsconfig.node.json')
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    expect(config.error).toBeUndefined()

    const parsedConfig = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      dirname(configPath),
      undefined,
      configPath
    )
    const daemonDirectory = resolve('src/main/daemon')
    const program = ts.createProgram({
      rootNames: daemonFragmentFiles.map((file) => resolve(daemonDirectory, file)),
      options: parsedConfig.options
    })
    const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
      .filter((diagnostic) => diagnostic.file !== undefined)
      .filter((diagnostic) => {
        const path = relative(resolve('.'), diagnostic.file!.fileName).split(sep).join('/')
        return path.startsWith('src/main/daemon/') && daemonFragmentFiles.includes(path.slice(16))
      })
      .map(formatDiagnostic)

    expect(diagnostics).toEqual([])
  })
})
