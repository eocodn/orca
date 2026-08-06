import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(projectDir, path), 'utf8')

describe('PTY connection owner boundaries', () => {
  it('routes PTY exit lifecycle through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-exit-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionExitController } from './pty-connection-exit-controller'"
    )
    expect(orchestrator).not.toContain('const onExit = (ptyId: string')
    expect(orchestrator).not.toContain('let handledExitPtyId: string | null = null')
    expect(controller).toContain('export function createPtyConnectionExitController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })

  it('routes agent notification timing through its concrete controller', () => {
    const orchestrator = read(
      'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts'
    )
    const controller = read(
      'src/renderer/src/components/terminal-pane/pty-connection-agent-notification-controller.ts'
    )

    expect(orchestrator).toContain(
      "import { createPtyConnectionAgentNotificationController } from './pty-connection-agent-notification-controller'"
    )
    expect(orchestrator).not.toContain('const scheduleAgentTaskCompleteNotification =')
    expect(orchestrator).not.toContain('let pendingTerminalBellNotification =')
    expect(controller).toContain('export function createPtyConnectionAgentNotificationController(')
    expect(controller.split(/\r?\n/).length).toBeLessThanOrEqual(300)
  })
})
