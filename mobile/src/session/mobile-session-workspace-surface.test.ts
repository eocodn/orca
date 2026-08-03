import { describe, expect, it } from 'vitest'
import { resolveWorkspacePanelTap } from '../../app/h/[hostId]/session/mobile-session-workspace-surface'

describe('resolveWorkspacePanelTap', () => {
  it('toggles the active docked panel using the panel-host contract', () => {
    expect(
      resolveWorkspacePanelTap({
        canDock: true,
        current: 'files',
        tapped: 'files',
        hostId: 'host-1',
        worktreeId: 'repo::/workspace'
      })
    ).toEqual({ kind: 'dock', next: null })
  })

  it('builds the concrete narrow-layout route from the panel descriptor', () => {
    expect(
      resolveWorkspacePanelTap({
        canDock: false,
        current: null,
        tapped: 'pr',
        hostId: 'host-1',
        worktreeId: 'repo::/workspace'
      })
    ).toEqual({
      kind: 'push',
      panel: 'pr',
      route: {
        pathname: '/h/[hostId]/source-control/[worktreeId]',
        params: { hostId: 'host-1', worktreeId: 'repo::/workspace', tab: 'pr' }
      }
    })
  })
})
