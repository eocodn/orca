import { describe, expect, it } from 'vitest'
import { resolveBottomDrawerKeyboardInset } from './bottom-drawer-keyboard-inset'

describe('resolveBottomDrawerKeyboardInset', () => {
  it('uses the full keyboard frame for fill sheets', () => {
    expect(
      resolveBottomDrawerKeyboardInset({
        keyboardHeight: 336,
        bottomInset: 34,
        fillAvailable: true
      })
    ).toBe(336)
    expect(
      resolveBottomDrawerKeyboardInset({
        keyboardHeight: 300,
        bottomInset: 48,
        fillAvailable: true
      })
    ).toBe(300)
  })

  it('uses the keyboard frame for content-sized sheets', () => {
    expect(
      resolveBottomDrawerKeyboardInset({
        keyboardHeight: 336,
        bottomInset: 34,
        fillAvailable: false
      })
    ).toBe(336)
  })

  it('uses the full IME height for content-sized sheets', () => {
    expect(
      resolveBottomDrawerKeyboardInset({
        keyboardHeight: 300,
        bottomInset: 48,
        fillAvailable: false
      })
    ).toBe(300)
  })

  it('never returns a negative inset', () => {
    expect(
      resolveBottomDrawerKeyboardInset({
        keyboardHeight: -20,
        bottomInset: 34,
        fillAvailable: false
      })
    ).toBe(0)
  })
})
