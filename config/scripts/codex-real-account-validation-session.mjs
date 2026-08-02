import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'
import readline from 'node:readline/promises'
import { snapshotValidationState } from './codex-real-account-validation-layout.mjs'

function validationCliCommand() {
  if (process.env.ORCA_VALIDATION_CLI) {
    return process.env.ORCA_VALIDATION_CLI
  }
  if (process.env.ORCA_CLI_COMMAND) {
    return process.env.ORCA_CLI_COMMAND
  }
  return process.platform === 'linux' ? 'orca-ide' : 'orca'
}

async function probeTerminalEnvironment(terminalHandle, launchEnv) {
  const marker = `__ORCA_CODEX_VALIDATION_${randomUUID()}__`
  const command = [
    'node -e',
    `"console.log('${marker}:' + JSON.stringify({home: require('node:os').homedir(), codexHome: process.env.CODEX_HOME || null, orcaCodexHome: process.env.ORCA_CODEX_HOME || null}))"`
  ].join(' ')
  const cli = validationCliCommand()
  execFileSync(
    cli,
    ['terminal', 'send', '--terminal', terminalHandle, '--text', command, '--enter', '--json'],
    { env: launchEnv, stdio: 'pipe' }
  )
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const output = execFileSync(cli, ['terminal', 'read', '--terminal', terminalHandle, '--json'], {
      env: launchEnv,
      encoding: 'utf8'
    })
    const match = new RegExp(`${marker}:(\\{[^\\r\\n]+\\})`).exec(output)
    if (match?.[1]) {
      return JSON.parse(match[1])
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for environment probe in terminal ${terminalHandle}`)
}

async function writeReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
}

async function runInteractiveSession(context) {
  if (process.stdin.readableEnded) {
    return
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
  const closePrompt = () => prompt.close()
  // Why: redirected stdin can close before `question()` consumes a command.
  // Race the prompt so EOF still unwinds through app and credential cleanup.
  const inputClosed = new Promise((resolve) => prompt.once('close', () => resolve(null)))
  context.signal.addEventListener('abort', closePrompt, { once: true })
  console.log('Commands: checkpoint <label>, probe <terminal-handle>, status, done')
  try {
    while (!context.signal.aborted) {
      const answer = await Promise.race([prompt.question('codex-validation> '), inputClosed])
      if (answer === null) {
        return
      }
      const line = answer.trim()
      const [command, ...rest] = line.split(/\s+/)
      if (command === 'checkpoint') {
        const label = rest.join(' ') || `checkpoint-${context.report.checkpoints.length + 1}`
        context.report.checkpoints.push({
          label,
          ...(await snapshotValidationState(context.layout)),
          primaryTripwire: context.tripwire.getStatus()
        })
        await writeReport(context.reportPath, context.report)
        console.log(`Recorded ${label}`)
      } else if (command === 'probe') {
        const terminalHandle = rest[0]
        if (!terminalHandle) {
          console.log('Usage: probe <terminal-handle>')
          continue
        }
        const environment = await probeTerminalEnvironment(terminalHandle, context.launchEnv)
        context.report.terminalProbes.push({
          capturedAt: new Date().toISOString(),
          terminalHandle,
          environment
        })
        await writeReport(context.reportPath, context.report)
        console.log(JSON.stringify(environment, null, 2))
      } else if (command === 'status') {
        console.log(JSON.stringify(context.tripwire.getStatus(), null, 2))
      } else if (command === 'done') {
        return
      } else if (command) {
        console.log('Commands: checkpoint <label>, probe <terminal-handle>, status, done')
      }
    }
  } catch (error) {
    if (!context.signal.aborted) {
      throw error
    }
  } finally {
    context.signal.removeEventListener('abort', closePrompt)
    prompt.close()
  }
}



export { runInteractiveSession, writeReport }