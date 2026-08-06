import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(projectDir, path), 'utf8')

describe('renderer runtime export closure', () => {
  it('does not retain the retired Grok accounts web capability', () => {
    const webDir = resolve(projectDir, 'src/renderer/src/web')
    const offenders = readdirSync(webDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
      .filter((name) =>
        readFileSync(resolve(webDir, name), 'utf8').includes('createGrokAccountsApi')
      )
    expect(offenders).toEqual([])
  })

  it('keeps runtime git status in the read client owner', () => {
    const client = read('src/renderer/src/runtime/runtime-git-read-client.ts')
    expect(client).toContain('export async function getRuntimeGitStatus(')
    expect(client).toContain("'git.status'")
    expect(client).toContain('callLocalGitStatus(')
  })

  it('imports web-session activity from the transport owner', () => {
    const browserCreation = read('src/renderer/src/runtime/web-runtime-session-browser-creation.ts')
    expect(browserCreation).toMatch(
      /import \{[\s\S]*?isWebRuntimeSessionActive,[\s\S]*?\} from '\.\/web-runtime-session-transport'/
    )
    expect(browserCreation).not.toMatch(
      /import \{[\s\S]*?isWebRuntimeSessionActive,[\s\S]*?\} from '\.\/web-runtime-session-terminal-creation'/
    )
  })

  it('re-exports tracking contracts as types rather than runtime values', () => {
    const reconciliation = read('src/renderer/src/runtime/web-session-tabs-reconciliation.ts')
    expect(reconciliation).toContain('export type {')
    for (const name of [
      'SessionTabsStreamEvent',
      'SessionTabsListAllResult',
      'SnapshotFreshness',
      'TerminalSurface',
      'WebSessionTabsSyncState'
    ]) {
      expect(reconciliation).toMatch(new RegExp(`export type \\{[\\s\\S]*?\\b${name}\\b`))
    }
  })

  it('keeps the IPC events facade named-only', () => {
    const facade = read('src/renderer/src/hooks/useIpcEvents.ts')
    expect(facade).not.toContain('export { default }')
    expect(facade).toContain("export * from './use-ipc-events-surface'")
  })

  it('re-exports the update protocol classifier from its model owner', () => {
    const component = read('src/renderer/src/components/update-card-component.tsx')
    expect(component).toContain("export { isHttp2ProtocolError } from './update-card-model'")
    expect(component).not.toContain("isHttp2ProtocolError } from './update-card-core'")
  })

  it('exports the editor echo verification reader from its concrete owner', () => {
    const echo = read('src/renderer/src/hooks/editor-external-watch-echo.ts')
    expect(echo).toContain('export function readFileForEchoVerification(')
    expect(echo).toContain('export function scheduleChangedOnDiskMark(')
    expect(echo).toContain('export function scheduleSelfMoveEchoVerification(')
  })

  it('exports agent-status classification from the model owner', () => {
    const model = read('src/renderer/src/hooks/ipc-events-agent-status-model.ts')
    expect(model).toContain('export function isAgentStatusForRecentlyClosedTab(')
    expect(model).toContain('export function hasRuntimeBackedWorktreeAttribution(')
    expect(model).toContain('export function applyResolvedAgentTerminalTitleToTab(')
    expect(model).toContain('export function resolvePaneKey(')
    expect(model).toContain('export function resolveWorktreeConnection(')
    expect(model).toContain('export function resolveHookPayloadAgentType(')
  })

  it('exports runtime git sync operations through the public facade', () => {
    const facade = read('src/renderer/src/runtime/runtime-git-client.ts')
    for (const name of ['commitRuntimeGit', 'getRuntimeGitBranchDiff', 'getRuntimeGitCommitDiff']) {
      expect(facade).toMatch(
        new RegExp(
          `export \\{[\\s\\S]*?\\b${name}\\b[\\s\\S]*?\\} from './runtime-git-sync-client'`
        )
      )
    }
  })

  it('uses the concrete terminal layout owner name', () => {
    const state = read('src/renderer/src/components/terminal-surface-state.ts')
    const parking = read('src/renderer/src/components/terminal-surface-parking-controller.ts')
    expect(state).toContain('getEffectiveLayoutForWorktree as getEffectiveLayout')
    expect(parking).toContain('type getEffectiveLayoutForWorktree')
    expect(parking).not.toContain('type getEffectiveLayout\n')
  })

  it('exports empty new-workspace option constants from the contracts owner', () => {
    const contracts = read('src/renderer/src/components/new-workspace-composer-card-contracts.ts')
    expect(contracts).toContain('export const EMPTY_PROJECT_OPTIONS')
    expect(contracts).toContain('export const EMPTY_PROJECT_HOST_SETUP_OPTIONS')
  })

  it('routes cold activation deferral to the background-mount owner', () => {
    const activation = read('src/renderer/src/components/terminal-surface-activation-mount.ts')
    expect(activation).toMatch(
      /import \{[\s\S]*?canDeferColdActivationTabsForHost,[\s\S]*?\} from '\.\/terminal\/background-terminal-worktree-mount'/
    )
    expect(activation).not.toMatch(
      /canDeferColdActivationTabsForHost[\s\S]*?from '\.\/terminal-pane\/terminal-parked-tab-watchers'/
    )
  })

  it('routes activity display symbols to their concrete owners', () => {
    const row = read('src/renderer/src/components/activity/activity-thread-row.tsx')
    const state = read('src/renderer/src/components/activity/activity-thread-state.ts')
    expect(row).toContain("import { AgentStateDot } from '@/components/AgentStateDot'")
    expect(state).toContain("import { agentStateLabel } from '@/components/AgentStateDot'")
    expect(row).toMatch(
      /import \{[\s\S]*?formatAbsoluteDate[\s\S]*?\} from '\.\/activity-prototype-page-model'/
    )
    expect(row).toContain(
      "import { getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'"
    )
  })

  it('routes sidebar virtual DOM readers through the row model owner', () => {
    const virtualizer = read('src/renderer/src/components/sidebar/worktree-list-virtualizer.ts')
    const rowModel = read('src/renderer/src/components/sidebar/worktree-list-row-model.ts')
    expect(virtualizer).toContain("import { getVirtualRowIndex } from './worktree-list-row-model'")
    expect(virtualizer).not.toMatch(
      /getVirtualRowIndex[\s\S]*?from '\.\/worktree-list-virtual-rows'/
    )
    expect(rowModel).toContain('export function getRenderRowOptionId(')
  })

  it('routes activity relative time through the activity model owner', () => {
    const row = read('src/renderer/src/components/activity/activity-thread-row.tsx')
    expect(row).toMatch(
      /import \{[\s\S]*?formatAbsoluteDate,[\s\S]*?formatRelativeTime[\s\S]*?\} from '\.\/activity-prototype-page-model'/
    )
    expect(row).not.toContain(
      "import { formatRelativeTime, getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'"
    )
  })

  it('routes mutable PR comment classification to the action owner', () => {
    const details = read('src/renderer/src/components/right-sidebar/checks-panel-details.tsx')
    expect(details).toContain(
      "export { isMutablePRConversationComment } from './checks-panel-comment-actions'"
    )
    expect(details).not.toContain(
      "isMutablePRConversationComment, PRCommentsList } from './checks-panel-comments-list'"
    )
  })

  it('exports Jira clipboard delivery from the workspace model owner', () => {
    const model = read('src/renderer/src/components/jira-issue-workspace-model.ts')
    expect(model).toContain('export async function copyTextToClipboard(')
  })

  it('routes worktree native-context attributes to the model owner', () => {
    for (const path of [
      'src/renderer/src/components/sidebar/WorktreeCardMeta.tsx',
      'src/renderer/src/components/sidebar/WorktreeCardPorts.tsx'
    ]) {
      const consumer = read(path)
      expect(consumer).toContain(
        "WORKTREE_NATIVE_CONTEXT_MENU_ATTR } from './worktree-context-menu-model'"
      )
      expect(consumer).not.toContain(
        "WORKTREE_NATIVE_CONTEXT_MENU_ATTR } from './WorktreeContextMenu'"
      )
    }
  })

  it('routes resolved PR comments to the concrete group view', () => {
    const resolved = read(
      'src/renderer/src/components/right-sidebar/checks-panel-resolved-groups.tsx'
    )
    expect(resolved).toContain("PRCommentGroupView } from './checks-panel-group-view'")
    expect(resolved).not.toContain("PRCommentGroupView } from './checks-panel-comment-groups'")
  })

  it('routes mobile fit overrides independently from driver presence', () => {
    const markup = read(
      'src/renderer/src/components/terminal-pane/terminal-pane-view-surface-markup.tsx'
    )
    expect(markup).toContain(
      "getFitOverrideForPty } from '@/lib/pane-manager/mobile-fit-overrides'"
    )
    expect(markup).not.toMatch(
      /getFitOverrideForPty[\s\S]*?from '@\/lib\/pane-manager\/mobile-driver-state'/
    )
  })

  it('exports PTY connection through the session orchestrator facade', () => {
    const runtime = read('src/renderer/src/components/terminal-pane/pty-connection-runtime.ts')
    expect(runtime).toContain(
      "export { connectPanePty } from './pty-connection-session-orchestrator-runtime'"
    )
    const owner = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    expect(owner).toContain('export function connectPanePty(')
    expect(owner).not.toContain('Warning: truncated output')
    expect(owner.split(/\r?\n/).length).toBeGreaterThan(1_000)
    expect(owner).toContain('const connectionId =')
    expect(owner).toContain('const transport =')
  })

  it('routes pane detach policy to the lifecycle policy owner', () => {
    const cleanup = read(
      'src/renderer/src/components/terminal-pane/terminal-pane-lifecycle-manager-cleanup.ts'
    )
    expect(cleanup).toMatch(
      /import \{[^}]*shouldDetachPaneTransportOnUnmount[^}]*\} from '\.\/terminal-pane-lifecycle-policies'/
    )
    expect(cleanup).not.toMatch(
      /import \{[^}]*shouldDetachPaneTransportOnUnmount[^}]*\} from '\.\/terminal-pane-lifecycle-support'/
    )
  })

  it('routes terminal output debug and backlog state to concrete owners', () => {
    const delivery = read('src/renderer/src/lib/pane-manager/pane-terminal-output-delivery.ts')
    const queue = read('src/renderer/src/lib/pane-manager/pane-terminal-output-queue.ts')
    expect(delivery).toMatch(
      /import \{[^}]*debugEnabled,[^}]*debugState[^}]*\} from '\.\/terminal-output-scheduler-queue-runtime-debug'/
    )
    expect(queue).toMatch(
      /import \{[^}]*currentTerminalOutputBacklogCapChars[^}]*\} from '\.\/terminal-output-scheduler-queue-runtime-state'/
    )
    expect(queue).not.toContain('maxQueueChars')
  })

  it('keeps terminal output concrete owners out of the scheduler facade cycle', () => {
    for (const path of [
      'src/renderer/src/lib/pane-manager/pane-terminal-output-delivery.ts',
      'src/renderer/src/lib/pane-manager/pane-terminal-output-queue.ts'
    ]) {
      expect(read(path)).not.toContain("from './pane-terminal-output-scheduler'")
    }
  })
})
