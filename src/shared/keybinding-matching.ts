import type { KeybindingInput, KeybindingPlatform, ModifierToken, ParsedKeybinding, KeybindingActionId } from "./keybinding-contract"
import { getKeybindingPlatform } from "./keybinding-registry"
import { canonicalizeParsedKeybinding, parseKeybinding } from "./keybinding-parser"

export function platformModifiers(
  parsed: ParsedKeybinding,
  platform: NodeJS.Platform
): { meta: boolean; control: boolean; alt: boolean; shift: boolean } {
  const isMac = platform === 'darwin'
  return {
    meta: parsed.meta || (parsed.mod && isMac),
    control: parsed.control || (parsed.mod && !isMac),
    alt: parsed.alt,
    shift: parsed.shift
  }
}

export function modifierStateMatches(
  parsed: ParsedKeybinding,
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  const expected = platformModifiers(parsed, platform)
  return (
    hasModifier(input, 'meta') === expected.meta &&
    hasModifier(input, 'control') === expected.control &&
    hasModifier(input, 'alt') === expected.alt &&
    hasModifier(input, 'shift') === expected.shift
  )
}

export function shouldUseMacOptionLetterPhysicalFallback(
  parsed: ParsedKeybinding,
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  // Why: macOS Option+letter reports composed characters (Option+A -> å), leaving no logical Latin key for Alt shortcuts.
  return (
    getKeybindingPlatform(platform) === 'darwin' &&
    parsed.alt &&
    hasModifier(input, 'alt') &&
    logicalKeyTokenFromInput(input) === null
  )
}

export function shouldUseMacOptionPunctuationPhysicalFallback(
  parsed: ParsedKeybinding,
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  // Why: macOS Option+punctuation reports composed dead-key values, leaving no logical bracket token for Alt shortcuts.
  return (
    getKeybindingPlatform(platform) === 'darwin' &&
    parsed.alt &&
    hasModifier(input, 'alt') &&
    logicalKeyTokenFromInput(input) === null
  )
}

export function letterKeyMatches(
  input: KeybindingInput,
  letter: string,
  parsed: ParsedKeybinding,
  platform: NodeJS.Platform
): boolean {
  const logicalKey = logicalKeyTokenFromInput(input)
  if (logicalKey && logicalKey.length === 1 && logicalKey >= 'A' && logicalKey <= 'Z') {
    return logicalKey === letter.toUpperCase()
  }
  return (
    (canFallBackToPhysicalCode(input, platform) ||
      shouldUseMacOptionLetterPhysicalFallback(parsed, input, platform)) &&
    input.code === `Key${letter.toUpperCase()}`
  )
}

export function digitKeyMatches(
  input: KeybindingInput,
  digit: string,
  platform: NodeJS.Platform
): boolean {
  const logicalKey = logicalKeyTokenFromInput(input)
  if (logicalKey && logicalKey.length === 1 && logicalKey >= '0' && logicalKey <= '9') {
    return logicalKey === digit
  }
  return canFallBackToPhysicalCode(input, platform) && input.code === `Digit${digit}`
}

export function isPunctuationKeyToken(token: string | null): token is string {
  return token !== null && PUNCTUATION_KEY_TOKENS.has(token)
}

export function semanticPunctuationKey(input: KeybindingInput): string | null {
  const logicalKey = logicalKeyTokenFromInput(input)
  return isPunctuationKeyToken(logicalKey) ? logicalKey : null
}

export function physicalPunctuationKey(input: KeybindingInput): string | null {
  const physicalKey = physicalCodeKeyTokenFromInput(input)
  return isPunctuationKeyToken(physicalKey) ? physicalKey : null
}

export function shouldUseSemanticPunctuation(
  parsed: ParsedKeybinding,
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  // Why: Windows/Linux expose AltGr as Ctrl+Alt; don't turn international text input into Mod+Alt app shortcuts.
  if (
    getKeybindingPlatform(platform) !== 'darwin' &&
    parsed.mod &&
    parsed.alt &&
    hasModifier(input, 'control') &&
    hasModifier(input, 'alt') &&
    !hasModifier(input, 'meta') &&
    physicalPunctuationKey(input) === null
  ) {
    return false
  }
  return true
}

export function keyMatches(
  parsedKey: string,
  input: KeybindingInput,
  parsed: ParsedKeybinding,
  platform: NodeJS.Platform
): boolean {
  if (parsedKey.length === 1 && parsedKey >= 'A' && parsedKey <= 'Z') {
    return letterKeyMatches(input, parsedKey, parsed, platform)
  }
  if (parsedKey.length === 1 && parsedKey >= '0' && parsedKey <= '9') {
    return digitKeyMatches(input, parsedKey, platform)
  }

  if (parsedKey === 'NumpadAdd' || parsedKey === 'NumpadSubtract') {
    return (
      numpadCodeKeyTokenFromInput(input) === parsedKey ||
      logicalKeyTokenFromInput(input) === parsedKey
    )
  }

  if (isPunctuationKeyToken(parsedKey)) {
    // Why: shortcut labels name logical punctuation, but international layouts can report it from different physical codes.
    const semanticKey = semanticPunctuationKey(input)
    if (semanticKey !== null) {
      if (!shouldUseSemanticPunctuation(parsed, input, platform)) {
        return false
      }
      return semanticKey === parsedKey
    }
    return (
      (canFallBackToPhysicalCode(input, platform) ||
        shouldUseMacOptionPunctuationPhysicalFallback(parsed, input, platform)) &&
      physicalPunctuationKey(input) === parsedKey
    )
  }

  const logicalKey = logicalKeyTokenFromInput(input)
  if (logicalKey !== null) {
    return logicalKey === parsedKey
  }
  return (
    canFallBackToPhysicalCode(input, platform) && physicalCodeKeyTokenFromInput(input) === parsedKey
  )
}

