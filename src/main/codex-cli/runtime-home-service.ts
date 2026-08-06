import type { Store } from '../persistence'

/** Neutral launch-home adapter; account switching and managed private homes were removed. */
export class CodexRuntimeHomeService {
  constructor(_store: Store | null) {}
  setRealHomeLaneGate(_gate: () => boolean): void {}
  isHostSystemDefaultRealHomeSelected(launchEnv?: NodeJS.ProcessEnv): boolean {
    return !launchEnv?.CODEX_HOME
  }
  isHostSystemDefaultRealHome(): boolean {
    return true
  }
  getSelectedHostAccountCodexHomePath(): string | null {
    return null
  }
  getHostCodexHomePathsForSessionDiscovery(): string[] {
    return []
  }
  prepareForCodexLaunch(_target?: unknown, launchEnv?: NodeJS.ProcessEnv): string | null {
    return launchEnv?.CODEX_HOME?.trim() || null
  }
  syncForCurrentSelection(): void {}
  syncActiveWslSelectionsBeforeRestart(): void {}
}
