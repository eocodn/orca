import { mergeLocaleKeyOverrides } from './locale-key-override-merge.mjs'
import firstLocaleKeyOverrides from './locale-key-overrides-catalog-first.mjs'
import secondLocaleKeyOverrides from './locale-key-overrides-catalog-second.mjs'

export const LOCALE_KEY_OVERRIDES = mergeLocaleKeyOverrides({
  ...firstLocaleKeyOverrides,
  ...secondLocaleKeyOverrides
})
