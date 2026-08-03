import { RELAY_NATIVE_DEPS } from './ssh-relay-deployment-create-install-namespace-if-supported-relay-native-deps'

export type RelayNativeDepName = keyof typeof RELAY_NATIVE_DEPS

export const RELAY_NATIVE_DEP_NAMES = Object.keys(RELAY_NATIVE_DEPS) as RelayNativeDepName[]

export const NATIVE_DEPS_MISSING_PREFIX = 'ORCA-NATIVE-DEPS-MISSING:'

// Why: npm 12 blocks dependency lifecycle scripts unless each exact package version is approved, even with ignore-scripts disabled.

export const RELAY_NATIVE_DEP_SCRIPT_ALLOWLIST = Object.fromEntries(
  Object.entries(RELAY_NATIVE_DEPS).map(([name, version]) => [`${name}@${version}`, true])
)
