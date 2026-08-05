import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const manifestPath = resolve(import.meta.dirname, '../reliability-gates.jsonc')

describe('Phase 2 reliability-gate removal contract', () => {
  it('does not retain retired Native Chat or simulator gate paths', () => {
    const manifest = readFileSync(manifestPath, 'utf8')

    expect(manifest).not.toMatch(
      /mobile\/src\/session\/(?:mobile-native-chat-terminal-stream|use-mobile-native-chat-terminal-stream)\.test\.ts/
    )
    expect(manifest).not.toMatch(/native[\s-]+chat|chat toggle/i)
    expect(manifest).not.toMatch(
      /(?:simulator-palette-search|open-mobile-emulator-tab|ensure-simulator-tab|mobile-emulator-tab-intro)/
    )
  })
})
