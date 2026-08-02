import { CJK_LATIN_SPACED_TERMS } from './locale-cjk-latin-spaced-terms.mjs'
import { isLocalizedProseTermContext } from './locale-prose-term-exemptions.mjs'
import { isScreenCursorContext } from './locale-screen-cursor-exemptions.mjs'
import { LOCALE_KEY_OVERRIDES } from './locale-key-overrides.mjs'
import { LOCALE_PHRASE_FIXES } from './locale-phrase-fixes.mjs'
import { SEARCH_KEYWORD_OVERRIDES } from './locale-search-keyword-overrides.mjs'
import { LOCALE_VALUE_OVERRIDES } from './locale-value-overrides.mjs'

export { LOCALE_KEY_OVERRIDES } from './locale-key-overrides.mjs'
export { LOCALE_PHRASE_FIXES } from './locale-phrase-fixes.mjs'
export { SEARCH_KEYWORD_OVERRIDES } from './locale-search-keyword-overrides.mjs'
export { LOCALE_VALUE_OVERRIDES } from './locale-value-overrides.mjs'

import {
  ENGLISH_ONLY_KEY_PREFIXES,
  NEVER_TRANSLATE_VALUES,
  BRAND_MISTRANSLATIONS,
  NATIVE_PICKER_LABELS
} from './locale-translation-policy-data.mjs'

export {
  ENGLISH_ONLY_KEY_PREFIXES,
  NEVER_TRANSLATE_VALUES,
  BRAND_MISTRANSLATIONS,
  NATIVE_PICKER_LABELS
} from './locale-translation-policy-data.mjs'

