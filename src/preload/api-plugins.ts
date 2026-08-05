import type * as ApiExternal from './api-types-external'
type AppIdentity = ApiExternal.AppIdentity
type WriteTerminalRenderDesyncEvidenceArgs = ApiExternal.WriteTerminalRenderDesyncEvidenceArgs
type WriteTerminalRenderDesyncEvidenceResult = ApiExternal.WriteTerminalRenderDesyncEvidenceResult
type MarkdownDocument = ApiExternal.MarkdownDocument
type FloatingTerminalCwdRequest = ApiExternal.FloatingTerminalCwdRequest
type PersistedUIState = ApiExternal.PersistedUIState
type WorkspaceSessionState = ApiExternal.WorkspaceSessionState
type ExecutionHostId = ApiExternal.ExecutionHostId

export type AppApi = {
  /** Returns the app identity currently exposed to native chrome and the titlebar. */
  getIdentity: () => Promise<AppIdentity>
  /** Returns a URL base for feature-wall assets. In dev this is Vite /@fs;
   *  in packaged builds this is file:// resources. Renderer appends filenames. */
  getFeatureWallAssetBaseUrl: () => Promise<string>
  /** Relaunches the app (app.relaunch() + app.exit(0)) for settings that need a full restart to apply. */
  relaunch: () => Promise<void>
  /** Restarts Orca through the normal quit pipeline so daemon-backed terminal
   *  sessions survive and can reattach after the new process starts. */
  restart: () => Promise<void>
  /** Reloads the current app renderer through main so expected renderer
   *  teardown can be classified before Electron emits process-gone events. */
  reload: () => Promise<void>
  /** Commits the renderer's final locally durable state before unload and
   *  throws when the blocking durable write fails. */
  persistBeforeUnloadSync: (args: {
    sessions: { state: WorkspaceSessionState; hostId?: ExecutionHostId }[]
    ui: Partial<PersistedUIState>
  }) => void
  /** Resolves when the daemon PTY provider and hook receiver have either
   *  started or failed open for the first BrowserWindow. */
  awaitFirstWindowStartupServices: () => Promise<void>
  /** Reconciles legacy worker authority around persisted terminal reconnect. */
  recoverLegacyWorkerTerminalsForRendererStartup: () => Promise<void>
  /** Emits a startup benchmark marker when ORCA_STARTUP_DIAGNOSTICS is enabled. */
  startupDiagnostic: (event: string, details?: Record<string, unknown>) => Promise<void>
  /** macOS active input mode, or layout ID when no IME is selected (e.g. `com.apple.keylayout.PolishPro`).
   *  Distinguishes CJK IMEs and Option-layer-composing layouts that look like US QWERTY (issue #1205).
   *  Returns null on non-Darwin or when the defaults read fails. */
  getKeyboardInputSourceId: () => Promise<string | null>
  /** Updates the macOS Dock unread badge. No-op on Windows/Linux. */
  setUnreadDockBadgeCount: (count: number) => Promise<void>
  /** Resolves the launch directory for global Floating Terminal tabs. */
  getFloatingTerminalCwd: (args?: FloatingTerminalCwdRequest) => Promise<string>
  /** Resolves Orca's app-owned directory for auto-created Floating Workspace
   *  markdown notes. */
  getFloatingMarkdownDirectory: () => Promise<string>
  /** Opens a native picker for markdown documents, rooted in the floating
   *  workspace, and authorizes the selected file for editor reads/writes. */
  pickFloatingMarkdownDocument: () => Promise<MarkdownDocument | null>
  /** Opens a native directory picker and authorizes the selected directory
   *  for Floating Workspace markdown file creation. */
  pickFloatingWorkspaceDirectory: () => Promise<string | null>
  /** Persists flag-gated terminal render evidence under app-owned userData. */
  writeTerminalRenderDesyncEvidence: (
    args: WriteTerminalRenderDesyncEvidenceArgs
  ) => Promise<WriteTerminalRenderDesyncEvidenceResult>
}

/** Panel contribution as surfaced by the main-process plugin service. */
export type PluginHostPanel = {
  id: string
  title: string
  /** Lucide icon name declared in the plugin manifest. */
  icon?: string
  tabKey: `plugin:${string}`
}

/** `pending` = awaiting (re-)consent; `idle` = enabled, worker not running
 *  (lazy); `restarting` = waiting for supervised backoff; `errored` = crashed past the restart budget or failed to start;
 *  `invalid` = unreadable manifest. */
export type PluginHostStatus =
  | 'running'
  | 'restarting'
  | 'idle'
  | 'pending'
  | 'disabled'
  | 'errored'
  | 'invalid'

/** Wire shape of plugins:list — must stay assignable from the main-process
 *  projection in src/main/plugins/plugin-list-projection.ts. */
export type PluginHostListEntry = {
  pluginKey: string
  consentFingerprint: string | null
  name: string
  version: string
  publisher: string
  description?: string
  status: PluginHostStatus
  needsReconsent: boolean
  error?: string
  isDev: boolean
  official: boolean
  bundled: boolean
  capabilities: { kind: string; description: string }[]
  panels: PluginHostPanel[]
  commands: {
    id: string
    title: string
    context: 'global' | 'worktree'
    handler: { type: 'built-in'; action: string } | { type: 'worker' }
    keybindings: { key: string; when: 'global' | 'worktree' }[]
  }[]
  hasWorker: boolean
  restarts: number
  blockedByKillList?: { reason: string; advisoryUrl?: string }
  source?: {
    kind: 'local-path' | 'git' | 'bundled'
    reference: string
    resolvedCommit: string | null
    contentHash: string
  }
}

export type PluginHostLogLine = { ts: number; level: 'info' | 'warn' | 'error'; line: string }

export type PluginHostInstallSource =
  | { kind: 'local-path'; path: string }
  | { kind: 'git'; url: string; ref: string }

export type PluginHostInstallResult =
  | {
      ok: true
      pluginKey: string
      version: string
      contentHash: string
      consentFingerprint: string
      resolvedCommit: string | null
    }
  | { ok: false; error: string }
