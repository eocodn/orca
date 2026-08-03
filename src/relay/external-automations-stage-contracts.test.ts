import { describe, expectTypeOf, it } from 'vitest'
import { ExternalAutomationsHandler } from './external-automations-stage-state'

type ListJobsResult = {
  jobs: unknown[]
  hermesAvailable: boolean
  openclawAvailable: boolean
  error: string | null
}

type ListRunsResult = {
  total: number
  runs: unknown[]
}

class ExternalAutomationsContractProbe extends ExternalAutomationsHandler {
  exposeContracts(): {
    listJobs: (params?: Record<string, unknown>) => Promise<ListJobsResult>
    listRuns: (params?: Record<string, unknown>) => Promise<ListRunsResult>
    createJob: (params?: Record<string, unknown>) => Promise<{ ok: true }>
    updateJob: (params?: Record<string, unknown>) => Promise<{ ok: true }>
    runAction: (params?: Record<string, unknown>) => Promise<{ ok: true }>
  } {
    return {
      listJobs: (params) => this.listJobs(params),
      listRuns: (params) => this.listRuns(params),
      createJob: (params) => this.createJob(params),
      updateJob: (params) => this.updateJob(params),
      runAction: (params) => this.runAction(params)
    }
  }
}

describe('external automation stage contracts', () => {
  it('keeps request handler methods callable with optional parameter records', () => {
    expectTypeOf<ExternalAutomationsContractProbe['exposeContracts']>()
      .returns.toEqualTypeOf<{
        listJobs: (params?: Record<string, unknown>) => Promise<ListJobsResult>
        listRuns: (params?: Record<string, unknown>) => Promise<ListRunsResult>
        createJob: (params?: Record<string, unknown>) => Promise<{ ok: true }>
        updateJob: (params?: Record<string, unknown>) => Promise<{ ok: true }>
        runAction: (params?: Record<string, unknown>) => Promise<{ ok: true }>
      }>()
  })
})
