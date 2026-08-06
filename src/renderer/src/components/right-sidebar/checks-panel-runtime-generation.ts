import { useChecksPanelGeneration } from './checks-panel-generation-controller'
import {
  getPullRequestGenerationRecordKey,
  getPullRequestGenerationSeedRestoreKey
} from '@/store/slices/pull-request-generation'

export function useChecksPanelRuntimeGeneration(args: {
  generation: Parameters<typeof useChecksPanelGeneration>[0]
  worktreeId: string | null
  worktreePath: string | null
  repoId: string | undefined
  branch: string
  records: Record<string, unknown>
}): ReturnType<typeof useChecksPanelGeneration> & {
  activePullRequestGenerationKey: string | null
  activePullRequestGenerationRecordCandidate: unknown
  activePullRequestGenerationRecord: unknown
  activePullRequestGenerationSeedRestoreKey: string | null
  createPrPushFirst: boolean
} {
  const activePullRequestGenerationKey = getPullRequestGenerationRecordKey({
    worktreeId: args.worktreeId,
    worktreePath: args.worktreePath,
    repoId: args.repoId,
    branch: args.branch
  })
  const activePullRequestGenerationRecordCandidate = activePullRequestGenerationKey
    ? (args.records[activePullRequestGenerationKey] ?? null)
    : null
  const activePullRequestGenerationRecord =
    activePullRequestGenerationRecordCandidate &&
    typeof activePullRequestGenerationRecordCandidate === 'object' &&
    'context' in activePullRequestGenerationRecordCandidate &&
    (
      activePullRequestGenerationRecordCandidate as {
        context?: { repoId?: string; branch?: string }
      }
    ).context?.repoId === args.repoId &&
    (
      activePullRequestGenerationRecordCandidate as {
        context?: { repoId?: string; branch?: string }
      }
    ).context?.branch === args.branch
      ? activePullRequestGenerationRecordCandidate
      : null
  const activePullRequestGenerationSeedRestoreKey = getPullRequestGenerationSeedRestoreKey({
    recordKey: activePullRequestGenerationKey,
    record: activePullRequestGenerationRecord
  })
  const generation = useChecksPanelGeneration({
    ...args.generation,
    activePullRequestGenerationKey,
    activePullRequestGenerationRecord,
    activePullRequestGenerationSeedRestoreKey
  })
  return {
    ...generation,
    activePullRequestGenerationKey,
    activePullRequestGenerationRecordCandidate,
    activePullRequestGenerationRecord,
    activePullRequestGenerationSeedRestoreKey,
    createPrPushFirst:
      typeof activePullRequestGenerationRecord === 'object' &&
      activePullRequestGenerationRecord !== null &&
      'requiresPushBeforeCreate' in activePullRequestGenerationRecord &&
      activePullRequestGenerationRecord.requiresPushBeforeCreate === true
  }
}
