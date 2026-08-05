import { starOrca } from '../github/client'
import type { StarNagPromptSession } from './prompt-session-telemetry'

export async function runStarNagDirectStarAttempt(session: StarNagPromptSession): Promise<boolean> {
  const starred = await starOrca()
  if (!starred) {
    session.mode = 'web'
    return false
  }
  return true
}
