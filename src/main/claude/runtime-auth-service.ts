export type ClaudeAccountSelectionTarget = { runtime?: 'host' | 'wsl'; wslDistro?: string | null }
export type ClaudeRuntimeAuthPreparation = {
  configDir: string
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
  wslLinuxConfigDir?: string | null
  envPatch: Record<string, string>
  stripAuthEnv: boolean
  provenance: string
}

/** Account switching/auth persistence was removed; launches inherit user Claude environment. */
export class ClaudeRuntimeAuthService {
  constructor(_store: unknown) {}
  prepareForClaudeLaunch(
    _target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRuntimeAuthPreparation> {
    return Promise.resolve({
      configDir: '',
      envPatch: {},
      stripAuthEnv: false,
      provenance: 'user-environment'
    })
  }
  syncForCurrentSelection(): Promise<void> {
    return Promise.resolve()
  }
}
