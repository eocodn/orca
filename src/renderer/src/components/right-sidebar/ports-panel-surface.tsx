// Facade selecting local workspace or SSH port surfaces.
import React from 'react'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { LocalWorkspacePortsPanel } from './ports-panel-local-workspace'
import { SshPortsPanel } from './ports-panel-ssh'

export { getLocalWorkspacePortSections } from './ports-panel-local-workspace'
export { SshPortsPanel } from './ports-panel-ssh'

export {
  killWorkspacePortForTarget,
  openWorkspacePortInBrowser,
  scanWorkspacePortsForTarget
} from '@/lib/workspace-port-actions'

export default function PortsPanel({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)

  if (activeRepo?.connectionId) {
    return <SshPortsPanel />
  }

  return <LocalWorkspacePortsPanel isVisible={isVisible} />
}
