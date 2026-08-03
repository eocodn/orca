import { defineMethod, type RpcMethod } from '../core'
import { buildDispatchPreamble } from '../../orchestration/preamble'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { DispatchParams, resolveRunScope } from './orchestration-support'

export const ORCHESTRATION_DISPATCH_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.dispatch',
    params: DispatchParams,
    handler: async (params, { runtime, legacyCoordinatorRunId, revalidateLegacyCoordinator }) => {
      const db = runtime.getOrchestrationDb()
      const task = db.getTask(params.task)
      if (!task) {
        throw new Error(`Task not found: ${params.task}`)
      }
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.from,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId
      })
      if (task.run_id !== run.id) {
        throw new OrchestrationError(
          'task_not_found',
          `Task ${task.id} was not found in Run ${run.id}.`
        )
      }

      // Why: dry-run previews the preamble without mutating state, so it skips the ready-status check and uses a placeholder dispatchId.
      if (params.dryRun) {
        const preamble = buildDispatchPreamble({
          taskId: task.id,
          dispatchId: 'ctx_dryrun',
          taskSpec: task.spec,
          coordinatorHandle: params.from ?? 'coordinator',
          workerHandle: params.to ?? 'worker',
          devMode: params.devMode,
          ...(params.to
            ? { cliCommand: runtime.getTerminalOrchestrationCliCommand(params.to) }
            : {})
        })
        return { dispatch: null, injected: false, dryRun: true, preamble }
      }

      if (!params.to) {
        throw new Error('Missing --to')
      }
      const to = params.to

      if (task.status !== 'ready') {
        throw new Error(`Task ${params.task} is ${task.status}; only ready tasks can be dispatched`)
      }

      // Why: injecting the preamble into a bare shell dumps it as shell commands (gibberish), so require a detected agent first.
      if (params.inject) {
        const hasAgent = await runtime.isTerminalRunningAgent(to)
        if (!hasAgent) {
          throw new Error(
            `Cannot dispatch --inject to terminal ${to}: no recognized agent detected. ` +
              'Start an agent CLI (e.g. claude, codex, gemini, droid, cursor) in the terminal first, ' +
              'or dispatch without --inject and send the prompt manually.'
          )
        }
      }

      const dispatchAuthority = runtime.getOrchestrationDispatchAuthority(to)
      const assigneePaneKey =
        dispatchAuthority?.paneKey ?? runtime.getTerminalPaneKey(to) ?? undefined
      const processIncarnation =
        dispatchAuthority?.processIncarnation ??
        runtime.getTerminalProcessIncarnation(to) ??
        undefined
      if (params.inject && (!assigneePaneKey || !processIncarnation)) {
        throw new OrchestrationError(
          'stable_pane_required',
          `Terminal ${to} has no stable pane/process incarnation for lifecycle authority.`
        )
      }

      revalidateLegacyCoordinator?.()
      const ctx = db.createDispatchContext(
        params.task,
        to,
        assigneePaneKey,
        dispatchAuthority?.launchTokenHash ?? undefined
      )
      const dispatchCapability = params.inject
        ? db.mintDispatchCapability({
            dispatchId: ctx.id,
            paneKey: assigneePaneKey as string,
            processIncarnation: processIncarnation as string
          })
        : undefined

      // Why: built after ctx so dispatchId is the real ctx.id, letting heartbeats attribute liveness to a specific dispatch context, not just a task.
      const preamble = buildDispatchPreamble({
        taskId: task.id,
        dispatchId: ctx.id,
        taskSpec: task.spec,
        coordinatorHandle: params.from ?? 'coordinator',
        workerHandle: to,
        dispatchCapability,
        devMode: params.devMode,
        cliCommand: runtime.getTerminalOrchestrationCliCommand(to)
      })

      let injected = false
      if (params.inject) {
        try {
          await runtime.sendTerminalAgentPrompt(to, preamble)
          injected = true
        } catch (err) {
          db.failDispatch(ctx.id, err instanceof Error ? err.message : String(err))
          throw err
        }
      }

      // Why: returnPreamble is opt-in because the preamble is several hundred bytes most callers don't need in the response.
      if (params.returnPreamble) {
        return { dispatch: ctx, injected, preamble }
      }
      return { dispatch: ctx, injected }
    }
  }),

]
