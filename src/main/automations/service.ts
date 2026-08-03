import type { WebContents } from 'electron'
import type { Store } from '../persistence'
import {
  isFinalAutomationRunStatus,
  type Automation,
  type AutomationDispatchRequest,
  type AutomationDispatchResult,
  type AutomationPrecheckResult,
  type AutomationRun,
  AUTOMATION_RESTART_INTERRUPTED_ERROR,
  isAutomationRunInFlightStatus
} from '../../shared/automations-types'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import { runAutomationPrecheck } from './precheck-runner'
import {
  isAutomationScheduleOwnedByService,
  resolveAutomationRunTarget,
  type AutomationRunTargetResult
} from './run-target-resolution'
import { collectAutomationRunUsage } from './run-usage-collection'
import type { HeadlessAutomationDispatcher } from './headless-dispatch'
import { clearAutomationDispatchTokens, createAutomationDispatchToken } from './dispatch-tokens'
import {
  didAutomationPrecheckPass,
  formatAutomationPrecheckFailure
} from '../../shared/automation-precheck'

const DEFAULT_TICK_MS = 60 * 1000

export class AutomationService {
  private readonly store: Store
  private readonly tickMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private webContents: WebContents | null = null
  private rendererReady = false
  private evaluating = false
  private readonly inFlightDispatches = new Set<string>()
  private readonly claudeUsage: ClaudeUsageStore | null
  private readonly codexUsage: CodexUsageStore | null
  private readonly allowRemoteHostScheduling: boolean
  private readonly headlessDispatcher: HeadlessAutomationDispatcher | null
  private restartReconciliation: Promise<boolean> | null = null
  private restartReconciliationNeeded = true

  constructor(
    store: Store,
    opts: {
      tickMs?: number
      claudeUsage?: ClaudeUsageStore
      codexUsage?: CodexUsageStore
      allowRemoteHostScheduling?: boolean
      headlessDispatcher?: HeadlessAutomationDispatcher
    } = {}
  ) {
    this.store = store
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS
    this.claudeUsage = opts.claudeUsage ?? null
    this.codexUsage = opts.codexUsage ?? null
    this.allowRemoteHostScheduling = opts.allowRemoteHostScheduling ?? false
    this.headlessDispatcher = opts.headlessDispatcher ?? null
  }

  setWebContents(webContents: WebContents | null): void {
    this.webContents = webContents
    this.rendererReady = false
  }

  setRendererReady(): void {
    this.rendererReady = true
    this.beginRestartReconciliation()
    void this.evaluateDueRuns()
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.beginRestartReconciliation()
    this.timer = setInterval(() => {
      void this.evaluateDueRuns()
    }, this.tickMs)
    // Why: headless serve never gets a renderer-ready IPC, but due runs still
    // need the same startup catch-up pass desktop gets after renderer attach.
    if (this.rendererReady || this.headlessDispatcher) {
      void this.evaluateDueRuns()
    }
  }

  private beginRestartReconciliation(): void {
    if (!this.restartReconciliationNeeded || this.restartReconciliation) {
      return
    }
    const reconciliation = this.reconcilePersistedRuns()
    this.restartReconciliation = reconciliation
    void reconciliation.then((deferred) => {
      if (this.restartReconciliation === reconciliation) {
        this.restartReconciliation = null
      }
      this.restartReconciliationNeeded = deferred
      void this.evaluateDueRuns()
    })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // A stopped service no longer owns renderer work; a later start must
    // reconcile persisted dispatching runs instead of treating them as live.
    this.inFlightDispatches.clear()
    this.restartReconciliationNeeded = true
  }

  async runNow(automationId: string): Promise<AutomationRun> {
    const automation = this.store.listAutomations().find((entry) => entry.id === automationId)
    if (!automation) {
      throw new Error('Automation not found.')
    }
    const run = this.store.createAutomationRun(automation, Date.now(), 'manual')
    return await this.requestDispatch(automation, run)
  }

