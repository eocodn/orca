import type { StarNagPromptMode, StarNagPromptSource } from '../../shared/star-nag-telemetry'

export type StarNagPromptContext = {
  source: StarNagPromptSource
  mode: StarNagPromptMode
  threshold: number
  agents_since_baseline: number
  agents_since_baseline_bucket: string
}

export type StarNagPromptSession = StarNagPromptContext & {
  openedRepoTracked?: boolean
  starAttemptPromise?: Promise<boolean>
}
