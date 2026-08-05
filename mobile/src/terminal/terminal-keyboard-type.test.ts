import { describe, expect, it } from 'vitest'
import {
  getTerminalCommandKeyboardType,
  getTerminalLiveInputKeyboardType
} from './terminal-keyboard-type'

describe('terminal keyboard type', () => {
  it('uses the Android system keyboard for live terminal input', () => {
    expect(getTerminalLiveInputKeyboardType('android')).toBe('default')
  })

  it('uses the Android system keyboard for buffered command input', () => {
    expect(getTerminalCommandKeyboardType('android', false)).toBe('default')
    expect(getTerminalCommandKeyboardType('android', true)).toBe('default')
  })
})
