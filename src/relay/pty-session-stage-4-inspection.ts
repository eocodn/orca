import { processHasChildren, getForegroundProcessName, resolveProcessCwd } from './pty-shell-utils'
import { splitWorktreeId } from '../shared/worktree-id'
import type { PtyProcessSummary, SerializedPtyEntry } from './pty-session-stage-contracts'
import { PtyHandlerStage4Termination } from './pty-session-stage-4-termination'

export abstract class PtyHandlerStage4Inspection extends PtyHandlerStage4Termination {
  protected async getCwd(params: Record<string, unknown>): Promise<string> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      throw new Error(`PTY "${id}" not found`)
    }
    return resolveProcessCwd(managed.pty.pid, managed.initialCwd)
  }

  protected async getInitialCwd(params: Record<string, unknown>): Promise<string> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      throw new Error(`PTY "${id}" not found`)
    }
    return managed.initialCwd
  }

  protected async clearBuffer(params: Record<string, unknown>): Promise<void> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (managed && !managed.disposed) {
      managed.startupIngress?.snapshotBarrier()
      managed.pty.clear()
    }
  }

  protected async hasChildProcesses(params: Record<string, unknown>): Promise<boolean> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      return false
    }
    return await processHasChildren(managed.pty.pid)
  }

  protected async getForegroundProcess(params: Record<string, unknown>): Promise<string | null> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      return null
    }
    return await getForegroundProcessName(managed.pty.pid, managed.pty.process || null)
  }

  protected async inspectProcess(params: Record<string, unknown>): Promise<{
    foregroundProcess: string | null
    hasChildProcesses: boolean
  }> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      throw new Error('terminal_gone')
    }
    const foregroundProcess = await getForegroundProcessName(
      managed.pty.pid,
      managed.pty.process || null
    )
    return {
      foregroundProcess,
      hasChildProcesses: await processHasChildren(managed.pty.pid)
    }
  }

  protected async listProcesses(): Promise<PtyProcessSummary[]> {
    const results: PtyProcessSummary[] = []
    for (const [id, managed] of this.ptys) {
      const title =
        (await getForegroundProcessName(managed.pty.pid, managed.pty.process || null)) || 'shell'
      // Why: foreground inspection is awaited; omit a row if the relay reused
      // this id before the old inspection completed.
      if (this.ptys.get(id) !== managed || managed.disposed) {
        continue
      }
      results.push({
        id,
        incarnationId: managed.incarnationId,
        cwd: managed.initialCwd,
        title,
        ...(managed.worktreeId ? { worktreeId: managed.worktreeId } : {}),
        ...(managed.terminalHandle ? { terminalHandle: managed.terminalHandle } : {}),
        ...(this.agentSessionOwners.listForPty(id).length
          ? { agentSessionOwners: this.agentSessionOwners.listForPty(id) }
          : {})
      })
    }
    return results
  }

  protected async serialize(params: Record<string, unknown>): Promise<string> {
    const ids = params.ids as string[]
    const entries: SerializedPtyEntry[] = []
    for (const id of ids) {
      const managed = this.ptys.get(id)
      if (!managed) {
        continue
      }
      const { pid, cols, rows } = managed.pty
      entries.push({
        id,
        pid,
        cols,
        rows,
        cwd: managed.initialCwd,
        paneKey: managed.paneKey,
        tabId: managed.tabId,
        attachIdentity: managed.attachIdentity,
        worktreeId: managed.worktreeId,
        ...(managed.explicitTerm !== undefined ? { explicitTerm: managed.explicitTerm } : {}),
        envToDelete: managed.envToDelete,
        gitCredentialPromptGuarded: managed.gitCredentialPromptGuarded,
        ...(managed.terminalHandle ? { terminalHandle: managed.terminalHandle } : {})
      })
    }
    return JSON.stringify(entries)
  }

  protected async revive(params: Record<string, unknown>): Promise<void> {
    const state = params.state as string
    const entries = JSON.parse(state) as SerializedPtyEntry[]

    for (const entry of entries) {
      if (this.ptys.has(entry.id) || this.pendingReviveIds.has(entry.id)) {
        continue
      }
      // Only re-attach if the original process is still alive
      try {
        process.kill(entry.pid, 0)
      } catch {
        continue
      }
      const ownedPath = entry.worktreeId
        ? splitWorktreeId(entry.worktreeId)?.worktreePath
        : undefined
      const finishCreation = this.beginPtyCreation([ownedPath, entry.cwd])
      this.pendingReviveIds.add(entry.id)
      try {
        await this.reviveEntry(entry)
      } finally {
        this.pendingReviveIds.delete(entry.id)
        finishCreation()
      }
    }
  }
}
