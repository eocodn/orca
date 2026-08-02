import { describe, expect, it } from 'vitest'
import {
  exactDaemonIncarnationForPidRecord,
  isDaemonGoneError,
  isMissingTokenFileError,
  isMissingWindowsNamedPipeError
} from './daemon-pty-adapter-foundation'

function systemError(code: string, syscall: string): NodeJS.ErrnoException {
  const error = new Error(`${code} from ${syscall}`) as NodeJS.ErrnoException
  error.code = code
  error.syscall = syscall
  return error
}

describe('daemon PTY adapter split API', () => {
  it('keeps token-file ENOENT distinct from a dead socket', () => {
    expect(isMissingTokenFileError(systemError('ENOENT', 'open'))).toBe(true)
    expect(isMissingTokenFileError(systemError('ENOENT', 'connect'))).toBe(false)
    expect(isDaemonGoneError(systemError('ENOENT', 'connect'))).toBe(true)
  })

  it('recognizes missing Windows named pipes only on Windows', () => {
    const error = systemError('ENOENT', 'connect')
    expect(isMissingWindowsNamedPipeError(error)).toBe(process.platform === 'win32')
  })

  it('exposes exact daemon incarnation construction from the foundation API', () => {
    const identity = { pid: 42, startedAtMs: 123, launchNonce: 'nonce' }

    expect(
      exactDaemonIncarnationForPidRecord(identity, {
        pid: 42,
        startedAtMs: 123,
        launchNonce: 'nonce',
        linuxStartTicks: '456',
        bootId: 'boot-id',
        entryPath: null,
        appVersion: null
      })
    ).toMatchObject({ identity })
  })
})