const CJK_LATIN_SPACED_TERM_PATTERN = CJK_LATIN_SPACED_TERMS.join('|')
export function isEnglishOnlyKey(key) {
  return ENGLISH_ONLY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

export function shouldPreserveEnglishValue(enValue, key = '') {
  if (!enValue?.trim()) {
    return true
  }
  if (/^https?:\/\//.test(enValue) || enValue.startsWith('orca://')) {
    return true
  }
  if (isEnglishOnlyKey(key)) {
    return true
  }
  return NEVER_TRANSLATE_VALUES.has(enValue)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function includesPreservedLatinTerm(value, term) {
  if (!/^[A-Za-z_]+$/.test(term)) {
    return value.includes(term)
  }
  return new RegExp(`(^|[^A-Za-z_])${escapeRegExp(term)}($|[^A-Za-z_])`).test(value)
}

function applyBrandMistranslationFixes(enValue, localeValue, locale, key = '') {
  let result = localeValue
  const mistranslations = BRAND_MISTRANSLATIONS[locale] ?? {}

  for (const [brand, wrongForms] of Object.entries(mistranslations).sort(
    ([left], [right]) => right.length - left.length
  )) {
    if (!includesPreservedLatinTerm(enValue, brand)) {
      continue
    }
    // Why: terminal/theme "Cursor" labels name the on-screen カーソル, not the Cursor product —
    // skip the revert so カーソル survives for these settings.
    if (isScreenCursorContext(brand, enValue, key)) {
      continue
    }
    if (isLocalizedProseTermContext(brand, key)) {
      continue
    }
    if (includesPreservedLatinTerm(result, brand)) {
      continue
    }
    for (const wrong of wrongForms) {
      if (!result.includes(wrong)) {
        continue
      }
      // Why: "Copy identifier" legitimately uses 사본/复制 — only swap when English names the brand.
      if (brand === 'Codex' && /\bCopy\b/i.test(enValue)) {
        continue
      }
      result = result.replaceAll(wrong, brand)
    }
  }

  return result
}

function applyCjkLatinTermSpacing(localeValue, locale) {
  // Why: CJK UI copy should keep protected Latin workflow terms readable when MT glues them to native text.
  let result = localeValue
    .replace(
      new RegExp(
        `(${CJK_LATIN_SPACED_TERM_PATTERN})([\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af])`,
        'g'
      ),
      '$1 $2'
    )
    .replace(
      new RegExp(
        `([\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af])(${CJK_LATIN_SPACED_TERM_PATTERN})`,
        'g'
      ),
      '$1 $2'
    )
    .replace(
      new RegExp(`(${CJK_LATIN_SPACED_TERM_PATTERN})(${CJK_LATIN_SPACED_TERM_PATTERN})`, 'g'),
      '$1 $2'
    )
  if (locale === 'ko') {
    // Korean particles attach to the noun (no space) only when the particle is a complete token at a
    // boundary — re-glue "Orca 에"/"PR 을"/"에서는" but keep "Jira 이슈"/"Orca 로고"/"agent 에뮬레이터".
    result = result.replace(
      new RegExp(
        `(${CJK_LATIN_SPACED_TERM_PATTERN}) ((?:에서|에게|에는|에선|으로|로서|로써|부터|까지|보다|처럼|은|는|이|가|을|를|와|과|의|에|로|도|만)+)(?=$|[\\s.,!?…·:;)\\]}"'」』])`,
        'g'
      ),
      '$1$2'
    )
  }
  return result
}

function phraseFixMatchesEnglish(enValue, fix) {
  // Why: `whenEnMatches` (a RegExp) lets a rule guard on a real token (e.g. /\bPRs?\b/)
  // instead of the looser case-insensitive `whenEnIncludes` substring, so a phrase fix can
  // avoid firing on unrelated English that merely contains the substring (approve, preview).
  if (fix.whenEnMatches) {
    return fix.whenEnMatches.test(enValue)
  }
  return enValue.toLowerCase().includes(fix.whenEnIncludes.toLowerCase())
}

function applyPhraseFixes(enValue, localeValue, locale) {
  let result = localeValue
  for (const fix of LOCALE_PHRASE_FIXES[locale] ?? []) {
    if (!phraseFixMatchesEnglish(enValue, fix)) {
      continue
    }
    result = result.replace(fix.pattern, fix.replacement)
  }
  return result
}

export function repairTranslatedValue({ key, enValue, localeValue, locale }) {
  const keyOverride = LOCALE_KEY_OVERRIDES[key]?.[locale]
  if (keyOverride) {
    // Why: exact key overrides can still carry stale MT output, so glossary repairs remain the final gate.
    let result = applyBrandMistranslationFixes(enValue, keyOverride, locale, key)
    result = applyPhraseFixes(enValue, result, locale)
    if (['zh', 'ja', 'ko'].includes(locale)) {
      result = applyCjkLatinTermSpacing(result, locale)
    }
    return result
  }

  const valueOverride = LOCALE_VALUE_OVERRIDES[locale]?.[enValue]
  if (valueOverride) {
    let result = applyBrandMistranslationFixes(enValue, valueOverride, locale, key)
    result = applyPhraseFixes(enValue, result, locale)
    if (['zh', 'ja', 'ko'].includes(locale)) {
      result = applyCjkLatinTermSpacing(result, locale)
    }
    return result
  }

  if (shouldPreserveEnglishValue(enValue, key)) {
    return enValue
  }

  let result = localeValue

  if (key.includes('.search.')) {
    const searchOverride = SEARCH_KEYWORD_OVERRIDES[locale]?.[enValue]
    if (searchOverride) {
      result = searchOverride
    }
  }

  result = applyBrandMistranslationFixes(enValue, result, locale, key)
  result = applyPhraseFixes(enValue, result, locale)
  if (['zh', 'ja', 'ko'].includes(locale)) {
    result = applyCjkLatinTermSpacing(result, locale)
  }

  if (enValue.includes('orca://')) {
    result = result.replace(/虎鲸:\/\//g, 'orca://')
  }

  if (enValue === 'Orca' || enValue.startsWith('Orca ')) {
    result = result
      .replaceAll('虎鲸', 'Orca')
      .replaceAll('逆戟鲸', 'Orca')
      .replaceAll('シャチ', 'Orca')
  }

  if (enValue.includes('orca://')) {
    result = result.replace(/シャチ:\/\//g, 'orca://')
  }

  return result
}

export function collectStringLeaves(value, prefix = '', leaves = []) {
  if (typeof value === 'string') {
    leaves.push({ key: prefix, value })
    return leaves
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return leaves
  }
  for (const [key, child] of Object.entries(value)) {
    collectStringLeaves(child, prefix ? `${prefix}.${key}` : key, leaves)
  }
  return leaves
}

export function setLeaf(catalog, key, translatedValue) {
  const parts = key.split('.')
  let cursor = catalog
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor[parts[index]]
  }
  cursor[parts.at(-1)] = translatedValue
}

export function repairCatalog(enCatalog, localeCatalog, locale) {
  const leaves = collectStringLeaves(enCatalog)
  let repaired = 0

  for (const leaf of leaves) {
    const current = leaf.key.split('.').reduce((cursor, part) => cursor?.[part], localeCatalog)
    const next = repairTranslatedValue({
      key: leaf.key,
      enValue: leaf.value,
      localeValue: current,
      locale
    })
    if (next !== current) {
      setLeaf(localeCatalog, leaf.key, next)
      repaired += 1
    }
  }

  if (localeCatalog.settings?.appearance?.language) {
    for (const [labelKey, label] of Object.entries(NATIVE_PICKER_LABELS[locale] ?? {})) {
      if (localeCatalog.settings.appearance.language[labelKey] !== label) {
        localeCatalog.settings.appearance.language[labelKey] = label
        repaired += 1
      }
    }
  }

  if (localeCatalog.menu) {
    if (locale === 'zh') {
      if (localeCatalog.menu.exploreOrca !== '探索 Orca') {
        localeCatalog.menu.exploreOrca = '探索 Orca'
        repaired += 1
      }
      if (localeCatalog.menu.gettingStarted !== 'Orca 入门') {
        localeCatalog.menu.gettingStarted = 'Orca 入门'
        repaired += 1
      }
    }
    if (locale === 'ko') {
      if (localeCatalog.menu.exploreOrca !== 'Orca 둘러보기') {
        localeCatalog.menu.exploreOrca = 'Orca 둘러보기'
        repaired += 1
      }
      if (localeCatalog.menu.gettingStarted !== 'Orca 시작하기') {
        localeCatalog.menu.gettingStarted = 'Orca 시작하기'
        repaired += 1
      }
    }
  }

  return repaired
}

export function repairCacheMap(cache, locale) {
  let repaired = 0
  for (const [enValue, translated] of cache.entries()) {
    const next = shouldPreserveEnglishValue(enValue)
      ? enValue
      : repairTranslatedValue({
          key: '',
          enValue,
          localeValue: translated,
          locale
        })
    if (next !== translated) {
      cache.set(enValue, next)
      repaired += 1
    }
  }
  return repaired
}
