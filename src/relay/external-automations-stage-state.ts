import type { RelayDispatcher } from './dispatcher'

type ExternalAutomationsListResult = {
  jobs: unknown[]
  hermesAvailable: boolean
  openclawAvailable: boolean
  error: string | null
}

type ExternalAutomationsRunsResult = {
  total: number
  runs: unknown[]
}

type HermesRunCountCacheEntry = {
  promise: Promise<number>
  expiresAt: number
}

export class ExternalAutomationsHandler {
  protected readonly hermesRunCountCache = new Map<string, HermesRunCountCacheEntry>()

  constructor(protected readonly dispatcher: RelayDispatcher) {
    this.dispatcher.onRequest('externalAutomations.list', (params) => this.listJobs(params))
    this.dispatcher.onRequest('externalAutomations.runs', (params) => this.listRuns(params))
    this.dispatcher.onRequest('externalAutomations.create', (params) => this.createJob(params))
    this.dispatcher.onRequest('externalAutomations.update', (params) => this.updateJob(params))
    this.dispatcher.onRequest('externalAutomations.act', (params) => this.runAction(params))
  }

  protected listJobs(_params?: Record<string, unknown>): Promise<ExternalAutomationsListResult> {
    return this.unimplementedStageHook('listJobs')
  }

  protected listRuns(_params?: Record<string, unknown>): Promise<ExternalAutomationsRunsResult> {
    return this.unimplementedStageHook('listRuns')
  }

  protected createJob(_params?: Record<string, unknown>): Promise<{ ok: true }> {
    return this.unimplementedStageHook('createJob')
  }

  protected updateJob(_params?: Record<string, unknown>): Promise<{ ok: true }> {
    return this.unimplementedStageHook('updateJob')
  }

  protected runAction(_params?: Record<string, unknown>): Promise<{ ok: true }> {
    return this.unimplementedStageHook('runAction')
  }

  private unimplementedStageHook(name: string): never {
    throw new Error(`External automation stage hook is not implemented: ${name}`)
  }
}
