import { app } from 'electron'
import { initializeReadyFoundation } from './main-process-ready-foundation'
import { initializeReadyPlugins } from './main-process-ready-plugin-lifecycle'
import { initializeReadyWindowAndServe } from './main-process-ready-window-serve-lifecycle'

export function installMainProcessReadyLifecycle(): void {
  void app.whenReady().then(async () => {
    await initializeReadyFoundation()
    await initializeReadyPlugins()
    await initializeReadyWindowAndServe()
  })
}
