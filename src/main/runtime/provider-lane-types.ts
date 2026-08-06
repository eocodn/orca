export type CodexAccountSelectionTarget = { runtime?: 'host' | 'wsl'; wslDistro?: string | null }
export type CodexSessionResumePreparation =
  | { outcome: 'resume'; codexHomePath: string }
  | { outcome: 'fresh'; claimedCodexProvenance: boolean }
