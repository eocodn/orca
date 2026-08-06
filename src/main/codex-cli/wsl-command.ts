import { buildPosixCommandPathLookupScript } from '../../shared/posix-command-path-lookup'
import {
  buildWslLoginShellCommand,
  escapeWslShCommandForWindows,
  quotePosixShell
} from '../../shared/wsl-login-shell-command'

export const WSL_CODEX_AVAILABILITY_TIMEOUT_MS = 5_000
export const WSL_CODEX_NOT_FOUND_MESSAGE = 'Codex CLI not found in the WSL login-shell PATH.'

export function buildWslCodexIdentityArgs(distro: string): string[] {
  const command = [
    buildCodexPathLookup(),
    'if [ -z "$resolved" ]; then',
    `  printf '%s\\n' '${WSL_CODEX_NOT_FOUND_MESSAGE}' >&2`,
    '  exit 127',
    'fi',
    'printf \'%s\\n\' "$resolved"',
    'exec "$resolved" --version'
  ].join('\n')
  return buildWslCodexShellArgs(distro, command)
}

export function buildWslCodexAppServerArgs(distro: string, linuxHomePath: string): string[] {
  const command = [
    buildCodexPathLookup(),
    'if [ -z "$resolved" ]; then',
    `  printf '%s\\n' '${WSL_CODEX_NOT_FOUND_MESSAGE}' >&2`,
    '  exit 127',
    'fi',
    `export CODEX_HOME=${quotePosixShell(linuxHomePath)}`,
    'exec "$resolved" app-server'
  ].join('\n')
  return buildWslCodexShellArgs(distro, command)
}

function buildCodexPathLookup(): string {
  return buildPosixCommandPathLookupScript({ kind: 'literal', value: 'codex' })
}

function buildWslCodexShellArgs(distro: string, command: string): string[] {
  return [
    '-d',
    distro,
    '--',
    'sh',
    '-c',
    escapeWslShCommandForWindows(buildWslLoginShellCommand(command))
  ]
}