  async runPrecheck(automationId: string, runId: string): Promise<AutomationPrecheckResult | null> {
    const automation = this.store.listAutomations().find((entry) => entry.id === automationId)
    if (!automation) {
      throw new Error('Automation not found.')
    }
    const run = this.store.listAutomationRuns(automationId).find((entry) => entry.id === runId)
    if (!run) {
      throw new Error('Automation run not found.')
    }
    if (run.trigger !== 'scheduled' || !automation.precheck) {
      return null
    }
    const target = resolveAutomationRunTarget(this.store, automation, {
      allowRemoteHostScheduling: this.allowRemoteHostScheduling
    })
    if (!target.ok) {
      return {
        command: automation.precheck.command,
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        error: target.error,
        startedAt: Date.now(),
        completedAt: Date.now()
      }
    }
    return await runAutomationPrecheck({
      precheck: automation.precheck,
      target:
        automation.executionTargetType === 'ssh'
          ? { type: 'ssh', cwd: target.cwd, connectionId: automation.executionTargetId }
          : { type: 'local', cwd: target.cwd }
    })
  }

  async markDispatchResult(result: AutomationDispatchResult): Promise<AutomationRun> {
    this.inFlightDispatches.delete(result.runId)
    const run = this.store.updateAutomationRun(result)
    clearAutomationDispatchTokens(run.automationId, run.id)
    if (!isFinalAutomationRunStatus(run.status)) {
      return run
    }
    // Why: the renderer's mark-completed effect can re-fire for the same run
    // before refresh() flips its status snapshot off 'dispatched'. Re-running
    // collectRunUsage advances the attribution window and can rewrite an
    // already-collected 'known' usage to 'unavailable'/'ambiguous_session'.
    if (run.usage) {
      return run
    }
    const usage = await collectAutomationRunUsage({
      automation: this.store.listAutomations().find((entry) => entry.id === run.automationId),
      run,
      claudeUsage: this.claudeUsage,
      codexUsage: this.codexUsage
    })
    // Why: the run is final during the await above, so a concurrent create-time
    // retention prune may have evicted it — the usage write must not throw then.
    if (!this.store.listAutomationRuns(run.automationId).some((entry) => entry.id === run.id)) {
      return run
    }
    return this.store.updateAutomationRun({
      runId: run.id,
      status: run.status,
      workspaceId: run.workspaceId,
      terminalSessionId: run.terminalSessionId,
      usage,
      error: run.error
    })
  }

  private async evaluateDueRuns(): Promise<void> {
    if (this.restartReconciliation) {
      await this.restartReconciliation
    }
    if (this.evaluating) {
      return
    }
    this.evaluating = true
    try {
      const now = Date.now()
      for (const automation of this.store.listAutomations()) {
        if (!automation.enabled || automation.nextRunAt > now) {
          continue
        }
        await this.evaluateAutomation(automation, now)
      }
    } finally {
      this.evaluating = false
    }
  }

  private async evaluateAutomation(automation: Automation, now: number): Promise<void> {
    if (
      !isAutomationScheduleOwnedByService(automation, {
        allowRemoteHostScheduling: this.allowRemoteHostScheduling
      })
    ) {
      return
    }
    const scheduledFor = this.store.getLatestAutomationOccurrence(automation, now)
    if (scheduledFor === null) {
      this.store.advanceAutomationNextRun(automation.id, now)
      return
    }
    const run = this.store.createAutomationRun(automation, scheduledFor)
    if (run.status === 'dispatching' && this.inFlightDispatches.has(run.id)) {
      this.store.advanceAutomationNextRun(automation.id, now)
      return
    }
    if (run.status === 'dispatching' && !this.hasDispatchChannel()) {
      return
    }
    if (run.status !== 'pending' && run.status !== 'dispatching') {
      this.store.advanceAutomationNextRun(automation.id, now)
      return
    }
    const graceMs = automation.missedRunGraceMinutes * 60 * 1000
    if (run.status === 'pending' && now - scheduledFor > graceMs) {
      this.store.updateAutomationRun({
        runId: run.id,
        status: 'skipped_missed',
        workspaceId: automation.workspaceId,
        error: 'Orca was unavailable during the missed-run grace window.'
      })
      this.store.advanceAutomationNextRun(automation.id, now)
      return
    }

    await this.requestDispatch(automation, run)
    this.store.advanceAutomationNextRun(automation.id, now)
  }

  private hasDispatchChannel(): boolean {
    return Boolean(
      this.headlessDispatcher ||
        (this.webContents && !this.webContents.isDestroyed() && this.rendererReady)
    )
  }

