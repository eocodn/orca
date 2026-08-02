import type { PreloadApi } from '../../../preload/api-types'
import {
  findKeybindingConflicts,
  formatKeybindingList,
  getKeybindingPlatform,
  isKeybindingActionId,
  normalizeKeybindingArrayForAction,
  type KeybindingActionId,
  type KeybindingFileDiagnostic,
  type KeybindingFileSnapshot,
  type KeybindingOverrides,
  type KeybindingPlatform
} from '../../../shared/keybindings'
import { translate } from '@/i18n/i18n'

type WebKeybindingsApi = NonNullable<PreloadApi['keybindings']>
type WebKeybindingDocument = {
  version: 1
  keybindings: KeybindingOverrides
  platforms: Partial<Record<KeybindingPlatform, KeybindingOverrides>>
}

const KEYBINDINGS_STORAGE_KEY = 'orca.web.keybindings.v1'
const WEB_KEYBINDING_PLATFORMS: readonly KeybindingPlatform[] = ['darwin', 'linux', 'win32']
const webKeybindingListeners = new Set<(snapshot: KeybindingFileSnapshot) => void>()

function getBrowserPlatform(): 'darwin' | 'linux' | 'win32' {
  const platform = navigator.userAgent.toLowerCase()
  if (platform.includes('mac')) {
    return 'darwin'
  }
  if (platform.includes('win')) {
    return 'win32'
  }
  return 'linux'
}

function readStoredKeybindingDocument<T>(fallback: T): T {
  const raw = window.localStorage.getItem(KEYBINDINGS_STORAGE_KEY)
  if (raw === null) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeStoredKeybindingDocument(value: unknown): void {
  window.localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(value))
}

function createEmptyWebKeybindingDocument(): WebKeybindingDocument {
  return {
    version: 1,
    keybindings: {},
    platforms: {
      darwin: {},
      linux: {},
      win32: {}
    }
  }
}

