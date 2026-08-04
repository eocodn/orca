import { describe, expect, it, vi } from 'vitest'
import { RuntimeJiraCommands } from './orca-runtime-jira-commands'
import { RuntimeNotificationRegistry } from './runtime-notification-registry'
import { RuntimeClientSettingsCommands } from './runtime-client-settings-commands'
import { RuntimeAutomationCommands } from './runtime-automation-commands'
import { PtyLayoutQueue, type PtyLayoutState, type PtyLayoutTarget } from './pty-layout-queue'
import { TerminalOutputState } from './terminal-output-state'
import { WorktreeResolutionState } from './worktree-resolution-state'
import {
  compareWorktreePs,
  getLatestAgentCandidateTitle,
  resolveTerminalSessionWorktreeId,
  runtimeWorktreeIdsEqual
} from './runtime-worktree-summary'

describe('runtime domain boundaries', () => {
  it('assigns replay watermarks at the notification boundary', () => {
    const notifications = new RuntimeNotificationRegistry()
    let observedSeq: number | undefined
    const mutatingListener = vi.fn((event) => {
      observedSeq = event.notificationSeq
      event.notificationSeq = 99
    })
    const listener = vi.fn()
    const unsubscribeMutating = notifications.subscribe(mutatingListener)
    const unsubscribe = notifications.subscribe(listener)

    notifications.dispatch({ type: 'dismiss', notificationId: 'n-1' })

    expect(observedSeq).toBe(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ notificationSeq: 1, notificationEpoch: notifications.epoch })
    )
    const replayed = notifications.missedSince(0)
    replayed[0].notificationSeq = 99
    expect(notifications.missedSince(0)[0]).toMatchObject({ notificationSeq: 1 })
    unsubscribeMutating()
    unsubscribe()
    expect(notifications.listenerCount).toBe(0)
  })

  it('keeps output sequence and subscriber state inside one terminal owner', () => {
    const state = new TerminalOutputState()
    const listener = vi.fn()
    const unsubscribe = state.subscribe('pty-1', listener)

    expect(state.advanceSequence('pty-1', 4)).toBe(4)
    expect(state.advanceSequence('pty-1', 2)).toBe(6)
    state.publish('pty-1', 'ok', { seq: state.getSequence('pty-1') })

    expect(listener).toHaveBeenCalledWith('ok', { seq: 6 })
    unsubscribe()
    state.publish('pty-1', 'ignored')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('bounds Jira list commands at the provider boundary', async () => {
    const listIssues = vi.fn().mockResolvedValue({ issues: [] })
    const commands = new RuntimeJiraCommands({ listIssues })

    await commands.jiraListIssues(undefined, 500)

    expect(listIssues).toHaveBeenCalledWith(undefined, 100, undefined)
  })

  it('invalidates worktree scans by repository without touching other hosts', () => {
    const state = new WorktreeResolutionState<unknown, unknown>()
    state.scanGenerations.set('repo-a', 4)
    state.scanGenerations.set('repo-b', 2)
    state.invalidateScan('repo-a')

    expect(state.scanGenerations.get('repo-a')).toBe(5)
    expect(state.scanGenerations.get('repo-b')).toBe(2)
  })

  it('keeps client settings defaults and quick-command limits at the settings boundary', () => {
    let settings = {
      agentStatusHooksEnabled: undefined,
      disabledTuiAgents: undefined,
      agentCmdOverrides: undefined,
      agentDefaultArgs: undefined,
      agentDefaultEnv: undefined,
      defaultTaskSource: undefined,
      defaultTaskViewPreset: undefined,
      visibleTaskProviders: undefined,
      defaultRepoSelection: undefined,
      defaultLinearTeamSelection: undefined,
      githubProjects: undefined,
      experimentalNewWorktreeCardStyle: undefined,
      compactWorktreeCards: undefined,
      minimaxGroupId: undefined,
      minimaxUsageModels: undefined,
      prBotAuthorOverrides: undefined,
      terminalQuickCommands: []
    }
    const store = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((updates) => {
        settings = { ...settings, ...updates }
      })
    }
    const commands = new RuntimeClientSettingsCommands(store)

    expect(commands.getClientSettings()).toMatchObject({
      agentStatusHooksEnabled: true,
      defaultTaskSource: 'github',
      defaultTaskViewPreset: 'issues',
      minimaxUsageModels: 'general'
    })
    expect(
      commands.updateClientTerminalQuickCommands({
        type: 'upsert',
        command: { id: 'one', label: 'One', command: 'echo one', appendEnter: true }
      })
    ).toEqual([{ id: 'one', label: 'One', command: 'echo one', appendEnter: true }])
  })

  it('resolves automation targets before persisting a new run definition', async () => {
    const createAutomation = vi.fn().mockResolvedValue({ id: 'automation-1' })
    const commands = new RuntimeAutomationCommands(
      { createAutomation },
      {
        showRepo: vi.fn().mockResolvedValue({ id: 'repo-1' }),
        showManagedWorktree: vi.fn()
      }
    )

    await commands.createAutomation({
      name: 'Nightly',
      prompt: 'run checks',
      agentId: 'claude',
      repo: 'repo-1',
      rrule: 'FREQ=DAILY',
      dtstart: 1
    })

    expect(createAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'repo-1',
        workspaceMode: 'new_per_run',
        workspaceId: null
      })
    )
  })

  it('coalesces same-owner layout updates and rejects stale generations', async () => {
    let generation = 1
    const applied: PtyLayoutTarget[] = []
    const queue = new PtyLayoutQueue({
      getGeneration: () => generation,
      hasLayout: () => true,
      isFreshSubscribe: () => false,
      apply: async (_ptyId, target) => {
        applied.push(target)
        const state: PtyLayoutState = { ...target, seq: applied.length, appliedAt: 1 }
        return { ok: true, state }
      }
    })

    const first = queue.enqueue('pty-1', { kind: 'phone', cols: 80, rows: 24, ownerClientId: 'a' })
    const second = queue.enqueue('pty-1', {
      kind: 'phone',
      cols: 90,
      rows: 28,
      ownerClientId: 'a'
    })
    const third = queue.enqueue('pty-1', {
      kind: 'phone',
      cols: 100,
      rows: 30,
      ownerClientId: 'a'
    })
    await expect(first).resolves.toMatchObject({ ok: true, state: { cols: 80 } })
    await expect(second).resolves.toMatchObject({ ok: true, state: { cols: 100 } })
    await expect(third).resolves.toMatchObject({ ok: true, state: { cols: 100 } })
    expect(applied).toHaveLength(2)

    generation = 2
    expect(queue.cancel('pty-1', 1)).toBe(false)
  })

  it('keeps worktree identity and title selection deterministic at the summary boundary', () => {
    expect(runtimeWorktreeIdsEqual('repo::C:\\Work\\App', 'repo::c:/work/app')).toBe(true)
    expect(
      resolveTerminalSessionWorktreeId(
        {
          tabsByWorktree: { 'repo::C:\\Work\\App': [] },
          tabGroups: {},
          tabGroupLayouts: {},
          activeTabIdByWorktree: {},
          activeGroupIdByWorktree: {}
        } as never,
        'repo::c:/work/app'
      )
    ).toBe('repo::C:\\Work\\App')
    expect(
      getLatestAgentCandidateTitle(
        { title: 'older', updatedAt: 10 },
        { title: ' newest ', updatedAt: 20 }
      )
    ).toBe('newest')
    expect(
      compareWorktreePs(
        {
          isPinned: true,
          unread: false,
          hasHostSidebarActivity: false,
          lastOutputAt: null,
          liveTerminalCount: 0,
          path: 'z'
        } as never,
        {
          isPinned: false,
          unread: false,
          hasHostSidebarActivity: true,
          lastOutputAt: 10,
          liveTerminalCount: 2,
          path: 'a'
        } as never
      )
    ).toBeLessThan(0)
  })
})
