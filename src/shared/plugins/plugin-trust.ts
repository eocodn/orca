import { isQualifiedPluginKey } from './plugin-manifest'

export const OFFICIAL_PLUGIN_PUBLISHER = 'stablyai'
export const OFFICIAL_PLUGIN_ID_PREFIX = 'orca-'

export function splitQualifiedPluginKey(
  pluginKey: string
): { publisher: string; id: string } | null {
  if (!isQualifiedPluginKey(pluginKey)) {
    return null
  }
  const separator = pluginKey.indexOf('.')
  return {
    publisher: pluginKey.slice(0, separator),
    id: pluginKey.slice(separator + 1)
  }
}

export function isReservedPluginIdentity(pluginKey: string): boolean {
  const identity = splitQualifiedPluginKey(pluginKey)
  return (
    identity !== null &&
    (identity.publisher === OFFICIAL_PLUGIN_PUBLISHER ||
      identity.id.startsWith(OFFICIAL_PLUGIN_ID_PREFIX))
  )
}

export function isOfficialPluginIdentity(pluginKey: string): boolean {
  const identity = splitQualifiedPluginKey(pluginKey)
  return (
    identity !== null &&
    identity.publisher === OFFICIAL_PLUGIN_PUBLISHER &&
    identity.id.startsWith(OFFICIAL_PLUGIN_ID_PREFIX)
  )
}

type GitRepositoryIdentity = { host: string; owner: string; repository: string }

function parseGitRepositoryIdentity(url: string): GitRepositoryIdentity | null {
  const trimmed = url.trim()
  const scp = /^[^\s@/:]+@([^\s:]+):(.+)$/.exec(trimmed)
  if (scp) {
    return repositoryIdentity(scp[1]!, scp[2]!)
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') {
      return null
    }
    return repositoryIdentity(parsed.hostname, parsed.pathname)
  } catch {
    return null
  }
}

function repositoryIdentity(host: string, repositoryPath: string): GitRepositoryIdentity | null {
  const segments = repositoryPath
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
  if (segments.length < 2) {
    return null
  }
  const repository = segments.at(-1)!.replace(/\.git$/i, '')
  return repository ? { host: host.toLowerCase(), owner: segments[0]!, repository } : null
}

export function isOfficialOrganizationGitSource(url: string): boolean {
  const source = parseGitRepositoryIdentity(url)
  return source?.host === 'github.com' && source.owner.toLowerCase() === OFFICIAL_PLUGIN_PUBLISHER
}
