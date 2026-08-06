export const CLAUDE_AUTH_ENV_VARS = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY'
] as const
const activeClaudePtys = new Set<string>()
export function markClaudePtyExited(ptyId: string): void {
  activeClaudePtys.delete(ptyId)
}
export function markClaudePtySpawned(ptyId: string): void {
  activeClaudePtys.add(ptyId)
}
export function hasLiveClaudePtys(): boolean {
  return activeClaudePtys.size > 0
}
export function seedLiveClaudePtysFromPersistence(_ptyIds: readonly string[]): void {}
export function confirmSeededClaudeLivePtys(_ptyIds: readonly string[]): void {}
export function hasSeededUnconfirmedClaudePtys(): boolean {
  return false
}
export function isClaudeAuthSwitchInProgress(): boolean {
  return false
}
export function hasClaudeAuthEnvConflict(env: NodeJS.ProcessEnv | undefined): boolean {
  return CLAUDE_AUTH_ENV_VARS.some((key) => Boolean(env?.[key]))
}
