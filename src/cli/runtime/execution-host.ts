import { resolveEnvironment } from './environments'

export function resolveRuntimeClientExecutionHostId(
  userDataPath: string,
  isRemote: boolean,
  environmentSelector: string | null
): 'local' | `runtime:${string}` | null {
  if (!isRemote) {
    return 'local'
  }
  // Raw pairing identifies an incarnation, while a saved environment is stable host authority.
  return environmentSelector
    ? `runtime:${resolveEnvironment(userDataPath, environmentSelector).id}`
    : null
}
