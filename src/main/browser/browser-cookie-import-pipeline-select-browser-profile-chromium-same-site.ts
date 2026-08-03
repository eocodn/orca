import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { resolveChromiumCookiesPath } from './chromium-cookie-path'
import { type DetectedBrowser, CHROMIUM_BROWSERS, browserRootPath } from './browser-cookie-import-pipeline-detected-browser-browser-root-path'
import { isSafeBrowserProfileDirectory, firefoxProfilesRoot } from './browser-cookie-import-pipeline-is-safe-browser-profile-directory-discover-firefox-profiles'

export function selectBrowserProfile(
  browser: DetectedBrowser,
  profileDirectory: string
): DetectedBrowser | null {
  if (!isSafeBrowserProfileDirectory(profileDirectory)) {
    return null
  }
  if (browser.family === 'firefox') {
    const profilesRoot = firefoxProfilesRoot()
    if (!profilesRoot) {
      return null
    }
    const cookiesPath = join(profilesRoot, profileDirectory, 'cookies.sqlite')
    if (!existsSync(cookiesPath)) {
      return null
    }
    return { ...browser, cookiesPath, selectedProfile: profileDirectory }
  }

  const browserDef = CHROMIUM_BROWSERS.find((b) => b.family === browser.family)
  if (!browserDef) {
    return null
  }
  const root = browserRootPath(browserDef)
  if (!root) {
    return null
  }
  const profileDir = join(root, profileDirectory)
  const cookiesPath = resolveChromiumCookiesPath(profileDir)
  if (!cookiesPath) {
    return null
  }
  return {
    ...browser,
    cookiesPath,
    selectedProfile: profileDirectory
  }
}

// ---------------------------------------------------------------------------
// Cookie validation (shared between file import and direct import)
// ---------------------------------------------------------------------------

export type RawCookieEntry = {
  domain?: unknown
  name?: unknown
  value?: unknown
  path?: unknown
  secure?: unknown
  httpOnly?: unknown
  sameSite?: unknown
  expirationDate?: unknown
}

export type ValidatedCookie = {
  url: string
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  expirationDate: number | undefined
}

// Why: Chromium's CookieSameSiteForStorage enum (0=Unspecified,1=None,2=Lax,3=Strict) differs from Firefox's numbering.

export function chromiumSameSite(raw: number): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  switch (raw) {
    case 1:
      return 'no_restriction'
    case 2:
      return 'lax'
    case 3:
      return 'strict'
    default:
      return 'unspecified'
  }
}
