import { describe, expect, it } from 'vitest'
import { createPtyConnectionLiveDataAdmissionController } from './pty-connection-live-data-admission-controller'
import type { PtyDataMeta } from './pty-dispatcher'

function createHarness(
  options: { current?: boolean; deferred?: boolean; backpressure?: boolean } = {}
) {
  const calls: string[] = []
  const current = options.current ?? true
  const deferred = options.deferred ?? false
  const backpressure = options.backpressure ?? false
  const controller = createPtyConnectionLiveDataAdmissionController({
    isGenerationCurrent: (generation) => {
      calls.push(`current:${generation}`)
      return current
    },
    deferLiveData: (data, _meta, generation) => {
      calls.push(`defer:${data}:${generation}`)
      return deferred
    },
    markTerminalOutputActivity: () => calls.push('terminal-activity'),
    recordHibernationOutput: () => calls.push('hibernation-output'),
    observeAgentOutputActivity: () => calls.push('agent-output'),
    scanSshShellReady: (data) => {
      calls.push(`ssh-scan:${data}`)
      return data.includes('<ready>')
        ? { matched: true, output: data.replace('<ready>', '') }
        : { matched: false, output: data }
    },
    markSshStartupShellReady: () => calls.push('ssh-ready'),
    observeStartupDraftReadiness: (data) => calls.push(`startup:${data}`),
    resetHiddenRestoreIfPtyChanged: () => calls.push('restore-identity'),
    observeLiveMode2031: (data) => calls.push(`mode2031:${data}`),
    isForegroundRestoreBackpressureContext: () => {
      calls.push('backpressure-context')
      return backpressure
    },
    noteForegroundRestoreBackpressure: () => calls.push('backpressure-note'),
    markHiddenRestoreNeeded: () => calls.push('restore-needed'),
    salvageDiscardedQueries: (data) => calls.push(`salvage:${data}`)
  })

  return { calls, controller }
}

describe('createPtyConnectionLiveDataAdmissionController', () => {
  it('rejects a stale stream before any defer or output side effects', () => {
    const state = createHarness({ current: false })

    expect(state.controller.admit('stale', undefined, 7)).toEqual({ action: 'stop' })
    expect(state.calls).toEqual(['current:7'])
  })

  it('stops deferred reattach bytes before output activity is observed', () => {
    const state = createHarness({ deferred: true })

    expect(state.controller.admit('deferred', undefined, 2)).toEqual({ action: 'stop' })
    expect(state.calls).toEqual(['current:2', 'defer:deferred:2'])
  })

  it('records output evidence before stripping and observing an SSH shell-ready marker', () => {
    const state = createHarness()

    expect(state.controller.admit('hello<ready>world', undefined, 3)).toEqual({
      action: 'continue',
      data: 'helloworld',
      meta: undefined
    })
    expect(state.calls).toEqual([
      'current:3',
      'defer:hello<ready>world:3',
      'terminal-activity',
      'hibernation-output',
      'agent-output',
      'ssh-scan:hello<ready>world',
      'ssh-ready',
      'startup:helloworld',
      'restore-identity',
      'mode2031:helloworld'
    ])
  })

  it('latches foreground restore backpressure and continues past a dropped-output sentinel', () => {
    const state = createHarness({ backpressure: true })
    const meta: PtyDataMeta = { droppedOutput: true }

    expect(state.controller.admit('live', meta, 4)).toEqual({
      action: 'continue',
      data: 'live',
      meta
    })
    expect(state.calls).toContain('backpressure-note')
    expect(state.calls).not.toContain('restore-needed')
    expect(state.calls).not.toContain('salvage:live')
  })

  it('marks an ordinary dropped gap for restore, salvages query bytes, and stops delivery', () => {
    const state = createHarness({ backpressure: false })
    const meta: PtyDataMeta = { droppedOutput: true, background: true }

    expect(state.controller.admit('query-bytes', meta, 5)).toEqual({ action: 'stop' })
    expect(state.calls.slice(-2)).toEqual(['restore-needed', 'salvage:query-bytes'])
    expect(state.calls).not.toContain('backpressure-note')
  })
})
