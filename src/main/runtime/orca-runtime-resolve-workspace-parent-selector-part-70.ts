import { OrchestrationDb, type WorktreeLineage, type WorktreeLineageWarning, folderWorkspaceKey, parseWorkspaceKey, worktreeWorkspaceKey, sharesResolvedWorktreeLineageBoundary, type ResolvedWorktree, type WorktreeLineageInput, type ResolvedWorkspaceParent, type WorktreeLineageResolution, type WorktreeLineageCandidate, extractOrchestrationTaskId, RuntimeLineageError, WorktreeIdRequiresFullPathError } from './orca-runtime-symbols'
import { OrcaRuntimeGetLivePtyIdsForWorktreePart69 } from './orca-runtime-get-live-pty-ids-for-worktree-part-69'

export class OrcaRuntimeResolveWorkspaceParentSelectorPart70 extends OrcaRuntimeGetLivePtyIdsForWorktreePart69 {
  protected async resolveWorkspaceParentSelector(selector: string): Promise<ResolvedWorkspaceParent> {
    const rawSelector = selector.startsWith('id:') ? selector.slice('id:'.length) : selector
    const parsed = parseWorkspaceKey(rawSelector)
    if (parsed?.type === 'folder') {
      const folderWorkspace = this.store
        ?.getFolderWorkspaces?.()
        .find((workspace) => workspace.id === parsed.folderWorkspaceId)
      if (!folderWorkspace) {
        throw new Error('selector_not_found')
      }
      return {
        type: 'folder',
        workspaceKey: folderWorkspaceKey(folderWorkspace.id),
        folderWorkspace,
        instanceId: null
      }
    }
    const worktreeSelector = parsed?.type === 'worktree' ? `id:${parsed.worktreeId}` : selector
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    return {
      type: 'worktree',
      workspaceKey: worktreeWorkspaceKey(worktree.id),
      worktree,
      instanceId: worktree.instanceId ?? null
    }
  }
  protected validateLineageParent(child: ResolvedWorktree, parent: ResolvedWorktree): void {
    const childWorktreeId = child.id
    const parentWorktreeId = parent.id
    if (childWorktreeId === parentWorktreeId) {
      throw new RuntimeLineageError('LINEAGE_PARENT_CYCLE', 'A worktree cannot parent itself.')
    }
    if (!sharesResolvedWorktreeLineageBoundary(child, parent)) {
      throw new RuntimeLineageError(
        'LINEAGE_PARENT_CONTEXT_CONFLICT',
        'Parent worktree must belong to the same repository, execution host, and project.'
      )
    }
    const instanceByWorktreeId = new Map(
      this.worktreeResolutionState.resolvedCache?.worktrees.map((worktree) => [
        worktree.id,
        worktree.instanceId
      ]) ?? [
        [child.id, child.instanceId],
        [parent.id, parent.instanceId]
      ]
    )
    let cursor: string | undefined = parentWorktreeId
    const visited = new Set<string>([childWorktreeId])
    while (cursor) {
      if (visited.has(cursor)) {
        throw new RuntimeLineageError(
          'LINEAGE_PARENT_CYCLE',
          'Parent selector would create a lineage cycle.'
        )
      }
      visited.add(cursor)
      const lineage = this.store?.getWorktreeLineage?.(cursor)
      if (!lineage) {
        break
      }
      const cursorInstanceId = instanceByWorktreeId.get(cursor)
      const parentInstanceId = instanceByWorktreeId.get(lineage.parentWorktreeId)
      if (
        cursorInstanceId !== lineage.worktreeInstanceId ||
        parentInstanceId !== lineage.parentWorktreeInstanceId
      ) {
        break
      }
      cursor = lineage.parentWorktreeId
    }
  }
  protected async resolveLineageForWorktreeCreate(
    input?: WorktreeLineageInput
  ): Promise<WorktreeLineageResolution> {
    const parentSelectorNextSteps = [
      'Pass a valid --parent-worktree selector such as folder:<id>, worktree:<worktreeId>, id:<repo-id>::<path>, branch:<branch>, issue:<number>, path:<absolute-path>, or active/current.',
      'Retry with --no-parent to create without lineage.'
    ]
    const parentSelectorNotFoundMessage = (err: unknown): string =>
      err instanceof WorktreeIdRequiresFullPathError
        ? err.message
        : 'Parent selector was not found.'

    if (!input) {
      return { kind: 'none', warnings: [] }
    }

    if (input.noParent === true && (input.parentWorkspace || input.parentWorktree)) {
      throw new RuntimeLineageError(
        'LINEAGE_PARENT_CONTEXT_CONFLICT',
        'Choose either one parent selector or --no-parent.'
      )
    }
    if (input.parentWorkspace && input.parentWorktree) {
      throw new RuntimeLineageError(
        'LINEAGE_PARENT_CONTEXT_CONFLICT',
        'Choose either one parent selector or --no-parent.'
      )
    }

    if (input.noParent === true) {
      return { kind: 'none', warnings: [] }
    }

    if (input.parentWorkspace) {
      try {
        return {
          kind: 'lineage',
          parent: await this.resolveWorkspaceParentSelector(input.parentWorkspace),
          origin: 'cli',
          capture: { source: 'explicit-cli-flag', confidence: 'explicit' }
        }
      } catch (err) {
        throw new RuntimeLineageError(
          'LINEAGE_PARENT_NOT_FOUND',
          parentSelectorNotFoundMessage(err),
          {
            nextSteps: parentSelectorNextSteps
          }
        )
      }
    }

    if (input.parentWorktree) {
      try {
        const parent = await this.resolveWorktreeSelector(input.parentWorktree)
        return {
          kind: 'lineage',
          parent: {
            type: 'worktree',
            workspaceKey: worktreeWorkspaceKey(parent.id),
            worktree: parent,
            instanceId: parent.instanceId ?? null
          },
          origin: 'cli',
          capture: { source: 'explicit-cli-flag', confidence: 'explicit' }
        }
      } catch (err) {
        throw new RuntimeLineageError(
          'LINEAGE_PARENT_NOT_FOUND',
          parentSelectorNotFoundMessage(err),
          {
            nextSteps: parentSelectorNextSteps
          }
        )
      }
    }

    const warnings: WorktreeLineageWarning[] = []
    const candidates: WorktreeLineageCandidate[] = []
    let cwdCandidate: WorktreeLineageCandidate | null = null
    let terminalContextResolved = false

    if (input.envParentWorkspace) {
      try {
        candidates.push({
          source: 'env-workspace',
          parent: await this.resolveWorkspaceParentSelector(input.envParentWorkspace)
        })
      } catch {
        warnings.push({
          code: 'LINEAGE_PARENT_CONTEXT_MISSING',
          message: 'Worktree created, but Orca could not validate the environment parent context.',
          details: { envParentWorkspace: input.envParentWorkspace }
        })
      }
    }

    if (input.orchestrationContext?.parentWorktreeId) {
      try {
        const parent = await this.resolveWorktreeSelector(
          `id:${input.orchestrationContext.parentWorktreeId}`
        )
        candidates.push({
          source: 'orchestration-context',
          parent: {
            type: 'worktree',
            workspaceKey: worktreeWorkspaceKey(parent.id),
            worktree: parent,
            instanceId: parent.instanceId ?? null
          }
        })
      } catch {
        // Keep creation recoverable; the warning below covers missing inferred context.
      }
    }

    const commentTaskId = extractOrchestrationTaskId(input.comment)
    if (commentTaskId) {
      const candidate = await this.resolveLineageCandidateForTaskId(commentTaskId)
      if (candidate) {
        candidates.push(candidate)
      }
    }

    if (input.callerTerminalHandle) {
      try {
        const terminal = await this.showTerminal(input.callerTerminalHandle)
        const terminalParent = await this.resolveWorkspaceParentSelector(
          `id:${terminal.worktreeId}`
        )
        const activeDispatch = this._orchestrationDb?.getActiveDispatchForTerminal(
          input.callerTerminalHandle
        )
        const activeRun = this._orchestrationDb?.getActiveCoordinatorRun()
        if (activeDispatch) {
          candidates.push({
            source: 'orchestration-context',
            parent: terminalParent,
            taskId: activeDispatch.task_id,
            ...(activeRun
              ? {
                  orchestrationRunId: activeRun.id,
                  coordinatorHandle: activeRun.coordinator_handle
                }
              : {})
          })
        } else {
          candidates.push({
            source: 'terminal-context',
            parent: terminalParent
          })
        }
        terminalContextResolved = true
      } catch {
        // Why: a stale terminal handle (reload/SSH reconnect) shouldn't drop lineage; keep resolving other inferred candidates.
        warnings.push({
          code: 'LINEAGE_PARENT_CONTEXT_MISSING',
          message:
            'Worktree created, but Orca could not validate the caller terminal as a parent context.',
          details: { callerTerminalHandle: input.callerTerminalHandle }
        })
      }
    }

    if (input.cwdParentWorktree) {
      try {
        cwdCandidate = {
          source: 'cwd-context',
          parent: await this.resolveWorkspaceParentSelector(input.cwdParentWorktree)
        }
      } catch {
        warnings.push({
          code: 'LINEAGE_PARENT_CONTEXT_MISSING',
          message:
            'Worktree created, but Orca could not validate the current directory as a parent context.',

          details: { cwdParentWorktree: input.cwdParentWorktree }
        })
      }
    }

    if (candidates.length === 0 && cwdCandidate) {
      candidates.push(cwdCandidate)
    }

    if (candidates.length === 0) {
      return { kind: 'none', warnings }
    }

    const [first] = candidates
    const conflict = candidates.find(
      (candidate) => candidate.parent.workspaceKey !== first.parent.workspaceKey
    )
    if (conflict) {
      return {
        kind: 'none',
        warnings: [
          {
            code: 'LINEAGE_PARENT_CONTEXT_CONFLICT',
            message: 'Worktree created, but Orca could not prove which parent context caused it.',
            details: {
              terminalParentWorkspaceKey: candidates.find((c) => c.source === 'terminal-context')
                ?.parent.workspaceKey,
              envParentWorkspaceKey: candidates.find((c) => c.source === 'env-workspace')?.parent
                .workspaceKey,
              orchestrationParentWorkspaceKey: candidates.find(
                (c) => c.source === 'orchestration-context'
              )?.parent.workspaceKey
            }
          }
        ]
      }
    }

    const preferred =
      candidates.find((candidate) => candidate.source === 'env-workspace') ??
      candidates.find((candidate) => candidate.source === 'orchestration-context') ??
      first
    return {
      kind: 'lineage',
      parent: preferred.parent,
      origin: preferred.source === 'orchestration-context' ? 'orchestration' : 'cli',
      capture: { source: preferred.source, confidence: 'inferred' },
      ...((preferred.orchestrationRunId ?? input.orchestrationContext?.orchestrationRunId)
        ? {
            orchestrationRunId:
              preferred.orchestrationRunId ?? input.orchestrationContext?.orchestrationRunId
          }
        : {}),
      ...((preferred.taskId ?? input.orchestrationContext?.taskId)
        ? { taskId: preferred.taskId ?? input.orchestrationContext?.taskId }
        : {}),
      ...((preferred.coordinatorHandle ?? input.orchestrationContext?.coordinatorHandle)
        ? {
            coordinatorHandle:
              preferred.coordinatorHandle ?? input.orchestrationContext?.coordinatorHandle
          }
        : {}),
      ...(terminalContextResolved && input.callerTerminalHandle
        ? { createdByTerminalHandle: input.callerTerminalHandle }
        : {})
    }
  }
  protected async resolveLineageCandidateForTaskId(
    taskId: string
  ): Promise<WorktreeLineageCandidate | null> {
    const db = this.getOrchestrationDbIfAvailable()
    const dispatch = db?.getDispatchContext(taskId)
    // Why: agent-created tasks may never be dispatched, but the creating terminal still identifies the parent workspace.
    const parentHandle =
      dispatch?.assignee_handle ?? db?.getTask(taskId)?.created_by_terminal_handle
    if (!parentHandle) {
      return null
    }
    try {
      const terminal = await this.showTerminal(parentHandle)
      const parent = await this.resolveWorktreeSelector(`id:${terminal.worktreeId}`)
      return {
        source: 'orchestration-context',
        parent: {
          type: 'worktree',
          workspaceKey: worktreeWorkspaceKey(parent.id),
          worktree: parent,
          instanceId: parent.instanceId ?? null
        },
        taskId
      }
    } catch {
      return null
    }
  }
  protected getOrchestrationDbIfAvailable(): OrchestrationDb | null {
    try {
      return this._orchestrationDb ?? this.getOrchestrationDb()
    } catch {
      return this._orchestrationDb
    }
  }
  async hydrateInferredWorktreeLineage(): Promise<void> {
    const store = this.store
    if (
      !store ||
      typeof store.getWorktreeLineage !== 'function' ||
      typeof store.setWorktreeLineage !== 'function'
    ) {
      return
    }

    const worktrees = await this.listResolvedWorktrees()
    for (const worktree of worktrees) {
      if (store.getWorktreeLineage(worktree.id) || !worktree.instanceId) {
        continue
      }
      const taskId = extractOrchestrationTaskId(worktree.comment)
      if (!taskId) {
        continue
      }
      const candidate = await this.resolveLineageCandidateForTaskId(taskId)
      if (
        !candidate?.parent.instanceId ||
        candidate.parent.type !== 'worktree' ||
        candidate.parent.worktree.id === worktree.id
      ) {
        continue
      }
      try {
        this.validateLineageParent(worktree, candidate.parent.worktree)
      } catch {
        continue
      }
      store.setWorktreeLineage(worktree.id, {
        worktreeId: worktree.id,
        worktreeInstanceId: worktree.instanceId,
        parentWorktreeId: candidate.parent.worktree.id,
        parentWorktreeInstanceId: candidate.parent.instanceId,
        origin: 'orchestration',
        capture: { source: 'orchestration-context', confidence: 'inferred' },
        taskId,
        createdAt: Date.now()
      })
    }
  }
  async listWorktreeLineage(): Promise<Record<string, WorktreeLineage>> {
    await this.hydrateInferredWorktreeLineage()
    return this.store?.getAllWorktreeLineage?.() ?? {}
  }
}
