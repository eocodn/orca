import type { KeybindingActionId, KeybindingDefinition, KeybindingInput, KeybindingMatchOptions, KeybindingOverrides, KeybindingValidationResult, ModifierToken, NormalizeKeybindingOptions, PhysicalModifierToken, TerminalShortcutPolicy } from "./keybinding-contract"
import { DEFINITIONS_BY_ID, DIGIT_INDEX_KEY_PATTERN, getKeybindingPlatform, isDigitIndexActionId } from "./keybinding-registry"
import { canonicalizeDigitIndexBinding, canonicalizeParsedKeybinding, hasModifier, normalizeKeyToken, normalizeKeybindingWithOptions, normalizeOptionsForAction, parseKeybinding } from "./keybinding-parser"

const MODIFIER_KEYS = new Set([
  'Alt',
  'AltGraph',
  'Control',
  'Meta',
  'Shift',
  'OS',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'Symbol',
  'SymbolLock'
])

export const PUNCTUATION_KEY_TOKENS = new Set([
  'BracketLeft',
  'BracketRight',
  'Minus',
  'Underscore',
  'Equal',
  'Plus',
  'Comma',
  'Period',
  'Slash',
  'Backslash',
  'Semicolon',
  'Quote',
  'Backquote'
])

const PHYSICAL_CODE_FALLBACK_KEYS = new Set(['', 'Dead', 'Unidentified'])

const SHIFTED_PUNCTUATION_KEY_TOKENS: Record<string, string> = {
  '<': 'Comma',
  '>': 'Period',
  '?': 'Slash',
  '|': 'Backslash',
  ':': 'Semicolon',
  '"': 'Quote',
  '~': 'Backquote'
}

export function logicalKeyTokenFromInput(input: KeybindingInput): string | null {
  const key = input.key ?? ''
  if (MODIFIER_KEYS.has(key)) {
    return null
  }
  const normalizedKey = normalizeKeyToken(key)
  if (normalizedKey) {
    return normalizedKey
  }
  if (hasModifier(input, 'shift')) {
    return SHIFTED_PUNCTUATION_KEY_TOKENS[key] ?? null
  }
  return null
}

function canUsePhysicalCodeFallback(input: KeybindingInput): boolean {
  // Why: layout-aware shortcuts trust real logical keys; physical code is only a fallback when the platform can't report the produced key.
  return PHYSICAL_CODE_FALLBACK_KEYS.has(input.key ?? '')
}

function isLatinShortcutKey(key: string): boolean {
  // Why: A-Z / 0-9 are the only chars a Latin shortcut names; a non-Latin char (Cyrillic с, Greek π) is never a Latin remap, so physical-code fallback is safe.
  if (key.length !== 1) {
    return false
  }
  const upper = key.toUpperCase()
  return (upper >= 'A' && upper <= 'Z') || (key >= '0' && key <= '9')
}

function shouldUseNonLatinShortcutPhysicalFallback(
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  // Why: non-Latin layouts report non-Latin logical keys for physical letters (#6274), breaking Ctrl/Meta shortcuts; fall back to the physical code.
  if (getKeybindingPlatform(platform) === 'darwin') {
    return false
  }
  const hasPrimaryModifier = hasModifier(input, 'control') || hasModifier(input, 'meta')
  if (!hasPrimaryModifier) {
    return false
  }
  // AltGr surfaces as Ctrl+Alt on Windows/Linux; treat it as text, not a chord.
  if (hasModifier(input, 'control') && hasModifier(input, 'alt')) {
    return false
  }
  if (logicalKeyTokenFromInput(input) !== null) {
    return false
  }
  const key = input.key ?? ''
  return key !== '' && !MODIFIER_KEYS.has(key) && !isLatinShortcutKey(key)
}

export function canFallBackToPhysicalCode(input: KeybindingInput, platform: NodeJS.Platform): boolean {
  return (
    canUsePhysicalCodeFallback(input) || shouldUseNonLatinShortcutPhysicalFallback(input, platform)
  )
}

export function physicalCodeKeyTokenFromInput(input: KeybindingInput): string | null {
  const code = input.code ?? ''
  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3).toUpperCase()
  }
  if (code.startsWith('Digit') && code.length === 6) {
    return code.slice(5)
  }

  return normalizeKeyToken(code)
}

export function numpadCodeKeyTokenFromInput(input: KeybindingInput): string | null {
  const code = input.code ?? ''
  return code === 'NumpadAdd' || code === 'NumpadSubtract' ? normalizeKeyToken(code) : null
}

function shouldUseMacOptionComposedCaptureFallback(
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  // Why: macOS Option+key reports composed characters (Option+C -> ç), so capturing Alt shortcuts needs the physical-code fallback.
  if (
    getKeybindingPlatform(platform) !== 'darwin' ||
    !hasModifier(input, 'alt') ||
    MODIFIER_KEYS.has(input.key ?? '')
  ) {
    return false
  }
  const physicalToken = physicalCodeKeyTokenFromInput(input)
  if (!physicalToken) {
    return false
  }
  return (
    (physicalToken.length === 1 && physicalToken >= 'A' && physicalToken <= 'Z') ||
    isPunctuationKeyToken(physicalToken)
  )
}

function keyTokenFromInput(input: KeybindingInput, platform: NodeJS.Platform): string | null {
  const numpadKey = numpadCodeKeyTokenFromInput(input)
  if (numpadKey) {
    return numpadKey
  }
  const logicalKey = logicalKeyTokenFromInput(input)
  if (logicalKey) {
    return logicalKey
  }
  if (
    !canUsePhysicalCodeFallback(input) &&
    !shouldUseMacOptionComposedCaptureFallback(input, platform) &&
    !shouldUseNonLatinShortcutPhysicalFallback(input, platform)
  ) {
    return null
  }
  return physicalCodeKeyTokenFromInput(input)
}

