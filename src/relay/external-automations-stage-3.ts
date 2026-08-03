import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const EXTERNAL_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
type HermesAction = 'pause' | 'resume' | 'run' | 'delete'

import { ExternalAutomationsHandlerStage2 } from './external-automations-stage-2'
export class ExternalAutomationsHandler extends ExternalAutomationsHandlerStage2 {
  protected async createJob(params: Record<string, unknown> = {}): Promise<{ ok: true }> {
    return this.runExternalAutomationMutation(params, async () => {
      const input = this.normalizeHermesJobMutation(params)
      const args = [
        'cron',
        'create',
        input.schedule,
        input.prompt,
        '--name',
        input.name,
        '--deliver',
        'local'
      ]
      if (input.workdir) {
        args.push('--workdir', input.workdir)
      }
      await this.runHermesCronCommand(args)
      this.clearHermesRunCountCache()
      return { ok: true }
    })
  }

  protected async updateJob(params: Record<string, unknown> = {}): Promise<{ ok: true }> {
    return this.runExternalAutomationMutation(params, async () => {
      const input = this.normalizeHermesJobMutation(params)
      const jobId = params.jobId
      if (typeof jobId !== 'string' || !EXTERNAL_JOB_ID_PATTERN.test(jobId)) {
        throw new Error('Invalid external automation job ID.')
      }
      const args = [
        'cron',
        'edit',
        jobId,
        '--schedule',
        input.schedule,
        '--prompt',
        input.prompt,
        '--name',
        input.name
      ]
      if (input.workdir) {
        args.push('--workdir', input.workdir)
      }
      await this.runHermesCronCommand(args)
      this.clearHermesRunCountCache(jobId)
      return { ok: true }
    })
  }

  protected async runAction(params: Record<string, unknown> = {}): Promise<{ ok: true }> {
    return this.runExternalAutomationMutation(params, async () => {
      const provider = params.provider === 'openclaw' ? 'openclaw' : 'hermes'
      const action = params.action
      const jobId = params.jobId
      if (action !== 'pause' && action !== 'resume' && action !== 'run' && action !== 'delete') {
        throw new Error('Unsupported external automation action.')
      }
      if (typeof jobId !== 'string' || !EXTERNAL_JOB_ID_PATTERN.test(jobId)) {
        throw new Error('Invalid external automation job ID.')
      }
      const command =
        provider === 'hermes' ? this.hermesCommand(action) : this.openClawCommand(action)
      await execFileAsync(provider, ['cron', command, jobId], {
        encoding: 'utf-8',
        timeout: 30_000
      })
      if (provider === 'hermes') {
        this.clearHermesRunCountCache(jobId)
      }
      return { ok: true }
    })
  }
}
