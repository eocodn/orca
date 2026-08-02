import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { colors, logInfo } from './start-emulator-process-options.mjs'
import { normalizeMetroUrl } from './start-emulator-network-runtime.mjs'

export async function startMetro({ worktree, mobileDir, port, waitForReady, getExecutable }) {
  logInfo('Starting Metro bundler...')
  return new Promise((resolve, reject) => {
    const expoPath = getExecutable(mobileDir)
    if (!expoPath) return reject(new Error('Mobile Expo CLI is missing after dependency setup.'))
    const metro = spawn(expoPath, ['start', '--host', 'lan', '--port', String(port)], { cwd: mobileDir, env: { ...process.env, EXPO_NO_TELEMETRY: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''; let url = null; let resolved = false; let exited = false; let rl; let rlErr
    const result = () => ({ process: metro, get url() { return url }, set url(next) { url = next }, output, isExited: () => exited, closeOutput: () => { rl?.close(); rlErr?.close(); metro.stdin?.destroy(); metro.stdout?.destroy(); metro.stderr?.destroy() } })
    const finish = () => { if (!resolved && (url || !waitForReady)) { resolved = true; resolve(result()) } }
    rl = readline.createInterface({ input: metro.stdout }); rl.on('line', (line) => {
      output += line + '\n'; process.stdout.write(colors.dim + line + colors.reset + '\n')
      const waiting = line.match(/Waiting on (http:\/\/[^:]+):(\d+)/)
      if (waiting) { url = normalizeMetroUrl(`${waiting[1]}:${waiting[2]}`); logInfo(`Found Metro URL: ${url}`); if (!waitForReady) finish() }
      if (line.includes('packager-status:running') || line.includes('Metro waiting') || line.includes('Logs for your project will appear below')) finish()
    })
    rlErr = readline.createInterface({ input: metro.stderr }); rlErr.on('line', (line) => { output += line + '\n'; process.stderr.write(colors.red + line + colors.reset + '\n') })
    metro.on('error', (error) => { if (!resolved) { resolved = true; reject(new Error(`Failed to start Metro: ${error.message}`)) } })
    metro.on('exit', (code) => { exited = true; if (!resolved) { resolved = true; code === 0 ? resolve(result()) : reject(new Error(`Metro exited with code ${code}`)) } })
    setTimeout(() => { if (!resolved) { resolved = true; metro.kill(); reject(new Error('Timeout waiting for Metro to start')) } }, 120000)
  })
}
