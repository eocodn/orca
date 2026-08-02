import { OPENCODE_PLUGIN_SOURCE_PART_A } from './opencode-plugin-source-part-a'
import { OPENCODE_PLUGIN_SOURCE_PART_B } from './opencode-plugin-source-part-b'

export function getOpenCodePluginSource(): string {
  return getOpenCodeFamilyPluginSource('/hook/opencode')
}

export function getOpenCodeFamilyPluginSource(hookPathname: string): string {
  return [...OPENCODE_PLUGIN_SOURCE_PART_A, ...OPENCODE_PLUGIN_SOURCE_PART_B]
    .map((line) => line.replaceAll('__ORCA_HOOK_PATHNAME__', hookPathname))
    .join('\\n')
}