  private async reconcilePersistedRuns(): Promise<boolean> {
    let deferred = false
    for (const automation of this.store.listAutomations()) {
      if (
        !isAutomationScheduleOwnedByService(automation, {
          allowRemoteHostScheduling: this.allowRemoteHostScheduling
        })
      ) {
        continue
      }
      for (const run of this.store.listAutomationRuns(automation.id)) {
        if (!isAutomationRunInFlightStatus(run.status)) {
          continue
        }
        if (run.status === 'dispatched') {
          this.store.updateAutomationRun({
            runId: run.id,
            status: 'dispatch_failed',
            workspaceId: run.workspaceId,
            terminalSessionId: run.terminalSessionId,
            terminalPaneKey: run.terminalPaneKey,
            terminalPtyId: run.terminalPtyId,
            error: AUTOMATION_RESTART_INTERRUPTED_ERROR
          })
          continue
        }
        if (this.hasDispatchChannel()) {
          await this.requestDispatch(automation, run)
        } else {
          deferred = true
        }
      }
    }
    return deferred
  }

  private async requestDispatch(
    automation: Automation,
    run: AutomationRun
  ): Promise<AutomationRun> {
    const target = resolveAutomationRunTarget(this.store, automation, {
      allowRemoteHostScheduling: this.allowRemoteHostScheduling
    })
    if (!target.ok) {
      return this.store.updateAutomationRun({
        runId: run.id,
        status: 'skipped_unavailable',
        workspaceId: automation.workspaceId,
        error: target.error
      })
    }
    if (this.inFlightDispatches.has(run.id)) {
      return run
    }
    this.inFlightDispatches.add(run.id)
    const webContents = this.webContents
    if (!webContents || webContents.isDestroyed() || !this.rendererReady) {
      if (this.headlessDispatcher) {
        return await this.requestHeadlessDispatch(automation, run, target)
      }
      this.inFlightDispatches.delete(run.id)
      return this.store.updateAutomationRun({
        runId: run.id,
        status: 'skipped_unavailable',
        workspaceId: automation.workspaceId,
        error: 'No Orca window was available to launch the automation.'
      })
    }
    const updated = this.store.updateAutomationRun({
      runId: run.id,
      status: 'dispatching',
      workspaceId: automation.workspaceId,
      error: null
    })
    const payload: AutomationDispatchRequest = {
      automation,
      run: updated,
      dispatchToken: createAutomationDispatchToken(automation.id, updated.id)
    }
    try {
      webContents.send('automations:dispatchRequested', payload)
    } catch (error) {
      this.inFlightDispatches.delete(run.id)
      throw error
    }
    return updated
  }

  private async requestHeadlessDispatch(
    automation: Automation,
    run: AutomationRun,
    target: Extract<AutomationRunTargetResult, { ok: true }>
  ): Promise<AutomationRun> {
    const precheckResult =
      run.trigger === 'scheduled' && automation.precheck
        ? await this.runPrecheck(automation.id, run.id)
        : null
    if (precheckResult && !didAutomationPrecheckPass(precheckResult)) {
      this.inFlightDispatches.delete(run.id)
      return this.store.updateAutomationRun({
        runId: run.id,
        status: 'skipped_precheck',
        workspaceId: automation.workspaceId,
        precheckResult,
        error: formatAutomationPrecheckFailure(precheckResult)
      })
    }
    try {
      const launch = await this.headlessDispatcher!({ automation, run, target })
      const launchRunTarget = {
        workspaceId: launch.workspaceId,
        workspaceDisplayName: launch.workspaceDisplayName ?? null,
        terminalSessionId: launch.terminalSessionId,
        terminalPaneKey: launch.terminalPaneKey ?? null,
        terminalPtyId: launch.terminalPtyId ?? null
      }
      const updated = this.store.updateAutomationRun({
        runId: run.id,
        status: 'dispatched',
        ...launchRunTarget,
        error: null
      })
      if (launch.completion) {
        void launch.completion
          .then((completion) =>
            this.markDispatchResult({
              runId: run.id,
              status: completion.status,
              ...launchRunTarget,
              precheckResult,
              outputSnapshot: completion.outputSnapshot ?? null,
              error: completion.error ?? null
            })
          )
          .catch((error) =>
            this.markDispatchResult({
              runId: run.id,
              status: 'dispatch_failed',
              ...launchRunTarget,
              error: error instanceof Error ? error.message : String(error)
            })
          )
      }
      if (!launch.completion) {
        this.inFlightDispatches.delete(run.id)
      }
      return updated
    } catch (error) {
      this.inFlightDispatches.delete(run.id)
      return this.store.updateAutomationRun({
        runId: run.id,
        status: 'dispatch_failed',
        workspaceId: automation.workspaceId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
