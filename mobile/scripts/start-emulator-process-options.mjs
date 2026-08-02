import process from 'node:process'

export const ORCA_CLI = process.env.ORCA_CLI || 'orca'
export const colors = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m'
}

export function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}
export function logInfo(message) { log(`[info] ${message}`, 'yellow') }
export function logSuccess(message) { log(`[ok] ${message}`, 'green') }
export function logError(message) { log(`[error] ${message}`, 'red') }

export function parseProcessOptions(args) {
  const options = {
    worktree: null, device: 'iPhone 17 Pro', port: null, open: true,
    pair: true, waitForReady: false, screenshot: false
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--worktree' && i + 1 < args.length) options.worktree = args[++i]
    else if (arg === '--device' && i + 1 < args.length) options.device = args[++i]
    else if (arg === '--port' && i + 1 < args.length) options.port = args[++i]
    else if (arg === '--no-open') options.open = false
    else if (arg === '--no-pair') options.pair = false
    else if (arg === '--wait-for-ready') options.waitForReady = true
    else if (arg === '--screenshot') options.screenshot = true
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/start-emulator.mjs [--worktree path] [--device name] [--port port] [--no-open] [--no-pair] [--wait-for-ready] [--screenshot]')
      process.exit(0)
    }
  }
  return options
}
