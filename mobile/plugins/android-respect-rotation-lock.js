const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins')

// Why: Expo's top-level `orientation` only emits portrait/landscape/unspecified.
// "unspecified" still auto-rotates on many Android devices even when the system
// rotation lock is on. "fullUser" honors the user's auto-rotate setting (no
// rotation when locked) while still allowing every orientation when unlocked —
// matching the requested portrait/landscape behavior without changing Android defaults.
const ANDROID_SCREEN_ORIENTATION = 'fullUser'

module.exports = function withAndroidRespectRotationLock(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults)
    activity.$['android:screenOrientation'] = ANDROID_SCREEN_ORIENTATION
    return cfg
  })
}
