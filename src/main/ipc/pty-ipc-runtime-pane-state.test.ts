import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import { rememberPaneKeyForPty } from './pty-ipc-runtime-pane-state'

const PTY_ID = 'pty-pane-state'
const OLD_PANE_KEY = makePaneKey('tab-old', '11111111-1111-4111-8111-111111111111')
const NEW_PANE_KEY = makePaneKey('tab-new', '22222222-2222-4222-8222-222222222222')

describe('pty pane state', () => {
  beforeEach(() => {
    ptyRuntimeState.ptyPaneKey.clear()
    ptyRuntimeState.paneKeyPtyId.clear()
  })

  afterEach(() => {
    ptyRuntimeState.ptyPaneKey.clear()
    ptyRuntimeState.paneKeyPtyId.clear()
  })

  it('removes the old reverse mapping when a PTY is rebound to another pane', () => {
    expect(rememberPaneKeyForPty(PTY_ID, OLD_PANE_KEY)).toBe(OLD_PANE_KEY)
    expect(rememberPaneKeyForPty(PTY_ID, NEW_PANE_KEY)).toBe(NEW_PANE_KEY)

    expect(ptyRuntimeState.ptyPaneKey.get(PTY_ID)).toBe(NEW_PANE_KEY)
    expect(ptyRuntimeState.paneKeyPtyId.get(OLD_PANE_KEY)).toBeUndefined()
    expect(ptyRuntimeState.paneKeyPtyId.get(NEW_PANE_KEY)).toBe(PTY_ID)
  })

  it('keeps the prior PTY forward mapping when another PTY claims its pane', () => {
    const replacementPtyId = 'pty-pane-replacement'
    rememberPaneKeyForPty(PTY_ID, OLD_PANE_KEY)
    rememberPaneKeyForPty(replacementPtyId, OLD_PANE_KEY)

    expect(ptyRuntimeState.ptyPaneKey.get(PTY_ID)).toBe(OLD_PANE_KEY)
    expect(ptyRuntimeState.paneKeyPtyId.get(OLD_PANE_KEY)).toBe(replacementPtyId)
  })
})