export function resolveModifierToken(
  modifier: ModifierToken,
  platform: NodeJS.Platform
): 'meta' | 'control' | 'alt' | 'shift' {
  switch (modifier) {
    case 'Mod':
      return platform === 'darwin' ? 'meta' : 'control'
    case 'Cmd':
      return 'meta'
    case 'Ctrl':
      return 'control'
    case 'Alt':
      return 'alt'
    case 'Shift':
      return 'shift'
  }
}

export function keybindingMatchesInput(
  binding: string,
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  const parsed = parseKeybinding(binding)
  if (!parsed) {
    return false
  }
  // A double-tap binding matches only a synthetic double-tap input (and vice-versa), resolved per platform.
  if (parsed.doubleTapModifier) {
    return (
      input.doubleTapModifier !== undefined &&
      resolveModifierToken(parsed.doubleTapModifier, platform) ===
        resolveModifierToken(input.doubleTapModifier, platform)
    )
  }
  if (input.doubleTapModifier !== undefined) {
    return false
  }
  return (
    modifierStateMatches(parsed, input, platform) && keyMatches(parsed.key, input, parsed, platform)
  )
}

export function keybindingConflictIdentityForParsed(
  parsed: ParsedKeybinding,
  platform: NodeJS.Platform
): string {
  if (parsed.doubleTapModifier) {
    return `DoubleTap:${resolveModifierToken(parsed.doubleTapModifier, platform)}`
  }
  const modifiers = platformModifiers(parsed, platform)
  return [
    modifiers.meta ? 'Meta' : '',
    modifiers.control ? 'Control' : '',
    modifiers.alt ? 'Alt' : '',
    modifiers.shift ? 'Shift' : '',
    parsed.key
  ].join('+')
}

export function getKeybindingConflictIdentity(binding: string, platform: NodeJS.Platform): string {
  const parsed = parseKeybinding(binding)
  return parsed ? keybindingConflictIdentityForParsed(parsed, platform) : binding
}

function keybindingConflictIdentities(
  actionId: KeybindingActionId,
  binding: string,
  platform: NodeJS.Platform
): readonly string[] {
  const exact = getKeybindingConflictIdentity(binding, platform)
  if (!isDigitIndexActionId(actionId)) {
    return [exact]
  }
  const parsed = parseKeybinding(binding)
  if (!parsed || parsed.doubleTapModifier || !DIGIT_INDEX_KEY_PATTERN.test(parsed.key)) {
    return [exact]
  }
  return Array.from({ length: 9 }, (_, index) =>
    keybindingConflictIdentityForParsed({ ...parsed, key: String(index + 1) }, platform)
  )
}

export function keybindingMatchesAction(
  actionId: KeybindingActionId,
  input: KeybindingInput,
  platform: NodeJS.Platform,
  overrides?: KeybindingOverrides,
  options: KeybindingMatchOptions = {}
): boolean {
  const definition = DEFINITIONS_BY_ID.get(actionId)
  if (!definition) {
    return false
  }
  if (!keybindingIsActiveInContext(definition, options)) {
    return false
  }
  return getEffectiveKeybindingsForAction(actionId, platform, overrides).some((binding) =>
    keybindingMatchesInput(binding, input, platform)
  )
}

export function digitFromInput(input: KeybindingInput, platform: NodeJS.Platform): string | null {
  for (let value = 1; value <= 9; value++) {
    const digit = String(value)
    if (digitKeyMatches(input, digit, platform)) {
      return digit
    }
  }
  return null
}

// Why: a digit-index row's representative chord fires for any 1-9 — reuse its modifiers with the pressed digit via the normal matcher.
export function matchKeybindingDigitIndex(
  actionId: KeybindingActionId,
  input: KeybindingInput,
  platform: NodeJS.Platform,
  overrides?: KeybindingOverrides,
  options: KeybindingMatchOptions = {}
): number | null {
  const definition = DEFINITIONS_BY_ID.get(actionId)
  if (!definition || !keybindingIsActiveInContext(definition, options)) {
    return null
  }
  const digit = digitFromInput(input, platform)
  if (!digit) {
    return null
  }
  for (const binding of getEffectiveKeybindingsForAction(actionId, platform, overrides)) {
    const parsed = parseKeybinding(binding)
    if (!parsed || parsed.doubleTapModifier || !DIGIT_INDEX_KEY_PATTERN.test(parsed.key)) {
      continue
    }
    const candidate = canonicalizeParsedKeybinding({ ...parsed, key: digit })
    if (keybindingMatchesInput(candidate, input, platform)) {
      return Number(digit) - 1
    }
