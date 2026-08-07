import { isClaudeAgent } from '@/lib/agent-status'
import { classifyTitleActivity } from '@/lib/pane-agent-evidence'

export function shouldSeedCacheTimerOnInitialTitle(args: {
  rawTitle: string
  allowInitialIdleSeed: boolean
  existingTimerStartedAt: number | null | undefined
  promptCacheTimerEnabled: boolean | null
}): boolean {
  const { rawTitle, allowInitialIdleSeed, existingTimerStartedAt, promptCacheTimerEnabled } = args

  if (!allowInitialIdleSeed || !isClaudeAgent(rawTitle)) {
    return false
  }

  const status = classifyTitleActivity(rawTitle)
  if (status === null || status === 'working') {
    return false
  }

  if (existingTimerStartedAt != null) {
    return false
  }

  // Why: the initial idle-title seed exists only for PTYs reattached during
  // session restore. Fresh Claude launches also start idle before the first
  // prompt, but no server-side prompt cache exists yet, so showing a TTL
  // countdown there is incorrect.
  return promptCacheTimerEnabled !== false
}

type InitialCacheTimerSeedControllerArgs = {
  getExistingTimerStartedAt: () => number | null | undefined
  getPromptCacheTimerEnabled: () => boolean | null
  seed: () => void
}

export function createInitialCacheTimerSeedController({
  getExistingTimerStartedAt,
  getPromptCacheTimerEnabled,
  seed
}: InitialCacheTimerSeedControllerArgs) {
  let considered = false
  let allowed = false

  return {
    setAllowed(value: boolean): void {
      allowed = value
    },
    observeTitle(rawTitle: string): void {
      if (considered) {
        return
      }
      considered = true
      if (
        shouldSeedCacheTimerOnInitialTitle({
          rawTitle,
          allowInitialIdleSeed: allowed,
          existingTimerStartedAt: getExistingTimerStartedAt(),
          promptCacheTimerEnabled: getPromptCacheTimerEnabled()
        })
      ) {
        seed()
      }
    }
  }
}
