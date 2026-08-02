import { useCallback, useMemo } from 'react'
import { Keyboard } from 'react-native'
import { isMobileTuiAgentEnabled } from '../tasks/mobile-tui-agents'
import { shouldPreserveWorkspaceSourceOnRepoChange } from '../../../src/shared/new-workspace/workspace-source'
import {
  NEW_WORKTREE_AGENT_OPTIONS as AGENT_OPTIONS,
  NEW_WORKTREE_BLANK_AGENT as BLANK_TERMINAL
} from './new-worktree-agent-selection'
import type { Repo } from './new-worktree-modal-contract'

type RepoSelectionInput = {
  repos: Repo[]
  selectedRepo: Repo | null
  setSelectedRepo: (repo: Repo) => void
  composer: any
  detectedAgentIds: Set<string> | null
  runtimeSettings: { disabledTuiAgents?: any[] } | null
}

export function useNewWorktreeRepoSelection({
  repos,
  selectedRepo,
  setSelectedRepo,
  composer,
  detectedAgentIds,
  runtimeSettings
}: RepoSelectionInput) {
  const visibleAgentOptions = useMemo(() => {
    const candidates = detectedAgentIds === null
      ? AGENT_OPTIONS
      : AGENT_OPTIONS.filter((agent) => detectedAgentIds.has(agent.id))
    return candidates.filter((agent) =>
      agent.id !== '__blank__' && isMobileTuiAgentEnabled(agent.id, runtimeSettings?.disabledTuiAgents)
    )
  }, [detectedAgentIds, runtimeSettings?.disabledTuiAgents])
  const pickerAgentOptions = useMemo(() => [...visibleAgentOptions, BLANK_TERMINAL], [visibleAgentOptions])
  const repoPickerItems = useMemo(
    () => repos.map((repo) => ({ id: repo.id, label: repo.displayName, repo })),
    [repos]
  )
  const prepareSelectionPickerOpen = useCallback(() => Keyboard.dismiss(), [])
  const handleRepoSelected = useCallback((repo: Repo) => {
    const repoChanged = repo.id !== selectedRepo?.id
    setSelectedRepo(repo)
    if (repoChanged && !shouldPreserveWorkspaceSourceOnRepoChange(composer.linkedWorkItem)) {
      composer.handleClearSmartNameSelection()
    }
  }, [composer, selectedRepo?.id, setSelectedRepo])
  return { pickerAgentOptions, repoPickerItems, prepareSelectionPickerOpen, handleRepoSelected }
}
