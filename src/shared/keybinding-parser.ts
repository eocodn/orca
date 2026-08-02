import type { KeybindingActionId, KeybindingInput, KeybindingValidationResult, ModifierToken, NormalizeKeybindingOptions, ParsedKeybinding } from "./keybinding-contract"
import { DEFINITIONS_BY_ID, DIGIT_INDEX_KEY_PATTERN, isDigitIndexActionId } from "./keybinding-registry"

export function hasModifier(
  input: KeybindingInput,
  modifier: 'alt' | 'meta' | 'control' | 'shift'
): boolean {
  if (modifier === 'alt') {
    return Boolean(input.alt ?? input.altKey)
  }
  if (modifier === 'meta') {
    return Boolean(input.meta ?? input.metaKey)
  }
  if (modifier === 'control') {
    return Boolean(input.control ?? input.ctrlKey)
  }
  return Boolean(input.shift ?? input.shiftKey)
}

function isFunctionKeyToken(key: string): boolean {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
}

export function normalizeKeyToken(token: string): string | null {
  if (token === ' ') {
    return 'Space'
  }
  const trimmed = token.trim()
  if (!trimmed) {
    return null
  }
  const upper = trimmed.toUpperCase()
  if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
    return upper
  }
  if (upper.length === 1 && upper >= '0' && upper <= '9') {
    return upper
  }
  // Function keys F1–F24 (event.key/event.code report them verbatim, e.g. F7).
  if (isFunctionKeyToken(upper)) {
    return upper
  }

  const simple: Record<string, string> = {
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '{': 'BracketLeft',
    '}': 'BracketRight',
    '-': 'Minus',
    _: 'Underscore',
    '=': 'Equal',
    '+': 'Plus',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    '`': 'Backquote',
    RETURN: 'Enter',
    ESC: 'Escape',
    SPACEBAR: 'Space',
    PGUP: 'PageUp',
    PGDN: 'PageDown',
    PLUS: 'Plus',
    MINUS: 'Minus',
    EQUAL: 'Equal',
    UNDERSCORE: 'Underscore',
    ARROWLEFT: 'ArrowLeft',
    LEFT: 'ArrowLeft',
    ARROWRIGHT: 'ArrowRight',
    RIGHT: 'ArrowRight',
    ARROWUP: 'ArrowUp',
    UP: 'ArrowUp',
    ARROWDOWN: 'ArrowDown',
    DOWN: 'ArrowDown',
    PAGEUP: 'PageUp',
    PAGEDOWN: 'PageDown',
    BACKSPACE: 'Backspace',
    DELETE: 'Delete',
    DEL: 'Delete',
    INSERT: 'Insert',
    INS: 'Insert',
    ENTER: 'Enter',
    TAB: 'Tab',
    ESCAPE: 'Escape',
    SPACE: 'Space',
    BRACKETLEFT: 'BracketLeft',
    BRACKETRIGHT: 'BracketRight',
    NUMPADADD: 'NumpadAdd',
    NUMPADSUBTRACT: 'NumpadSubtract',
    ADD: 'NumpadAdd',
    SUBTRACT: 'NumpadSubtract',
    COMMA: 'Comma',
    PERIOD: 'Period',
    SLASH: 'Slash',
    BACKSLASH: 'Backslash',
    SEMICOLON: 'Semicolon',
    QUOTE: 'Quote',
    BACKQUOTE: 'Backquote'
  }

  return simple[upper] ?? null
}

function parseModifierToken(rawPart: string): ModifierToken | null {
  const part = rawPart.toLowerCase()
  if (part === 'mod' || part === 'cmdorctrl' || part === 'commandorcontrol') {
    return 'Mod'
  }
  if (part === 'cmd' || part === 'command' || part === 'meta' || rawPart === '⌘') {
    return 'Cmd'
  }
  if (part === 'ctrl' || part === 'control' || rawPart === '⌃') {
    return 'Ctrl'
  }
  if (part === 'alt' || part === 'option' || part === 'opt' || rawPart === '⌥') {
    return 'Alt'
  }
  if (part === 'shift' || rawPart === '⇧') {
    return 'Shift'
  }
  return null
}

