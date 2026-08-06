import { useChecksPanelGitEffects } from './checks-panel-git-effects'
import { useChecksPanelFetch } from './checks-panel-fetch-controller'

export type ChecksPanelRuntimeDataEffectsArgs = {
  git: Parameters<typeof useChecksPanelGitEffects>[0]
  fetch: Parameters<typeof useChecksPanelFetch>[0]
}

export function useChecksPanelRuntimeDataEffects(args: ChecksPanelRuntimeDataEffectsArgs): {
  fetchChecks: (options?: { force?: boolean; prNumberOverride?: number | null }) => Promise<void>
  fetchGitLabDetails: (options?: {
    mrNumberOverride?: number | null
    headShaOverride?: string | null
    commitAsCurrent?: boolean
  }) => Promise<void>
} {
  useChecksPanelGitEffects(args.git)
  const { fetchChecks, fetchGitLabDetails } = useChecksPanelFetch(args.fetch) as {
    fetchChecks: (options?: { force?: boolean; prNumberOverride?: number | null }) => Promise<void>
    fetchGitLabDetails: (options?: {
      mrNumberOverride?: number | null
      headShaOverride?: string | null
      commitAsCurrent?: boolean
    }) => Promise<void>
  }
  return { fetchChecks, fetchGitLabDetails }
}
