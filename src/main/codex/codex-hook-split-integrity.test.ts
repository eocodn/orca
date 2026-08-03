import { describe, expect, it } from 'vitest'

import {
  readHookTrustEntriesFromContent,
  upsertHookTrustEntriesInContent,
  upsertProjectTrustLevelInContent
} from './config-toml-trust'
import * as runtimeInstallation from './codex-hook-runtime-installation'

describe('codex hook split module bindings', () => {
  it('loads trust readers and writers through the split facade', () => {
    const entry = {
      sourcePath: '/tmp/hooks.json',
      eventLabel: 'session_start' as const,
      groupIndex: 0,
      handlerIndex: 0,
      command: '/tmp/codex-hook.sh'
    }

    const trustContent = upsertHookTrustEntriesInContent('', [entry])
    const entries = readHookTrustEntriesFromContent(trustContent)

    expect(entries.get('/tmp/hooks.json:session_start:0:0')?.trustedHash).toMatch(/^sha256:/)
    expect(upsertProjectTrustLevelInContent('', '/tmp/project', 'trusted')).toContain(
      'trust_level = "trusted"'
    )
    expect(typeof runtimeInstallation.installForRuntimeHome).toBe('function')
  })
})
