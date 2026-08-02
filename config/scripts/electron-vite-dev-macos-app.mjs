import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'

function setPlistValue(plistPath, key, value) {
  execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plistPath])
}

function sanitizeMacAppBundleName(value) {
  return (
    Array.from(value, (char) => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 127 || char === '/' || char === '\\' ? '-' : char
    })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Orca'
  )
}

export function prepareMacDevElectronApp(repoRoot) {
  if (process.platform !== 'darwin') {
    return
  }

  const sourceAppPath = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app')
  const electronPackagePath = path.join(repoRoot, 'node_modules', 'electron', 'package.json')
  if (!existsSync(sourceAppPath)) {
    return
  }

  let electronVersion = null
  try {
    electronVersion = JSON.parse(readFileSync(electronPackagePath, 'utf8')).version ?? null
  } catch {}

  const title = process.env.ORCA_DEV_DOCK_TITLE || 'Orca: dev'
  const identityKey = process.env.ORCA_DEV_INSTANCE_KEY || repoRoot
  // v7: give the terminal daemon helper an Orca-specific TCC identity.
  const bundleLayoutVersion = 'dock-title-app-preserve-framework-symlinks-v7'
  const hash = createHash('sha1')
    .update(
      `${sourceAppPath}\0${electronVersion ?? ''}\0${title}\0${identityKey}\0${bundleLayoutVersion}`
    )
    .digest('hex')
    .slice(0, 12)
  const distDir = path.join(repoRoot, 'out', 'electron-dev', hash)
  // Why: macOS Dock hover uses the bundle's filesystem display name for
  // electron-vite's direct binary launch path, even when Info.plist is patched.
  const appBundleName = `${sanitizeMacAppBundleName(title)}.app`
  const appPath = path.join(distDir, appBundleName)
  const markerPath = path.join(distDir, 'orca-dev-electron-app.json')
  // Why: one stable id for every dev instance. Per-instance ids registered a
  // new macOS Notification Settings entry for each branch × Electron version,
  // piling up "Orca: <branch>" rows forever and breaking the notification
  // settings deep-link (System Settings can't resolve an id it has no entry
  // for and falls back to the root list). macOS keys notification permission
  // by bundle id, so a single id also means granting notifications to one dev
  // instance covers all of them. Trade-off: when two dev instances run at
  // once, macOS may route a notification click to the other instance —
  // Electron drops clicks for notification ids it didn't create, so the
  // click is lost, not misdirected.
  const bundleId = 'com.stablyai.orca.dev'
  const helperBundleId = `${bundleId}.helper`
  process.env.ORCA_DEV_MACOS_BUNDLE_ID = bundleId
  const expectedMarker = JSON.stringify(
    { title, appBundleName, bundleId, sourceAppPath, electronVersion, bundleLayoutVersion },
    null,
    2
  )
  const executablePath = path.join(appPath, 'Contents', 'MacOS', 'Electron')
  const requiredResourcePaths = [
    path.join(
      appPath,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Resources',
      'icudtl.dat'
    )
  ]

  function copiedAppIsUsable() {
    if (!existsSync(markerPath) || !existsSync(appPath)) {
      return false
    }
    try {
      if (readFileSync(markerPath, 'utf8') !== expectedMarker) {
        return false
      }
    } catch {
      return false
    }
    // Why: a previous interrupted copy can leave the marker and executable
    // present but miss Chromium framework resources, causing a blank crash.
    return (
      existsSync(executablePath) &&
      requiredResourcePaths.every((resourcePath) => existsSync(resourcePath))
    )
  }

  if (copiedAppIsUsable()) {
    process.env.ELECTRON_EXEC_PATH = executablePath
    return
  }

  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })
  // Why: Electron.framework uses relative symlinks for its bundle resources;
  // resolving them to pnpm-store absolutes breaks Chromium's bundle lookup.
  cpSync(sourceAppPath, appPath, { recursive: true, verbatimSymlinks: true })
  restoreElectronFrameworkSymlinks(appPath)

  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  const helperPlistPath = path.join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Helper.app',
    'Contents',
    'Info.plist'
  )
  setPlistValue(plistPath, 'CFBundleName', title)
  setPlistValue(plistPath, 'CFBundleDisplayName', title)
  setPlistValue(plistPath, 'CFBundleIdentifier', bundleId)
  setPlistValue(helperPlistPath, 'CFBundleIdentifier', helperBundleId)

  // Why: the notification-status helper reads the app's real macOS
  // notification authorization (UNUserNotificationCenter has no Electron
  // API). It must live inside the bundle and carry the dev bundle id as its
  // embedded/code-sign identifier — macOS keys notification records to the
  // signing identifier. Non-fatal: without swiftc the permission card falls
  // back to delivery-probe heuristics.
  try {
    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, 'config', 'scripts', 'build-notification-status-macos.mjs'),
        '--bundle-id',
        bundleId,
        '--single-arch',
        '--output',
        path.join(appPath, 'Contents', 'MacOS', 'orca-notification-status')
      ],
      { stdio: 'inherit' }
    )
  } catch (error) {
    console.warn(
      `[orca-dev] notification-status helper build failed (permission card falls back to probes): ${error?.message ?? error}`
    )
  }

  // Why: the plist edits above (and the copy itself) break the bundle's
  // ad-hoc seal, and macOS refuses Notification Center registration for
  // invalidly-signed apps — every dev notification fails with UNErrorDomain
  // error 1 and the app never appears in System Settings > Notifications.
  // An ad-hoc re-sign restores delivery, the permission prompt, and the
  // notification-settings deep link for dev builds. Non-fatal: a signing
  // failure should not block `pnpm dev`.
  try {
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath])
  } catch (error) {
    console.warn(
      `[orca-dev] ad-hoc codesign failed (dev notifications will not deliver): ${error?.message ?? error}`
    )
  }
  writeFileSync(markerPath, expectedMarker, 'utf8')
  process.env.ELECTRON_EXEC_PATH = executablePath
}

function isSymlink(filePath) {
  try {
    return lstatSync(filePath).isSymbolicLink()
  } catch {
    return false
  }
}

function ensureRelativeSymlink(linkPath, target) {
  if (isSymlink(linkPath)) {
    try {
      if (readlinkSync(linkPath) === target) {
        return
      }
    } catch {}
  }

  const targetPath = path.join(path.dirname(linkPath), target)
  if (!existsSync(targetPath)) {
    return
  }

  rmSync(linkPath, { recursive: true, force: true })
  symlinkSync(target, linkPath)
}

function restoreElectronFrameworkSymlinks(appPath) {
  const frameworkPath = path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework')
  const versionsPath = path.join(frameworkPath, 'Versions')
  if (!existsSync(path.join(versionsPath, 'A'))) {
    return
  }

  // Why: some Electron installs have framework symlinks flattened into
  // duplicate directories. Recreate the relative bundle links after copying so
  // Chromium resolves resources through the canonical macOS framework layout.
  ensureRelativeSymlink(path.join(versionsPath, 'Current'), 'A')
  for (const entry of ['Electron Framework', 'Resources', 'Libraries', 'Helpers']) {
    ensureRelativeSymlink(path.join(frameworkPath, entry), `Versions/Current/${entry}`)
  }
}