function getWebKeybindingPlatform(): KeybindingPlatform {
  return getKeybindingPlatform(getBrowserPlatform())
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStoredWebOverrides(
  value: unknown,
  section: string,
  diagnostics: KeybindingFileDiagnostic[]
): KeybindingOverrides {
  if (value === undefined) {
    return {}
  }
  if (!isJsonObject(value)) {
    diagnostics.push({
      severity: 'error',
      section,
      message: translate('auto.web.web.preload.api.d2e43e426a', '{{value0}} must be an object.', {
        value0: section
      })
    })
    return {}
  }

  const overrides: KeybindingOverrides = {}
  for (const [actionId, rawBindings] of Object.entries(value)) {
    if (!isKeybindingActionId(actionId)) {
      diagnostics.push({
        severity: 'warning',
        section,
        actionId,
        message: translate(
          'auto.web.web.preload.api.36761d9604',
          'Unknown keybinding action "{{value0}}" was ignored.',
          { value0: actionId }
        )
      })
      continue
    }
    if (
      !Array.isArray(rawBindings) ||
      !rawBindings.every((binding) => typeof binding === 'string')
    ) {
      diagnostics.push({
        severity: 'error',
        section,
        actionId,
        message: translate(
          'auto.web.web.preload.api.10898045f3',
          'Shortcut for "{{value0}}" was ignored: Use a string array.',
          { value0: actionId }
        )
      })
      continue
    }
    const normalized = normalizeKeybindingArrayForAction(actionId, rawBindings)
    if (!Array.isArray(normalized)) {
      const error = normalized.ok ? 'Unable to parse shortcut.' : normalized.error
      diagnostics.push({
        severity: 'error',
        section,
        actionId,
        message: translate(
          'auto.web.web.preload.api.76122208ca',
          'Shortcut for "{{value0}}" was ignored: {{value1}}',
          { value0: actionId, value1: error }
        )
      })
      continue
    }
    overrides[actionId] = normalized
  }
  return overrides
}

function normalizeWebPlatformOverrides(
  value: unknown,
  diagnostics: KeybindingFileDiagnostic[]
): Partial<Record<KeybindingPlatform, KeybindingOverrides>> {
  if (value === undefined) {
    return {}
  }
  if (!isJsonObject(value)) {
    diagnostics.push({
      severity: 'error',
      section: 'platforms',
      message: translate(
        'auto.web.web.preload.api.0a69fcd8bc',
        'platforms must be an object with darwin, linux, or win32 sections.'
      )
    })
    return {}
  }

  const result: Partial<Record<KeybindingPlatform, KeybindingOverrides>> = {}
  for (const [platform, overrides] of Object.entries(value)) {
    if (!WEB_KEYBINDING_PLATFORMS.includes(platform as KeybindingPlatform)) {
      diagnostics.push({
        severity: 'warning',
        section: `platforms.${platform}`,
        message: translate(
          'auto.web.web.preload.api.32f15bdb0f',
          'Unknown platform "{{value0}}" was ignored.',
          { value0: platform }
        )
      })
      continue
    }
    result[platform as KeybindingPlatform] = normalizeStoredWebOverrides(
      overrides,
      `platforms.${platform}`,
      diagnostics
    )
  }
  return result
}

function removeConflictingWebOverrides(
  platform: KeybindingPlatform,
  overrides: KeybindingOverrides,
  diagnostics: KeybindingFileDiagnostic[]
): KeybindingOverrides {
  let next = { ...overrides }
  for (let attempt = 0; attempt < 20; attempt++) {
    const conflicts = findKeybindingConflicts(platform, next)
    const conflictingOverrides = new Set<KeybindingActionId>()
    for (const conflict of conflicts) {
      for (const actionId of conflict.actionIds) {
        if (Object.prototype.hasOwnProperty.call(next, actionId)) {
          conflictingOverrides.add(actionId)
        }
      }
    }
    if (conflictingOverrides.size === 0) {
      return next
    }
    for (const actionId of conflictingOverrides) {
      delete next[actionId]
    }
    diagnostics.push({
      severity: 'error',
      message: translate(
        'auto.web.web.preload.api.52bee9d8a0',
        'Conflicting custom shortcuts were ignored: {{value0}}.',
        {
          value0: Array.from(conflictingOverrides)
            .map((actionId) => actionId)
            .join(', ')
        }
      )
    })
  }
  return next
}

function readWebKeybindingDocument(): WebKeybindingDocument {
  const document = readStoredKeybindingDocument(createEmptyWebKeybindingDocument())
  return {
    version: 1,
    keybindings: isJsonObject(document.keybindings)
      ? (document.keybindings as KeybindingOverrides)
      : {},
    platforms: isJsonObject(document.platforms)
      ? (document.platforms as Partial<Record<KeybindingPlatform, KeybindingOverrides>>)
      : {}
  }
}

function getWebKeybindingSnapshot(): KeybindingFileSnapshot {
  const platform = getWebKeybindingPlatform()
  const diagnostics: KeybindingFileDiagnostic[] = []
  const document = readWebKeybindingDocument()
  const commonOverrides = normalizeStoredWebOverrides(
    document.keybindings,
    'keybindings',
    diagnostics
  )
  const platformOverrides = normalizeWebPlatformOverrides(document.platforms, diagnostics)
  const overrides = removeConflictingWebOverrides(
    platform,
    {
      ...commonOverrides,
      ...platformOverrides[platform]
    },
    diagnostics
  )

  return {
    path: 'Browser local storage',
    platform,
    exists: window.localStorage.getItem(KEYBINDINGS_STORAGE_KEY) !== null,
    overrides,
    commonOverrides,
    platformOverrides,
    diagnostics
  }
}

function writeWebKeybindingAction(
  actionId: KeybindingActionId,
  bindings: string[] | null
): KeybindingFileSnapshot {
  if (!isKeybindingActionId(actionId)) {
    throw new Error(`Unknown keybinding action "${String(actionId)}".`)
  }
  const normalizedBindings =
    bindings === null ? null : normalizeKeybindingArrayForAction(actionId, bindings)
  if (normalizedBindings !== null && !Array.isArray(normalizedBindings)) {
    throw new Error(normalizedBindings.ok ? 'Unable to parse shortcut.' : normalizedBindings.error)
  }

  const platform = getWebKeybindingPlatform()
  const currentSnapshot = getWebKeybindingSnapshot()
  const candidateOverrides = { ...currentSnapshot.overrides }
  if (normalizedBindings === null) {
    delete candidateOverrides[actionId]
  } else {
    candidateOverrides[actionId] = normalizedBindings
  }
  const blockingConflict = findKeybindingConflicts(platform, candidateOverrides).find((conflict) =>
    conflict.actionIds.includes(actionId)
  )
  if (blockingConflict) {
    throw new Error(
      `${formatKeybindingList([blockingConflict.binding], platform)} conflicts with another shortcut.`
    )
  }

  const activePlatform: KeybindingOverrides = { ...currentSnapshot.platformOverrides[platform] }
  if (normalizedBindings === null) {
    delete activePlatform[actionId]
  } else {
    activePlatform[actionId] = normalizedBindings
  }

  writeStoredKeybindingDocument({
    version: 1,
    keybindings: currentSnapshot.commonOverrides,
    platforms: {
      ...currentSnapshot.platformOverrides,
      darwin: currentSnapshot.platformOverrides.darwin ?? {},
      linux: currentSnapshot.platformOverrides.linux ?? {},
      win32: currentSnapshot.platformOverrides.win32 ?? {},
      [platform]: activePlatform
    }
  } satisfies WebKeybindingDocument)

  const snapshot = getWebKeybindingSnapshot()
  notifyWebKeybindingListeners(snapshot)
  return snapshot
}

function notifyWebKeybindingListeners(snapshot: KeybindingFileSnapshot): void {
  for (const listener of webKeybindingListeners) {
    listener(snapshot)
  }
}

export function createWebKeybindingsApi(): WebKeybindingsApi {
  return {
    get: () => Promise.resolve(getWebKeybindingSnapshot()),
    ensureFile: () => Promise.resolve(getWebKeybindingSnapshot()),
    setAction: async ({ actionId, bindings }) => writeWebKeybindingAction(actionId, bindings),
    reload: () => {
      const snapshot = getWebKeybindingSnapshot()
      notifyWebKeybindingListeners(snapshot)
      return Promise.resolve(snapshot)
    },
    openFile: () => Promise.resolve(getWebKeybindingSnapshot()),
    revealFile: () => Promise.resolve(getWebKeybindingSnapshot()),
    onChanged: (callback) => {
      webKeybindingListeners.add(callback)
      const onStorage = (event: StorageEvent): void => {
        if (event.key === KEYBINDINGS_STORAGE_KEY) {
          callback(getWebKeybindingSnapshot())
        }
      }
      window.addEventListener('storage', onStorage)
      return () => {
        webKeybindingListeners.delete(callback)
        window.removeEventListener('storage', onStorage)
      }
    }
  }
}
