import type { PreloadApi } from './preload-api-runtime-context'
import { createPreloadApiUiBrowser } from './preload-api-ui-browser'
import { createPreloadApiUiState } from './preload-api-ui-state'
import { createPreloadApiUiTerminal } from './preload-api-ui-terminal'
import { createPreloadApiUiWindow } from './preload-api-ui-window'

export function createPreloadApiUi(): Record<string, unknown> {
  return {
    ui: {
      ...createPreloadApiUiState().ui,
      ...createPreloadApiUiBrowser().ui,
      ...createPreloadApiUiTerminal().ui,
      ...createPreloadApiUiWindow().ui
    } as PreloadApi['ui']
  }
}
