import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import process from 'node:process'
import { log, logError, logInfo, logSuccess } from './start-emulator-process-options.mjs'

const execFileAsync = promisify(execFile)
export function assertIosSimulatorPlatform() { if (process.platform !== 'darwin') throw new Error('iOS Simulator automation requires macOS and Xcode.') }
export async function listSimulators() {
  try {
    const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', 'available'], { encoding: 'utf8' })
    const devices = []; let runtime = ''
    for (const line of stdout.split('\n')) {
      const runtimeMatch = line.match(/^-- (.+) --$/)
      if (runtimeMatch) runtime = runtimeMatch[1]
      else {
        const deviceMatch = line.match(/^\s+(.+?) \(([A-F0-9-]+)\)\s*(\(.*\))?\s*$/)
        if (deviceMatch && runtime.includes('iOS')) devices.push({ name: deviceMatch[1].trim(), udid: deviceMatch[2], runtime, status: deviceMatch[3] || '' })
      }
    }
    return devices
  } catch (error) { logError(`Failed to list simulators: ${error.message}`); return [] }
}
export async function findBestDevice(requestedDevice) {
  const devices = await listSimulators(); if (!devices.length) throw new Error('No iOS simulators found. Make sure Xcode is installed.')
  return devices.find((d) => d.name === requestedDevice) || devices.find((d) => d.name.toLowerCase().includes(requestedDevice.toLowerCase())) || devices.find((d) => d.name.includes('iPhone')) || devices[0]
}
export async function openInSimulator(url, deviceUdid) {
  logInfo('Opening app in simulator...')
  await execFileAsync('xcrun', ['simctl', 'openurl', deviceUdid, `exp+orca-mobile://expo-development-client/?url=${encodeURIComponent(url)}`])
  logSuccess('Opened app in simulator')
}
export async function openPairingUrlInSimulator(pairingUrl, deviceUdid, runtime, worktree, orca) {
  if (!pairingUrl) return
  await execFileAsync('xcrun', ['simctl', 'openurl', deviceUdid, pairingUrl]); await new Promise((resolve) => setTimeout(resolve, 2000))
  await execFileAsync('xcrun', ['simctl', 'openurl', deviceUdid, pairingUrl]); await new Promise((resolve) => setTimeout(resolve, 2000))
  await orca(['emulator', 'tap', '0.5', '0.56', '--worktree', worktree, '--json'], { cwd: worktree, env: runtime?.env || process.env, timeout: 30000 })
}
export async function takeScreenshot(deviceUdid, outputPath = path.join(os.tmpdir(), 'orca-mobile-ios.png')) {
  try { await execFileAsync('xcrun', ['simctl', 'io', deviceUdid, 'screenshot', outputPath]); logSuccess(`Screenshot saved to: ${outputPath}`); return outputPath }
  catch (error) { logError(`Failed to take screenshot: ${error.message}`); return null }
}
