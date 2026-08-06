export type ClaudeAccountService = {
  prepareForClaudeLaunch?: (...args: never[]) => Promise<unknown>
}
export type CodexAccountService = Record<string, never>
export type CodexResetCreditRejectedBeforeProviderReason = string
export type CodexAccountSelectionTarget = { runtime?: 'host' | 'wsl'; wslDistro?: string | null }
export type RateLimitService = Record<string, never>
