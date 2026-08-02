import { resolveTerminalShortcutAction } from './terminal-shortcut-policy'
import type { TerminalShortcutPolicy } from '../../../../shared/keybindings'

export function resolveTerminalKeyboardShortcutAction(
  event: Parameters<typeof resolveTerminalShortcutAction>[0],
  isMac: Parameters<typeof resolveTerminalShortcutAction>[1],
  macOptionAsAlt: Parameters<typeof resolveTerminalShortcutAction>[2],
  optionKeyLocation: Parameters<typeof resolveTerminalShortcutAction>[3],
  isWindows: Parameters<typeof resolveTerminalShortcutAction>[4],
  keybindings: Parameters<typeof resolveTerminalShortcutAction>[5],
  isLocalWindowsConptyPane: Parameters<typeof resolveTerminalShortcutAction>[6],
  isKittyKeyboardActivePane: Parameters<typeof resolveTerminalShortcutAction>[7],
  layoutBaseCharacterForCode: Parameters<typeof resolveTerminalShortcutAction>[8],
  getWindowsShiftEnterEncoding: Parameters<typeof resolveTerminalShortcutAction>[9],
  isWindowsTerminalHost: NonNullable<Parameters<typeof resolveTerminalShortcutAction>[10]>,
  terminalShortcutPolicy: Parameters<typeof resolveTerminalShortcutAction>[11] = 'orca-first'
): ReturnType<typeof resolveTerminalShortcutAction> {
  // Keep the host callback required at this boundary; client OS bytes are not a safe fallback.
  return resolveTerminalShortcutAction(
    event,
    isMac,
    macOptionAsAlt,
    optionKeyLocation,
    isWindows,
    keybindings,
    isLocalWindowsConptyPane,
    isKittyKeyboardActivePane,
    layoutBaseCharacterForCode,
    getWindowsShiftEnterEncoding,
    isWindowsTerminalHost,
    terminalShortcutPolicy
  )
}