function applyModifierToken(parsed: ParsedKeybinding, modifier: ModifierToken): void {
  if (modifier === 'Mod') {
    parsed.mod = true
  } else if (modifier === 'Cmd') {
    parsed.meta = true
  } else if (modifier === 'Ctrl') {
    parsed.control = true
  } else if (modifier === 'Alt') {
    parsed.alt = true
  } else {
    parsed.shift = true
  }
}

function emptyParsedKeybinding(): ParsedKeybinding {
  return { mod: false, meta: false, control: false, alt: false, shift: false, key: '' }
}

// Why: a double-tap is a bare modifier with no key, so it can't use the normal parse path; modifier validation is deferred to normalize.
function parseDoubleTapKeybinding(rawParts: string[]): ParsedKeybinding | null {
  const modifiers: ModifierToken[] = []
  let sawDoubleTap = false
  for (const rawPart of rawParts) {
    if (rawPart.toLowerCase() === 'doubletap') {
      if (sawDoubleTap) {
        return null
      }
      sawDoubleTap = true
      continue
    }
    const modifier = parseModifierToken(rawPart)
    if (!modifier) {
      return null
    }
    modifiers.push(modifier)
  }
  if (modifiers.length === 0) {
    return null
  }
  const parsed = emptyParsedKeybinding()
  for (const modifier of modifiers) {
    applyModifierToken(parsed, modifier)
  }
  // Keep both flags when Mod is combined with a platform modifier, so normalize emits the shared "Mod or platform-specific, not both" error.
  if (parsed.mod && (parsed.meta || parsed.control)) {
    parsed.doubleTapModifier = 'Mod'
    return parsed
  }
  if (modifiers.length > 1) {
    return null
  }
  parsed.doubleTapModifier = modifiers[0]
  return parsed
}

export function parseKeybinding(binding: string): ParsedKeybinding | null {
  const rawParts = binding
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (rawParts.length === 0) {
    return null
  }

  if (rawParts.some((part) => part.toLowerCase() === 'doubletap')) {
    return parseDoubleTapKeybinding(rawParts)
  }

  const parsed = emptyParsedKeybinding()
  for (const rawPart of rawParts) {
    const modifier = parseModifierToken(rawPart)
    if (modifier) {
      applyModifierToken(parsed, modifier)
      continue
    }
    if (parsed.key) {
      return null
    }
    const key = normalizeKeyToken(rawPart)
    if (!key) {
      return null
    }
    parsed.key = key
  }

  return parsed.key ? parsed : null
}

export function canonicalizeParsedKeybinding(parsed: ParsedKeybinding): string {
  if (parsed.doubleTapModifier) {
    return `DoubleTap+${parsed.doubleTapModifier}`
  }
  const parts: string[] = []
  if (parsed.mod) {
    parts.push('Mod')
  }
  if (parsed.meta) {
    parts.push('Cmd')
  }
  if (parsed.control) {
    parts.push('Ctrl')
  }
  if (parsed.alt) {
    parts.push('Alt')
  }
  if (parsed.shift) {
    parts.push('Shift')
  }
  parts.push(parsed.key)
  return parts.join('+')
}

function isSafeBareKey(parsed: ParsedKeybinding): boolean {
  if (parsed.mod || parsed.meta || parsed.control || parsed.alt) {
    return false
  }
  // Function keys produce no text, so they're safe bare or with Shift (Shift+letter stays unsafe).
  if (parsed.shift) {
    return isFunctionKeyToken(parsed.key)
  }
  return (
    isFunctionKeyToken(parsed.key) ||
    [
      'Backspace',
      'Delete',
      'Enter',
      'Escape',
      'Tab',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown'
    ].includes(parsed.key)
  )
}

export function normalizeKeybindingWithOptions(
  binding: string,
  options: NormalizeKeybindingOptions = {}
): KeybindingValidationResult {
  const parsed = parseKeybinding(binding)
  if (!parsed) {
    return { ok: false, error: 'Use a shortcut like Ctrl+Shift+P or Cmd+K.' }
  }
  if (parsed.mod && (parsed.meta || parsed.control)) {
    return { ok: false, error: 'Use either Mod or a platform-specific modifier, not both.' }
  }
  if (parsed.doubleTapModifier) {
    return { ok: true, value: canonicalizeParsedKeybinding(parsed) }
  }
  const isShiftInsert = parsed.shift && parsed.key === 'Insert'
  const isBareAllowed = options.allowBareKeybindings === true && isSafeBareKey(parsed)
  const isShiftOnlyAllowed =
    options.allowShiftOnlyKeybindings === true &&
    parsed.shift &&
    !parsed.mod &&
    !parsed.meta &&
    !parsed.control &&
    !parsed.alt
  if (
    !parsed.mod &&
    !parsed.meta &&
    !parsed.control &&
    !parsed.alt &&
    !isShiftInsert &&
    !isBareAllowed &&
    !isShiftOnlyAllowed
  ) {
    return { ok: false, error: 'Include at least one modifier key.' }
  }
  return { ok: true, value: canonicalizeParsedKeybinding(parsed) }
}

