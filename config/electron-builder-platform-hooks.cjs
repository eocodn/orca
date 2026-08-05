const { chmodSync, existsSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const isMacHourly = process.env.ORCA_MAC_HOURLY === '1'
const isMacRelease = process.env.ORCA_MAC_RELEASE === '1' || isMacHourly

function chmodUnixCliLaunchers(resourcesDir, electronPlatformName) {
  if (electronPlatformName === 'win32') return
  for (const launcherName of ['orca', 'orca-ide']) {
    const launcherPath = join(resourcesDir, 'bin', launcherName)
    if (!existsSync(launcherPath)) continue
    // Why: packaged Unix installs expose these resources as public commands.
    chmodSync(launcherPath, 0o755)
  }
}

async function signMacNotificationStatusHelper(helperPath, packager) {
  if (!existsSync(helperPath)) {
    if (isMacRelease) throw new Error(`Missing orca-notification-status helper at ${helperPath}`)
    return
  }
  const codeSigningInfo =
    isMacRelease && process.env.CSC_LINK && packager?.codeSigningInfo?.value
      ? await packager.codeSigningInfo.value
      : null
  const identity =
    process.env.CSC_NAME ??
    findInstalledMacSigningIdentity(codeSigningInfo?.keychainFile) ??
    (isMacRelease ? null : '-')
  if (!identity) throw new Error('Missing signing identity for orca-notification-status helper')
  const args = ['--force', '--sign', identity]
  if (isMacRelease) args.push('--options', 'runtime', '--timestamp')
  args.push(helperPath)
  execFileSync('codesign', args, { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--strict', helperPath], { stdio: 'inherit' })
}

function findInstalledMacSigningIdentity(keychainFile) {
  try {
    const output = execFileSync(
      'security',
      ['find-identity', '-v', '-p', 'codesigning', ...(keychainFile ? [keychainFile] : [])],
      { encoding: 'utf8' }
    )
    const releaseMatch =
      output.match(/"([^"]*Developer ID Application:[^"]+)"/) ??
      output.match(/"([^"]*Apple Distribution:[^"]+)"/)
    if (releaseMatch?.[1]) return releaseMatch[1]
    if (!isMacRelease) return output.match(/"([^"]*Apple Development:[^"]+)"/)?.[1] ?? null
  } catch {}
  return null
}

module.exports = {
  chmodUnixCliLaunchers,
  signMacNotificationStatusHelper
}