// Why: the platform primary modifier canonicalizes to Mod (Cmd on macOS / Ctrl elsewhere), mirroring normal capture.
function canonicalDoubleTapToken(
  modifier: PhysicalModifierToken,
  platform: NodeJS.Platform
): ModifierToken {
  const isMac = platform === 'darwin'
  if (modifier === 'Cmd' && isMac) {
    return 'Mod'
  }
  if (modifier === 'Ctrl' && !isMac) {
    return 'Mod'
  }
  return modifier
}

function keybindingFromInputWithOptions(
  input: KeybindingInput,
  platform: NodeJS.Platform,
  options: NormalizeKeybindingOptions = {}
): KeybindingValidationResult {
  if (input.doubleTapModifier) {
    return normalizeKeybindingWithOptions(
      `DoubleTap+${canonicalDoubleTapToken(input.doubleTapModifier, platform)}`,
      options
    )
  }
  const key = keyTokenFromInput(input, platform)
  if (!key) {
    return { ok: false, error: 'Press a key, not only a modifier.' }
  }

  const isMac = getKeybindingPlatform(platform) === 'darwin'
  const parts: string[] = []
  const primaryModifierPressed = isMac ? hasModifier(input, 'meta') : hasModifier(input, 'control')
  if (primaryModifierPressed) {
    parts.push('Mod')
  }
  if (isMac && hasModifier(input, 'control')) {
    parts.push('Ctrl')
  }
  if (!isMac && hasModifier(input, 'meta')) {
    parts.push('Cmd')
  }
  if (hasModifier(input, 'alt')) {
    parts.push('Alt')
  }
  if (hasModifier(input, 'shift')) {
    parts.push('Shift')
  }
  parts.push(key)

  return normalizeKeybindingWithOptions(parts.join('+'), options)
}

export function keybindingFromInput(
  input: KeybindingInput,
  platform: NodeJS.Platform
): KeybindingValidationResult {
  return keybindingFromInputWithOptions(input, platform)
}

export function keybindingFromInputForAction(
  actionId: KeybindingActionId,
  input: KeybindingInput,
  platform: NodeJS.Platform
): KeybindingValidationResult {
  const result = keybindingFromInputWithOptions(
    input,
    platform,
    normalizeOptionsForAction(actionId)
  )
  if (!result.ok || !isDigitIndexActionId(actionId)) {
    return result
  }
  return canonicalizeDigitIndexBinding(result.value)
}

function getDefaultBindings(definition: KeybindingDefinition, platform: NodeJS.Platform): string[] {
  return definition.defaultBindings[getKeybindingPlatform(platform)].map((binding) => {
    const normalized = normalizeKeybindingWithOptions(binding, {
      allowBareKeybindings: definition.allowBareKeybindings === true,
      allowShiftOnlyKeybindings: definition.allowShiftOnlyKeybindings === true
    })
    return normalized.ok ? normalized.value : binding
  })
}

export function getEffectiveKeybindingsForAction(
  actionId: KeybindingActionId,
  platform: NodeJS.Platform,
  overrides?: KeybindingOverrides
): string[] {
  const definition = DEFINITIONS_BY_ID.get(actionId)
  const override = overrides?.[actionId]
  if (Array.isArray(override)) {
    // Why: canonicalize digit-index overrides to <mods>+1 so display/conflict stay consistent even if a hand-edited file stored a different digit.
    if (isDigitIndexActionId(actionId)) {
      const canonical: string[] = []
      for (const binding of override) {
        const normalized = canonicalizeDigitIndexBinding(binding)
        if (normalized.ok && !canonical.includes(normalized.value)) {
          canonical.push(normalized.value)
        }
      }
      return canonical
    }
    return override.flatMap((binding) => {
      const normalized = normalizeKeybindingWithOptions(
        binding,
        normalizeOptionsForAction(actionId)
      )
      return normalized.ok ? [normalized.value] : []
    })
  }
  return definition ? getDefaultBindings(definition, platform) : []
}

export function getEffectiveKeybindingsForDefinition(
  definition: KeybindingDefinition,
  platform: NodeJS.Platform,
  overrides?: KeybindingOverrides
): string[] {
  const override = overrides?.[definition.id]
  if (Array.isArray(override)) {
    return getEffectiveKeybindingsForAction(definition.id, platform, overrides)
  }
  return getDefaultBindings(definition, platform)
}

export function getKeybindingDefinition(actionId: KeybindingActionId): KeybindingDefinition | null {
  return DEFINITIONS_BY_ID.get(actionId) ?? null
}

export function normalizeTerminalShortcutPolicy(
  policy: TerminalShortcutPolicy | null | undefined
): TerminalShortcutPolicy {
  return policy === 'terminal-first' ? 'terminal-first' : 'orca-first'
}

export function isKeybindingAllowedInTerminal(definition: KeybindingDefinition): boolean {
  return definition.scope === 'terminal' || definition.allowInTerminal === true
}

export function isKeybindingPotentialTerminalConflict(definition: KeybindingDefinition): boolean {
  return definition.scope !== 'terminal' && definition.allowInTerminal !== true
}

export function keybindingIsActiveInContext(
  definition: KeybindingDefinition,
  options: KeybindingMatchOptions = {}
): boolean {
  if (options.context !== 'terminal') {
    return true
  }
  // Why: Orca-first keeps app shortcuts inside terminals; terminal-first is the escape hatch for shells and TUIs.
  if (normalizeTerminalShortcutPolicy(options.terminalShortcutPolicy) === 'orca-first') {
    return true
  }
  return isKeybindingAllowedInTerminal(definition)
}
