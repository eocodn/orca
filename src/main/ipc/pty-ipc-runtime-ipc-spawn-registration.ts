import { ipcMain } from 'electron'
import type { RuntimePtyController } from '../runtime/orca-runtime-context-2'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import { createPtyIpcSpawnHandler } from './pty-ipc-runtime-ipc-spawn-execution'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'

export function installPtyIpcSpawnHandler(): void {
  const state = getPtyRegistrationSharedState() as PtyRendererDeliveryContext & Record<string, any>
  const spawn = createPtyIpcSpawnHandler(state)

  type PtySpawnArgs = Parameters<NonNullable<RuntimePtyController['spawn']>>[0]
  ipcMain.handle('pty:spawn', async (_event, args: Record<string, any>) =>
    spawn(args as PtySpawnArgs)
  )
}
