export type InstallCopy = { ctaLabel: string; url: string }

const ANDROID_COPY: InstallCopy = {
  ctaLabel: 'Download APK',
  url: 'https://github.com/stablyai/orca/releases/download/mobile-android-v0.0.32/app-release.apk'
}

export function getInstallCopy(): InstallCopy {
  return ANDROID_COPY
}
