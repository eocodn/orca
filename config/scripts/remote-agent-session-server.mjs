import { spawn } from 'node:child_process'
import net from 'node:net'
import { createInterface } from 'node:readline'

export async function reservePort() {
  return await new Promise((resolve, reject) => {
    const listener = net.createServer()
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address()
      const port = typeof address === 'object' && address ? address.port : 0
      listener.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

export async function startServer(context, port) {
  const {
    repoRoot,
    binPath,
    profilePath,
    spawnMarkerPath,
    exitTriggerPath,
    inputMarkerPath,
    agentSessionToken,
    childProcesses
  } = context
  let server
  const electronPath = await import('electron').then((module) => module.default)
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const pathDelimiter = process.platform === 'win32' ? ';' : ':'
  const env = {
    ...process.env,
    [pathKey]: `${binPath}${pathDelimiter}${process.env[pathKey] ?? ''}`,
    ORCA_DEV_USER_DATA_PATH: profilePath,
    ORCA_USER_DATA_PATH: profilePath,
    ORCA_REPRO_SPAWN_MARKER: spawnMarkerPath,
    ORCA_REPRO_EXIT_TRIGGER: exitTriggerPath,
    ORCA_REPRO_INPUT_MARKER: inputMarkerPath,
    ORCA_REPRO_AGENT_SESSION_TOKEN: agentSessionToken,
    ...(process.platform === 'linux' ? { ELECTRON_DISABLE_SANDBOX: '1' } : {})
  }
  server = spawn(
    electronPath,
    [
      repoRoot,
      '--serve',
      '--serve-json',
      '--serve-port',
      String(port),
      '--serve-pairing-address',
      `127.0.0.1:${port}`
    ],
    { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  )
  childProcesses.add(server)
  let stderr = ''
  server.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const lines = createInterface({ input: server.stdout })
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`server readiness timed out\n${stderr}`))
      }, 30_000)
      lines.on('line', (line) => {
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === 'orca_server_ready' && parsed.pairing?.url) {
            clearTimeout(timeout)
            resolve({ ...parsed, server })
          }
        } catch {
          // Startup diagnostics are allowed before the one structured ready line.
        }
      })
      server.once('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`server exited before readiness with code ${code}\n${stderr}`))
      })
      server.once('error', reject)
    })
  } catch (error) {
    await stopServer(server, childProcesses).catch(() => {})
    throw error
  }
}

export async function stopServer(server, childProcesses) {
  const current = server
  if (!current) {
    return
  }
  childProcesses.delete(current)
  if (current.exitCode !== null) {
    return
  }
  current.kill('SIGTERM')
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      current.kill('SIGKILL')
      resolve()
    }, 8_000)
    current.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}
