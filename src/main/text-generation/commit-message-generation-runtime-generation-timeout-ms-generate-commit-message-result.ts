import type { ResolvedSourceControlAiGenerationParams } from '../../shared/source-control-ai'

export const GENERATION_TIMEOUT_MS = 60_000

export const MAX_AGENT_OUTPUT_BYTES = 4 * 1024 * 1024


export type GenerateCommitMessageParams = ResolvedSourceControlAiGenerationParams


export type GenerateCommitMessageResult =
  | { success: true; message: string; agentLabel?: string }
  | { success: false; error: string; canceled?: boolean }
