import type { AgentTabActionId, KeybindingActionId, KeybindingDefinition, KeybindingPlatform, PluginKeybindingActionId } from "./keybinding-contract"
import type { TuiAgent } from "./types"
import { KEYBINDING_DEFINITIONS } from "./keybinding-definitions"

export const LEGACY_TAB_SWITCH_BINDINGS: Readonly<Partial<Record<KeybindingActionId, string[]>>> = {
  'tab.nextSameType': ['Mod+Shift+BracketRight'],
  'tab.previousSameType': ['Mod+Shift+BracketLeft'],
  'tab.nextAllTypes': ['Mod+Alt+BracketRight'],
  'tab.previousAllTypes': ['Mod+Alt+BracketLeft']
}


export const DEFINITIONS_BY_ID = new Map<KeybindingActionId, KeybindingDefinition>(
  KEYBINDING_DEFINITIONS.map((definition) => [definition.id, definition])
)

export const DEFINITION_IDS = new Set<KeybindingActionId>(
  KEYBINDING_DEFINITIONS.map((definition) => definition.id)
)

// Why: these ids are single remappable rows whose chord is a representative — the digit canonicalizes to 1 but the binding fires for any 1-9.
export const DIGIT_INDEX_ACTION_IDS: readonly KeybindingActionId[] = [
  'tab.selectByIndex',
  'workspace.selectByIndex'
]

const DIGIT_INDEX_ACTION_ID_SET = new Set<KeybindingActionId>(DIGIT_INDEX_ACTION_IDS)

// The representative key for a digit-index chord is a single 1-9 number key.
export const DIGIT_INDEX_KEY_PATTERN = /^[1-9]$/

export function isDigitIndexActionId(actionId: KeybindingActionId): boolean {
  return DIGIT_INDEX_ACTION_ID_SET.has(actionId)
}


export function getKeybindingPlatform(platform: NodeJS.Platform): KeybindingPlatform {
  return platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux'
}

export function isKeybindingActionId(value: string): value is KeybindingActionId {
  return DEFINITION_IDS.has(value as KeybindingActionId) || isPluginKeybindingActionId(value)
}

export function isPluginKeybindingActionId(value: string): value is PluginKeybindingActionId {
  return (
    value.length <= 400 &&
    /^plugin:[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*\/[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(
      value
    )
  )
}
