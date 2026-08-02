import type { KeybindingDefinition } from "./keybinding-contract"

export function platformBindings(bindings: readonly string[]): KeybindingDefinition["defaultBindings"] {
  return { darwin: bindings, linux: bindings, win32: bindings }
}