export function normalizeKeybinding(binding: string): KeybindingValidationResult {
  return normalizeKeybindingWithOptions(binding)
}

export function isDoubleTapBinding(binding: string): boolean {
  return Boolean(parseKeybinding(binding)?.doubleTapModifier)
}

function normalizeKeybindingListWithOptions(
  input: string,
  options: NormalizeKeybindingOptions = {}
): KeybindingValidationResult | string[] {
  const trimmed = input.trim()
  if (!trimmed) {
    return []
  }
  const normalized: string[] = []
  for (const piece of trimmed.split(',')) {
    const result = normalizeKeybindingWithOptions(piece, options)
    if (!result.ok) {
      return result
    }
    if (!normalized.includes(result.value)) {
      normalized.push(result.value)
    }
  }
  return normalized
}

export function normalizeKeybindingList(input: string): KeybindingValidationResult | string[] {
  return normalizeKeybindingListWithOptions(input)
}

function normalizeKeybindingArrayWithOptions(
  input: readonly string[],
  options: NormalizeKeybindingOptions = {}
): KeybindingValidationResult | string[] {
  const normalized: string[] = []
  for (const binding of input) {
    const piece = normalizeKeybindingListWithOptions(binding, options)
    if (!Array.isArray(piece)) {
      return piece
    }
    for (const normalizedBinding of piece) {
      if (!normalized.includes(normalizedBinding)) {
        normalized.push(normalizedBinding)
      }
    }
  }
  return normalized
}

export function normalizeOptionsForAction(actionId: KeybindingActionId): NormalizeKeybindingOptions {
  const definition = DEFINITIONS_BY_ID.get(actionId)
  return {
    allowBareKeybindings: definition?.allowBareKeybindings === true,
    allowShiftOnlyKeybindings: definition?.allowShiftOnlyKeybindings === true
  }
}

// Why: rewrite a digit-index chord's key to 1 so display and conflict detection stay stable across the 1-9 range; reject any non 1-9 key.
export function canonicalizeDigitIndexBinding(binding: string): KeybindingValidationResult {
  const parsed = parseKeybinding(binding)
  if (!parsed || parsed.doubleTapModifier || !DIGIT_INDEX_KEY_PATTERN.test(parsed.key)) {
    return {
      ok: false,
      error: 'Pick a number key 1–9 with a modifier, like Cmd+1 or Ctrl+1.'
    }
  }
  return { ok: true, value: canonicalizeParsedKeybinding({ ...parsed, key: '1' }) }
}

function finalizeDigitIndexBindings(
  actionId: KeybindingActionId,
  result: KeybindingValidationResult | string[]
): KeybindingValidationResult | string[] {
  if (!isDigitIndexActionId(actionId) || !Array.isArray(result)) {
    return result
  }
  const canonical: string[] = []
  for (const binding of result) {
    const normalized = canonicalizeDigitIndexBinding(binding)
    if (!normalized.ok) {
      return normalized
    }
    if (!canonical.includes(normalized.value)) {
      canonical.push(normalized.value)
    }
  }
  return canonical
}

export function normalizeKeybindingListForAction(
  actionId: KeybindingActionId,
  input: string
): KeybindingValidationResult | string[] {
  return finalizeDigitIndexBindings(
    actionId,
    normalizeKeybindingListWithOptions(input, normalizeOptionsForAction(actionId))
  )
}

export function normalizeKeybindingArrayForAction(
  actionId: KeybindingActionId,
  input: readonly string[]
): KeybindingValidationResult | string[] {
  return finalizeDigitIndexBindings(
    actionId,
    normalizeKeybindingArrayWithOptions(input, normalizeOptionsForAction(actionId))
  )
}
