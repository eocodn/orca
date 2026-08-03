import { join } from 'node:path'
import type { BrowserSessionProfileSource } from '../../shared/types'

// Why: write the diag log to userData, not world-readable /tmp, so only the current user can read it.
import type { BrowserProfile } from './browser-cookie-import-pipeline-cookie-import-error-scan-max-chars-browser-profile'

export type DetectedBrowser = {
  family: BrowserSessionProfileSource['browserFamily']
  label: string
  cookiesPath: string
  keychainService?: string
  keychainAccount?: string
  profiles: BrowserProfile[]
  selectedProfile: string
}


export type ChromiumBrowserDef = {
  family: BrowserSessionProfileSource['browserFamily']
  label: string
  keychainService: string
  keychainAccount: string
  // Per-platform data-dir roots, resolved at detection time via browserRootPath().
  macRoot?: string
  winRoot?: string
  linuxRoot?: string
}


export const CHROMIUM_BROWSERS: ChromiumBrowserDef[] = [
  {
    family: 'chrome',
    label: 'Google Chrome',
    keychainService: 'Chrome Safe Storage',
    keychainAccount: 'Chrome',
    macRoot: 'Google/Chrome',
    winRoot: 'Google/Chrome/User Data',
    linuxRoot: 'google-chrome'
  },
  {
    family: 'edge',
    label: 'Microsoft Edge',
    keychainService: 'Microsoft Edge Safe Storage',
    keychainAccount: 'Microsoft Edge',
    macRoot: 'Microsoft Edge',
    winRoot: 'Microsoft/Edge/User Data',
    linuxRoot: 'microsoft-edge'
  },
  {
    family: 'arc',
    label: 'Arc',
    keychainService: 'Arc Safe Storage',
    keychainAccount: 'Arc',
    macRoot: 'Arc/User Data'
  },
  {
    family: 'chromium',
    label: 'Brave',
    keychainService: 'Brave Safe Storage',
    keychainAccount: 'Brave',
    macRoot: 'BraveSoftware/Brave-Browser',
    winRoot: 'BraveSoftware/Brave-Browser/User Data',
    linuxRoot: 'BraveSoftware/Brave-Browser'
  },
  {
    family: 'comet',
    label: 'Comet',
    keychainService: 'Comet Safe Storage',
    keychainAccount: 'Comet',
    macRoot: 'Comet',
    winRoot: 'Comet/User Data'
    // linuxRoot intentionally omitted — Comet does not ship a Linux build as of 2026-05-15
  },
  {
    family: 'helium',
    // Why: Helium breaks the '<Browser> Safe Storage' convention — its Keychain service is literally 'Helium Storage Key'.
    label: 'Helium',
    keychainService: 'Helium Storage Key',
    keychainAccount: 'Helium',
    macRoot: 'net.imput.helium'
    // winRoot/linuxRoot intentionally omitted — only the macOS install is verified
  }
]


export function browserRootPath(def: ChromiumBrowserDef): string | null {
  if (process.platform === 'darwin') {
    if (!def.macRoot) {
      return null
    }
    const home = process.env.HOME ?? ''
    return join(home, 'Library', 'Application Support', def.macRoot)
  }
  if (process.platform === 'win32') {
    if (!def.winRoot) {
      return null
    }
    const localAppData = process.env.LOCALAPPDATA ?? ''
    if (!localAppData) {
      return null
    }
    return join(localAppData, def.winRoot)
  }
  // Linux
  if (!def.linuxRoot) {
    return null
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? '', '.config')
  return join(configHome, def.linuxRoot)
}
