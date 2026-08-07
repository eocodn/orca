import { describe, expect, it, vi } from 'vitest'
import { preparePtyConnectionConnectPreflight } from './pty-connection-connect-preflight'

function createHarness() {
  let disposed = false
  let visible = true
  const fitPane = vi.fn()
  const readGrid = vi.fn(() => ({ cols: 80, rows: 24 }))
  const reportPtyError = vi.fn()
  const run = () =>
    preparePtyConnectionConnectPreflight({
      isDisposed: () => disposed,
      fitPane,
      readGrid,
      isVisible: () => visible,
      reportPtyError
    })
  return {
    fitPane,
    readGrid,
    reportPtyError,
    run,
    setDisposed(value: boolean) {
      disposed = value
    },
    setVisible(value: boolean) {
      visible = value
    }
  }
}

describe('preparePtyConnectionConnectPreflight', () => {
  it('does not fit or read a disposed pane', () => {
    const state = createHarness()
    state.setDisposed(true)

    expect(state.run()).toBeNull()
    expect(state.fitPane).not.toHaveBeenCalled()
    expect(state.readGrid).not.toHaveBeenCalled()
  })

  it('reports a visible zero grid but allows hidden zero-grid startup', () => {
    const state = createHarness()
    state.readGrid.mockReturnValue({ cols: 0, rows: 0 })

    expect(state.run()).toMatchObject({ cols: 0, rows: 0 })
    expect(state.reportPtyError).toHaveBeenCalledWith(
      'Terminal has zero dimensions (0×0). The pane container may not be visible.'
    )

    state.reportPtyError.mockClear()
    state.setVisible(false)
    expect(state.run()).toMatchObject({ cols: 0, rows: 0 })
    expect(state.reportPtyError).not.toHaveBeenCalled()
  })

  it('suppresses late and worktree-removal errors while delivering normal failures', () => {
    const state = createHarness()
    const preflight = state.run()
    expect(preflight).not.toBeNull()

    preflight?.reportError('connect failed')
    preflight?.reportError('Terminal cannot start while the worktree is being removed')
    state.setDisposed(true)
    preflight?.reportError('late failure')

    expect(state.reportPtyError).toHaveBeenCalledTimes(1)
    expect(state.reportPtyError).toHaveBeenCalledWith('connect failed')
  })
})
