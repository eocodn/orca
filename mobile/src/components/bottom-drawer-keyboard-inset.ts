// Fill and content-sized sheets use the Android IME frame directly.

export function resolveBottomDrawerKeyboardInset(input: {
  keyboardHeight: number
  bottomInset: number
  fillAvailable: boolean
}): number {
  return Math.max(0, input.keyboardHeight)
}
