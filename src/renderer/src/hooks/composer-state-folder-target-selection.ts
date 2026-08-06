/* Folder-workspace target derivation for the new-workspace composer. */
import { useMemo } from 'react'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { getFolderSourceRepos } from '@/components/sidebar/folder-workspace-composer-helpers'
import { useFolderWorkspaceComposerPathStatus } from '@/components/sidebar/folder-workspace-composer-path-status'
import { getSelectedRepoSshGate } from '@/lib/new-workspace-ssh-gate'
import { parseExecutionHostId } from '../../../shared/execution-host'
import type { ProjectGroup, TuiAgent } from '../../../shared/types'
import type { useAppStore } from '@/store'

type FolderTargetSelectionInput = {
  repos: ReturnType<typeof useAppStore.getState>['repos']
  projectGroups: ReturnType<typeof useAppStore.getState>['projectGroups']
  selectedProjectGroup: ProjectGroup | null
  sshConnectionStates: ReturnType<typeof useAppStore.getState>['sshConnectionStates']
}

export function useComposerFolderTargetSelection({
  repos,
  projectGroups,
  selectedProjectGroup,
  sshConnectionStates
}: FolderTargetSelectionInput) {
  const folderSourceRepos = useMemo(
    () => getFolderSourceRepos(repos, projectGroups, selectedProjectGroup),
    [projectGroups, repos, selectedProjectGroup]
  )
  const parsedFolderTargetHost = parseExecutionHostId(selectedProjectGroup?.executionHostId)
  const folderTargetRuntimeEnvironmentId =
    parsedFolderTargetHost?.kind === 'runtime' ? parsedFolderTargetHost.environmentId : null
  const folderTargetConnectionId =
    parsedFolderTargetHost?.kind === 'runtime' ? null : (selectedProjectGroup?.connectionId ?? null)
  const folderTargetIsRemote =
    folderTargetConnectionId !== null || folderTargetRuntimeEnvironmentId !== null
  const folderTargetAgentDetectionTarget = folderTargetRuntimeEnvironmentId
    ? { kind: 'runtime' as const, environmentId: folderTargetRuntimeEnvironmentId }
    : folderTargetConnectionId
      ? { kind: 'ssh' as const, connectionId: folderTargetConnectionId }
      : selectedProjectGroup
        ? { kind: 'local' as const }
        : undefined
  const folderTargetSshState = folderTargetConnectionId
    ? (sshConnectionStates.get(folderTargetConnectionId) ?? null)
    : null
  const {
    selectedRepoSshStatus: folderTargetSshStatus,
    selectedRepoRequiresConnection: folderTargetRequiresConnection,
    selectedRepoConnectInProgress: folderTargetConnectInProgress
  } = getSelectedRepoSshGate({
    connectionId: folderTargetConnectionId,
    status: folderTargetSshState?.status ?? null
  })
  const { pathStatusBlocksCreate: folderPathStatusBlocksCreate, pathStatusProjectError } =
    useFolderWorkspaceComposerPathStatus(
      selectedProjectGroup,
      true,
      folderTargetRuntimeEnvironmentId
    )
  const { detectedIds: folderDetectedIds } = useDetectedAgents(folderTargetAgentDetectionTarget)
  const folderDetectedAgentIds = useMemo<Set<TuiAgent> | null>(
    () => (folderDetectedIds ? new Set(folderDetectedIds) : null),
    [folderDetectedIds]
  )

  return {
    folderSourceRepos,
    folderTargetRuntimeEnvironmentId,
    folderTargetConnectionId,
    folderTargetIsRemote,
    folderTargetSshStatus,
    folderTargetRequiresConnection,
    folderTargetConnectInProgress,
    folderPathStatusBlocksCreate,
    pathStatusProjectError,
    folderDetectedAgentIds
  }
}
