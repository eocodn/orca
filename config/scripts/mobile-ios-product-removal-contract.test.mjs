import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('mobile iOS product removal contract', () => {
  it('removes iOS build, release, and simulator entrypoints', () => {
    // Emulator toolchain locale strings are owned by the separate emulator-removal contract;
    // this assertion targets only the removed mobile distribution catalog keys.
    for (const relativePath of [
      '.github/workflows/mobile-ios-release.yml',
      'mobile/Gemfile',
      'mobile/fastlane/Appfile',
      'mobile/fastlane/Fastfile',
      'mobile/fastlane/ios_release_version.rb',
      'mobile/fastlane/ios_release_version_test.rb',
      'mobile/scripts/start-emulator-process-runtime.mjs',
      'mobile/scripts/start-emulator-process-options.mjs',
      'mobile/scripts/start-emulator-simulator-runtime.mjs',
      'mobile/scripts/start-emulator-metro-runtime.mjs',
      'mobile/scripts/start-emulator-network-runtime.mjs',
      'mobile/scripts/start-emulator-pairing-runtime.mjs',
      'mobile/scripts/start-emulator-runtime.mjs',
      'mobile/scripts/start-emulator.mjs'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(false)
    }

    const mobileWorkflow = readProjectFile('.github/workflows/mobile.yml')
    expect(mobileWorkflow).not.toMatch(/ios|fastlane|ruby/i)

    const androidWorkflow = readProjectFile('.github/workflows/mobile-android-release.yml')
    expect(androidWorkflow).not.toMatch(/ios|fastlane|ruby|xcode|app store/i)
  })

  it('removes iOS Expo configuration and native module sources', () => {
    const expoConfig = JSON.parse(readProjectFile('mobile/app.json'))
    expect(expoConfig.expo.ios).toBeUndefined()

    const mobilePackage = JSON.parse(readProjectFile('mobile/package.json'))
    expect(mobilePackage.scripts.ios).toBeUndefined()
    expect(mobilePackage.pnpm?.overrides?.['xcode>uuid']).toBeUndefined()
    expect(readProjectFile('mobile/README.md')).not.toMatch(/ios|xcode|iphone|ipad/i)
    expect(readProjectFile('mobile/mobile-terminal-direct-input-default.md')).not.toMatch(
      /ios|xcode|iphone|ipad/i
    )
    expect(readProjectFile('mobile/packages/expo-two-way-audio/README.md')).not.toMatch(
      /ios|xcode|iphone|ipad/i
    )
    expect(readProjectFile('mobile/pnpm-workspace.yaml')).not.toMatch(/xcode|ios/i)

    const audioConfig = readProjectFile(
      'mobile/packages/expo-two-way-audio/expo-module.config.json'
    )
    expect(audioConfig).not.toMatch(/ios/i)
    for (const relativePath of [
      'mobile/packages/expo-two-way-audio/ios',
      'mobile/src/terminal/terminal-ios-dictation-write-back.test.ts',
      'mobile/src/terminal/terminal-ios-ime-keyboard.test.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(false)
    }
  })

  it('removes iOS product copy from localized release documentation', () => {
    for (const relativePath of [
      'docs/readme/README.es.md',
      'docs/readme/README.fr.md',
      'docs/readme/README.ja.md',
      'docs/readme/README.ko.md',
      'docs/readme/README.pt.md',
      'docs/readme/README.zh-CN.md'
    ]) {
      expect(readProjectFile(relativePath), relativePath).not.toMatch(
        /\bios\b|\biphone\b|\bipad\b|\bapp[ -]?store\b|\btestflight\b/i
      )
    }
    expect(readProjectFile('README.md')).not.toMatch(
      /\bios\b|\biphone\b|\bipad\b|\bapp[ -]?store\b|\btestflight\b/i
    )
    for (const relativePath of [
      'src/renderer/src/components/mobile/MobilePage.tsx',
      'src/renderer/src/components/mobile/MobilePageContent.tsx',
      'src/renderer/src/components/mobile/MobileHero.tsx',
      'src/renderer/src/components/mobile/MobileHeroIntro.tsx',
      'src/renderer/src/components/mobile/MobileBrandIcons.tsx',
      'src/renderer/src/components/mobile/mobile-platform-copy.ts',
      'src/renderer/src/components/mobile/use-mobile-install-actions.ts',
      'src/renderer/src/components/mobile/use-mobile-install-qr.ts',
      'src/renderer/src/components/settings/MobileSettingsPane.tsx',
      'src/main/runtime/orca-runtime-run-create-mobile-session-terminal-part-64.ts',
      'mobile/app/h/[hostId]/mobile-task-workspace-screen-runtime.tsx'
    ]) {
      expect(readProjectFile(relativePath), relativePath).not.toMatch(
        /\bios\b|\biphone\b|\bipad\b|\bapp[ -]?store\b|\btestflight\b/i
      )
    }
    for (const relativePath of [
      'src/renderer/src/i18n/locales/en.json',
      'src/renderer/src/i18n/locales/es.json',
      'src/renderer/src/i18n/locales/ja.json',
      'src/renderer/src/i18n/locales/ko.json',
      'src/renderer/src/i18n/locales/zh.json'
    ]) {
      expect(readProjectFile(relativePath), relativePath).not.toMatch(
        /b5a2ed83ff|c8491c17ef|432db52b73|711e6f4b47|testFlight/i
      )
    }
  })

  it('keeps Android adaptive and shared mobile host entrypoints', () => {
    const expoConfig = JSON.parse(readProjectFile('mobile/app.json'))
    expect(expoConfig.expo.android.adaptiveIcon).toBeDefined()
    expect(expoConfig.expo.android.package).toBe('com.stably.orca.mobile')
    expect(
      existsSync(resolve(projectRoot, 'mobile/plugins/android-respect-rotation-lock.js'))
    ).toBe(true)
    expect(existsSync(resolve(projectRoot, 'mobile/packages/expo-two-way-audio/android'))).toBe(
      true
    )
    expect(
      existsSync(resolve(projectRoot, 'mobile/src/transport/host-protocol-status.test.ts'))
    ).toBe(true)
  })
})
