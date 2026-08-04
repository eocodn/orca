import type { BrowserManager } from './browser-manager'
import type { QueuedCommand, TabState } from './cdp-command-bridge-foundation'

import {
  CdpBridgeMethods1,
  type CdpBridgeMethods1Surface
} from './cdp-command-bridge-set-active-tab-get-page-info'
import {
  CdpBridgeMethods2,
  type CdpBridgeMethods2Surface
} from './cdp-command-bridge-snapshot-drag'
import {
  CdpBridgeMethods3,
  type CdpBridgeMethods3Surface
} from './cdp-command-bridge-upload-file-type'
import { CdpBridgeMethods4, type CdpBridgeMethods4Surface } from './cdp-command-bridge-select-check'
import {
  CdpBridgeMethods5,
  type CdpBridgeMethods5Surface
} from './cdp-command-bridge-focus-keypress'
import {
  CdpBridgeMethods6,
  type CdpBridgeMethods6Surface
} from './cdp-command-bridge-pdf-cookie-set'
import {
  CdpBridgeMethods7,
  type CdpBridgeMethods7Surface
} from './cdp-command-bridge-cookie-delete-intercept-enable'
import {
  CdpBridgeMethods8,
  type CdpBridgeMethods8Surface
} from './cdp-command-bridge-intercept-disable-capture-stop'
import {
  CdpBridgeMethods9,
  type CdpBridgeMethods9Surface
} from './cdp-command-bridge-console-log-reload'
import {
  CdpBridgeMethods10,
  type CdpBridgeMethods10Surface
} from './cdp-command-bridge-screenshot-tab-switch'
import {
  CdpBridgeMethods11,
  type CdpBridgeMethods11Surface
} from './cdp-command-bridge-on-tab-closed-get-registered-tabs'
import {
  CdpBridgeMethods12,
  type CdpBridgeMethods12Surface
} from './cdp-command-bridge-resolve-tab-id-remove-debugger-listeners'
import {
  CdpBridgeMethods13,
  type CdpBridgeMethods13Surface
} from './cdp-command-bridge-ensure-debugger-attached-resolve-ref'
import {
  CdpBridgeMethods14,
  type CdpBridgeMethods14Surface
} from './cdp-command-bridge-scroll-into-view-get-page-coordinates'
import {
  CdpBridgeMethods15,
  type CdpBridgeMethods15Surface
} from './cdp-command-bridge-try-recover-ref-wait-for-load'
import {
  CdpBridgeMethods16,
  type CdpBridgeMethods16Surface
} from './cdp-command-bridge-wait-for-network-idle-process-queue'

export * from './cdp-command-bridge-foundation'

export class CdpBridge {
  private activeWebContentsId: number | null = null
  private readonly tabState = new Map<string, TabState>()
  private readonly commandQueues = new Map<string, QueuedCommand[]>()
  private readonly processingQueues = new Set<string>()
  private readonly browserManager: BrowserManager

  constructor(browserManager: BrowserManager) {
    this.browserManager = browserManager
    void [
      this.activeWebContentsId,
      this.tabState,
      this.commandQueues,
      this.processingQueues,
      this.browserManager
    ]
  }
}
export interface CdpBridge extends CdpBridgeMethods1Surface, CdpBridgeMethods2Surface, CdpBridgeMethods3Surface, CdpBridgeMethods4Surface, CdpBridgeMethods5Surface, CdpBridgeMethods6Surface, CdpBridgeMethods7Surface, CdpBridgeMethods8Surface, CdpBridgeMethods9Surface, CdpBridgeMethods10Surface, CdpBridgeMethods11Surface, CdpBridgeMethods12Surface, CdpBridgeMethods13Surface, CdpBridgeMethods14Surface, CdpBridgeMethods15Surface, CdpBridgeMethods16Surface {}

Object.assign(
  CdpBridge.prototype,
  CdpBridgeMethods1,
  CdpBridgeMethods2,
  CdpBridgeMethods3,
  CdpBridgeMethods4,
  CdpBridgeMethods5,
  CdpBridgeMethods6,
  CdpBridgeMethods7,
  CdpBridgeMethods8,
  CdpBridgeMethods9,
  CdpBridgeMethods10,
  CdpBridgeMethods11,
  CdpBridgeMethods12,
  CdpBridgeMethods13,
  CdpBridgeMethods14,
  CdpBridgeMethods15,
  CdpBridgeMethods16
)

// Why: Input.dispatchKeyEvent needs `text` for keys with default actions (Enter/Tab), or Chrome skips the action.
type KeyDefinition = {
  key: string
  code: string
  windowsVirtualKeyCode?: number
  text?: string
}

const KEY_DEFINITIONS: Record<string, KeyDefinition> = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, text: '\t' },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }
}

export function resolveKeyDefinition(key: string): KeyDefinition {
  if (KEY_DEFINITIONS[key]) {
    return KEY_DEFINITIONS[key]
  }
  // Why: sites that check event.code drop events with invalid code values.
  if (key.length === 1) {
    const charCode = key.charCodeAt(0)
    if (charCode >= 48 && charCode <= 57) {
      return { key, code: `Digit${key}`, windowsVirtualKeyCode: charCode, text: key }
    }
    if ((charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122)) {
      return {
        key,
        code: `Key${key.toUpperCase()}`,
        windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
        text: key
      }
    }
    return { key, code: '', windowsVirtualKeyCode: charCode, text: key }
  }
  return { key, code: key }
}
