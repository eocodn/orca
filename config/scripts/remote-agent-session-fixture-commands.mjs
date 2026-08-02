import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function installFixtureAgent(targetDir, fixtureScript) {
  const nodePath = process.execPath
  if (process.platform === 'win32') {
    const commandPath = path.join(targetDir, 'codex.cmd')
    writeFileSync(commandPath, `@"${nodePath}" "${fixtureScript}" %*\r\n`)
    return commandPath
  }
  const commandPath = path.join(targetDir, 'codex')
  writeFileSync(
    commandPath,
    `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(fixtureScript)} "$@"\n`
  )
  chmodSync(commandPath, 0o755)
  return commandPath
}

export function quoteFixtureAgentCommand(commandPath, agentSessionToken) {
  return process.platform === 'win32'
    ? `"${commandPath.replaceAll('"', '""')}" ${agentSessionToken}`
    : `${shellQuote(commandPath)} ${agentSessionToken}`
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function fixtureCommand(scriptPath, markerPath) {
  if (process.platform === 'win32') {
    return [process.execPath, scriptPath, markerPath]
      .map((value) => `"${value.replaceAll('"', '""')}"`)
      .join(' ')
  }
  return [process.execPath, scriptPath, markerPath].map(shellQuote).join(' ')
}
