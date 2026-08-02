import { ipcMain } from 'electron'
import type { SshRepoReadoption, SshTarget } from '../../shared/ssh-types'
import {
  getCurrentMainWindow,
  removeRegisteredSshTarget,
  sshStore
} from './ssh-ipc-foundation'
import { rotateSshProviderAuthority } from '../ssh/ssh-provider-authority'

// Target metadata handlers also publish workspace re-adoption changes consumed by the renderer.
export function registerSshTargetHandlers(): void {
  function takeRepoReadoptions(): SshRepoReadoption[] {
    if (!sshStore || sshStore.lastRepoReadoptions.length === 0) {
      return []
    }
    const repoReadoptions = sshStore.lastRepoReadoptions
    sshStore.lastRepoReadoptions = []
    for (const targetId of new Set(
      repoReadoptions.flatMap(({ oldTargetId, newTargetId }) => [oldTargetId, newTargetId])
    )) {
      rotateSshProviderAuthority(targetId)
    }
    const win = getCurrentMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('repos:changed')
    }
    return repoReadoptions
  }

  ipcMain.handle('ssh:listTargets', () => {
    return sshStore!.listTargets()
  })

  ipcMain.handle('ssh:listRemovedTargetLabels', () => {
    return sshStore!.listRemovedTargetLabels()
  })

  ipcMain.handle('ssh:addTarget', (_event, args: { target: Omit<SshTarget, 'id'> }) => {
    const target = sshStore!.addTarget(args.target)
    // Why: re-adding a removed host can re-adopt orphaned workspaces; refresh the renderer's repo list so they move back onto the live host.
    const repoReadoptions = takeRepoReadoptions()
    return { target, repoReadoptions }
  })

  ipcMain.handle(
    'ssh:updateTarget',
    (_event, args: { id: string; updates: Partial<Omit<SshTarget, 'id'>> }) => {
      return sshStore!.updateTarget(args.id, args.updates)
    }
  )

  ipcMain.handle('ssh:removeTarget', async (_event, args: { id: string }) => {
    await removeRegisteredSshTarget(args.id)
  })

  ipcMain.handle('ssh:importConfig', (_event, args?: { reAdopt?: boolean }) => {
    const targets = sshStore!.importFromSshConfig(args)
    const repoReadoptions = takeRepoReadoptions()
    return { targets, repoReadoptions }
  })
}
