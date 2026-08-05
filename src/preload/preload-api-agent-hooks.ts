import {
  ipcRenderer,
  notificationSoundState,
  clearNotificationSoundPlaybackState,
  disposeCachedNotificationSound
} from './preload-api-runtime-context'
import type {
  DashboardSnapshot,
  DashboardRevealAgentArgs,
  TerminalPreviewConnectResult,
  TerminalPreviewDataPayload,
  AgentHookInstallStatus,
  CustomPet,
  NotificationDismissResult,
  NotificationDispatchResult,
  NotificationDeliveryProbeResult,
  NotificationPermissionStatusResult,
  NotificationSoundDataResult,
  NotificationSoundPathResult,
  NotificationSoundResult,
  OnboardingState,
  ShellOpenExternalEditorRequest,
  ShellOpenExternalEditorResult,
  ShellOpenLocalPathResult,
  SkillDiscoveryResult,
  SkillDiscoveryTarget,
  SkillFreshnessInventory,
  SkillUpdateRun,
  SkillUpdateStartResult,
  PreflightRuntimeContext,
  RefreshAgentsResult
} from './preload-api-runtime-context'
export function createPreloadApiAgentHooks(): Record<string, unknown> {
  return {
    agentHooks: {
      claudeStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:claudeStatus'),
      openClaudeStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:openClaudeStatus'),
      codexStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:codexStatus'),
      geminiStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:geminiStatus'),
      antigravityStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:antigravityStatus'),
      ampStatus: (): Promise<AgentHookInstallStatus> => ipcRenderer.invoke('agentHooks:ampStatus'),
      cursorStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:cursorStatus'),
      droidStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:droidStatus'),
      commandCodeStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:commandCodeStatus'),
      grokStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:grokStatus'),
      devinStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:devinStatus'),
      copilotStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:copilotStatus'),
      hermesStatus: (): Promise<AgentHookInstallStatus> =>
        ipcRenderer.invoke('agentHooks:hermesStatus'),
      kimiStatus: (): Promise<AgentHookInstallStatus> => ipcRenderer.invoke('agentHooks:kimiStatus')
    },
    agentTrust: {
      markTrusted: (args: {
        preset: 'cursor' | 'copilot' | 'codex'
        workspacePath: string
        connectionId?: string
      }): Promise<void> => ipcRenderer.invoke('agentTrust:markTrusted', args)
    },
    preflight: {
      check: (args?: {
        force?: boolean
      }): Promise<{
        git: { installed: boolean }
        gh: { installed: boolean; authenticated: boolean }
        glab?: { installed: boolean; authenticated: boolean }
        bitbucket?: { configured: boolean; authenticated: boolean; account: string | null }
        azureDevOps?: {
          configured: boolean
          authenticated: boolean
          account: string | null
          baseUrl: string | null
          tokenConfigured: boolean
        }
        gitea?: {
          configured: boolean
          authenticated: boolean
          account: string | null
          baseUrl: string | null
          tokenConfigured: boolean
        }
        linear: { connected: boolean }
      }> => ipcRenderer.invoke('preflight:check', args),
      detectAgents: (args?: PreflightRuntimeContext): Promise<string[]> =>
        ipcRenderer.invoke('preflight:detectAgents', args),
      refreshAgents: (args?: PreflightRuntimeContext): Promise<RefreshAgentsResult> =>
        ipcRenderer.invoke('preflight:refreshAgents', args),
      detectRemoteAgents: (args: { connectionId: string }): Promise<string[]> =>
        ipcRenderer.invoke('preflight:detectRemoteAgents', args),
      detectRemoteWindowsTerminalCapabilities: (args: {
        connectionId: string
      }): Promise<{
        wslAvailable: boolean
        wslDistros: string[]
        pwshAvailable: boolean
        gitBashAvailable: boolean
        hostPlatform: NodeJS.Platform | null
      }> => ipcRenderer.invoke('preflight:detectRemoteWindowsTerminalCapabilities', args)
    },
    notifications: {
      dispatch: (args: Record<string, unknown>): Promise<NotificationDispatchResult> =>
        ipcRenderer.invoke('notifications:dispatch', args),
      dismiss: (ids: string[]): Promise<NotificationDismissResult> =>
        ipcRenderer.invoke('notifications:dismiss', ids),
      openSystemSettings: (): Promise<void> =>
        ipcRenderer.invoke('notifications:openSystemSettings'),
      getPermissionStatus: (): Promise<NotificationPermissionStatusResult> =>
        ipcRenderer.invoke('notifications:getPermissionStatus'),
      probeDelivery: (args?: { force?: boolean }): Promise<NotificationDeliveryProbeResult> =>
        ipcRenderer.invoke('notifications:probeDelivery', args),
      playSound: async (options?: {
        force?: boolean
        volume?: number
      }): Promise<NotificationSoundResult> => {
        try {
          // Why: drop replays while still ringing; the test button passes force to always confirm.
          if (!options?.force && notificationSoundState.isPlaying) {
            return { played: false, reason: 'deduped' }
          }

          const resolved = (await ipcRenderer.invoke(
            'notifications:resolveSoundPath'
          )) as NotificationSoundPathResult
          if (!resolved.ok) {
            if (notificationSoundState.cached) {
              disposeCachedNotificationSound()
            }
            return { played: false, reason: resolved.reason }
          }

          let entry = notificationSoundState.cached
          if (!entry || entry.path !== resolved.path) {
            const sound = (await ipcRenderer.invoke(
              'notifications:loadSound'
            )) as NotificationSoundDataResult
            if (!sound.ok) {
              disposeCachedNotificationSound()
              return { played: false, reason: sound.reason }
            }
            const arrayBuffer = new ArrayBuffer(sound.data.byteLength)
            new Uint8Array(arrayBuffer).set(sound.data)
            const blob = new Blob([arrayBuffer], { type: sound.mimeType })
            disposeCachedNotificationSound()
            const blobUrl = URL.createObjectURL(blob)
            entry = { path: sound.path, blobUrl, audio: new Audio(blobUrl) }
            notificationSoundState.cached = entry
          }

          const audio = entry.audio
          // Why: restart from zero on each play so bursts replay instead of stacking copies (GNOME canberra / VS Code signal service).
          audio.currentTime = 0
          if (typeof options?.volume === 'number' && Number.isFinite(options.volume)) {
            audio.volume = Math.min(1, Math.max(0, options.volume / 100))
          }
          notificationSoundState.isPlaying = true
          notificationSoundState.cleanup?.()
          const release = (): void => {
            cleanup()
            if (notificationSoundState.cleanup === cleanup) {
              notificationSoundState.cleanup = null
            }
            notificationSoundState.isPlaying = false
          }
          const cleanup = (): void => {
            audio.removeEventListener('ended', release)
            audio.removeEventListener('error', release)
          }
          notificationSoundState.cleanup = cleanup
          audio.addEventListener('ended', release)
          audio.addEventListener('error', release)
          try {
            await audio.play()
          } catch {
            release()
            return { played: false, reason: 'playback-failed' }
          }
          return { played: true }
        } catch {
          clearNotificationSoundPlaybackState()
          return { played: false, reason: 'playback-failed' }
        }
      }
    },
    onboarding: {
      get: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:get'),
      update: (
        updates: Partial<Omit<OnboardingState, 'checklist'>> & {
          checklist?: Partial<OnboardingState['checklist']>
        }
      ): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:update', updates)
    },
    dashboard: {
      // Open the pop-out dashboard window, or focus it if already open.
      openPopout: (): Promise<void> => ipcRenderer.invoke('dashboardPopout:open'),

      // ── Producer side (main window) ──────────────────────────────────────
      publishSnapshot: (snapshot: DashboardSnapshot): Promise<void> =>
        ipcRenderer.invoke('dashboard:publishSnapshot', snapshot),
      getPopoutOpen: (): Promise<boolean> => ipcRenderer.invoke('dashboard:getPopoutOpen'),
      onPopoutOpenChanged: (callback: (open: boolean) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, open: boolean): void => callback(open)
        ipcRenderer.on('dashboard:popoutOpenChanged', listener)
        return () => ipcRenderer.removeListener('dashboard:popoutOpenChanged', listener)
      },
      onSnapshotRequested: (callback: () => void): (() => void) => {
        const listener = (): void => callback()
        ipcRenderer.on('dashboard:snapshotRequested', listener)
        return () => ipcRenderer.removeListener('dashboard:snapshotRequested', listener)
      },
      onRevealAgent: (callback: (args: DashboardRevealAgentArgs) => void): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          args: DashboardRevealAgentArgs
        ): void => callback(args)
        ipcRenderer.on('ui:revealDashboardAgent', listener)
        return () => ipcRenderer.removeListener('ui:revealDashboardAgent', listener)
      },
      onAckAgent: (callback: (paneKey: string) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, paneKey: string): void =>
          callback(paneKey)
        ipcRenderer.on('ui:ackDashboardAgent', listener)
        return () => ipcRenderer.removeListener('ui:ackDashboardAgent', listener)
      },

      // ── Consumer side (pop-out window) ───────────────────────────────────
      requestSnapshot: (): Promise<void> => ipcRenderer.invoke('dashboard:requestSnapshot'),
      onSnapshot: (callback: (snapshot: DashboardSnapshot) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, snapshot: DashboardSnapshot): void =>
          callback(snapshot)
        ipcRenderer.on('dashboard:snapshot', listener)
        return () => ipcRenderer.removeListener('dashboard:snapshot', listener)
      },
      revealAgent: (args: DashboardRevealAgentArgs): Promise<void> =>
        ipcRenderer.invoke('dashboardPopout:revealAgent', args),
      ackAgent: (paneKey: string): Promise<void> =>
        ipcRenderer.invoke('dashboardPopout:ackAgent', { paneKey })
    },
    terminalPreview: {
      connect: (
        ptyId: string,
        opts?: { scrollbackRows?: number }
      ): Promise<TerminalPreviewConnectResult> =>
        ipcRenderer.invoke('terminalPreview:connect', { ptyId, opts }),
      input: (ptyId: string, data: string): Promise<boolean> =>
        ipcRenderer.invoke('terminalPreview:input', { ptyId, data }),
      fit: (
        ptyId: string,
        cols: number,
        rows: number
      ): Promise<{ cols: number; rows: number } | null> =>
        ipcRenderer.invoke('terminalPreview:fit', { ptyId, cols, rows }),
      ack: (ptyId: string, bytes: number): Promise<void> =>
        ipcRenderer.invoke('terminalPreview:ack', { ptyId, bytes }),
      unsubscribe: (ptyId: string): Promise<void> =>
        ipcRenderer.invoke('terminalPreview:unsubscribe', { ptyId }),
      onData: (callback: (payload: TerminalPreviewDataPayload) => void): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          payload: TerminalPreviewDataPayload
        ): void => callback(payload)
        ipcRenderer.on('terminalPreview:data', listener)
        return () => ipcRenderer.removeListener('terminalPreview:data', listener)
      }
    },
    macosTccPrompts: {
      onThreshold: (callback: (payload: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void =>
          callback(payload)
        ipcRenderer.on('macosTccPrompts:threshold', listener)
        return () => ipcRenderer.removeListener('macosTccPrompts:threshold', listener)
      },
      consumePending: (): Promise<{ claimId: number; promptCount: number } | null> =>
        ipcRenderer.invoke('macosTccPrompts:consumePending'),
      acknowledgePending: (claimId: number): Promise<void> =>
        ipcRenderer.invoke('macosTccPrompts:acknowledgePending', claimId),
      releasePending: (claimId: number): Promise<void> =>
        ipcRenderer.invoke('macosTccPrompts:releasePending', claimId),
      dismiss: (): Promise<void> => ipcRenderer.invoke('macosTccPrompts:dismiss')
    },
    developerPermissions: {
      getStatus: (): Promise<unknown> => ipcRenderer.invoke('developerPermissions:getStatus'),
      request: (args: { id: string }): Promise<unknown> =>
        ipcRenderer.invoke('developerPermissions:request', args),
      openSettings: (args: { id: string }): Promise<void> =>
        ipcRenderer.invoke('developerPermissions:openSettings', args)
    },
    shell: {
      openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:openPath', path),

      openInFileManager: (path: string): Promise<ShellOpenLocalPathResult> =>
        ipcRenderer.invoke('shell:openInFileManager', path),

      openInExternalEditor: (
        request: ShellOpenExternalEditorRequest
      ): Promise<ShellOpenExternalEditorResult> =>
        ipcRenderer.invoke('shell:openInExternalEditor', request),

      openUrl: (url: string): Promise<void> => ipcRenderer.invoke('shell:openUrl', url),

      openFilePath: (path: string): Promise<boolean> =>
        ipcRenderer.invoke('shell:openFilePath', path),

      openFileUri: (uri: string): Promise<void> => ipcRenderer.invoke('shell:openFileUri', uri),

      pathExists: (path: string): Promise<boolean> => ipcRenderer.invoke('shell:pathExists', path),

      pickAttachment: (): Promise<string | null> => ipcRenderer.invoke('shell:pickAttachment'),

      pickImage: (): Promise<string | null> => ipcRenderer.invoke('shell:pickImage'),

      pickRepoIconImage: (): Promise<{ dataUrl: string; fileName: string } | null> =>
        ipcRenderer.invoke('shell:pickRepoIconImage'),

      pickAudio: (): Promise<string | null> => ipcRenderer.invoke('shell:pickAudio'),

      pickDirectory: (args: { defaultPath?: string }): Promise<string | null> =>
        ipcRenderer.invoke('shell:pickDirectory', args),

      copyFile: (args: { srcPath: string; destPath: string }): Promise<void> =>
        ipcRenderer.invoke('shell:copyFile', args)
    },
    skills: {
      discover: (target?: SkillDiscoveryTarget): Promise<SkillDiscoveryResult> =>
        ipcRenderer.invoke('skills:discover', target),
      freshnessInventory: (): Promise<SkillFreshnessInventory> =>
        ipcRenderer.invoke('skills:freshnessInventory'),
      startUpdateRun: (names: string[]): Promise<SkillUpdateStartResult> =>
        ipcRenderer.invoke('skills:startUpdateRun', names),
      cancelUpdateRun: (): Promise<void> => ipcRenderer.invoke('skills:cancelUpdateRun'),
      acknowledgeUpdateRun: (): Promise<void> => ipcRenderer.invoke('skills:acknowledgeUpdateRun'),
      getUpdateRun: (): Promise<SkillUpdateRun> => ipcRenderer.invoke('skills:getUpdateRun'),
      onUpdateRun: (callback: (run: SkillUpdateRun) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, run: SkillUpdateRun): void =>
          callback(run)
        ipcRenderer.on('skills:updateRun', listener)
        return () => ipcRenderer.removeListener('skills:updateRun', listener)
      }
    },
    pet: {
      import: (): Promise<CustomPet | null> => ipcRenderer.invoke('pet:import'),
      importPetBundle: (): Promise<CustomPet | null> => ipcRenderer.invoke('pet:importPetBundle'),
      read: (
        id: string,
        fileName: string,
        kind?: 'image' | 'bundle'
      ): Promise<ArrayBuffer | null> => ipcRenderer.invoke('pet:read', id, fileName, kind),
      delete: (id: string, fileName: string, kind?: 'image' | 'bundle'): Promise<void> =>
        ipcRenderer.invoke('pet:delete', id, fileName, kind)
    }
  }
}
