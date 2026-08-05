import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

const removedPaths = [
  'src/main/speech',
  'src/main/ipc/speech.ts',
  'src/preload/preload-api-speech.ts',
  'src/shared/speech-types.ts',
  'src/renderer/src/components/dictation',
  'src/renderer/src/components/settings/VoicePane.tsx',
  'src/renderer/src/components/settings/VoiceDictationSettingsSection.tsx',
  'mobile/src/dictation',
  'mobile/src/hooks/use-mobile-dictation.ts',
  'mobile/src/hooks/mobile-dictation-audio-chunk.ts',
  'mobile/app/voice-settings.tsx',
  'mobile/packages/expo-two-way-audio'
]

describe('voice/audio product removal contract', () => {
  it('removes retired voice paths, dependencies, and permissions while preserving terminal protocols', () => {
    for (const relativePath of removedPaths) {
      assert.equal(
        existsSync(resolve(root, relativePath)),
        false,
        `retired voice path remains: ${relativePath}`
      )
    }

    assert.equal(read('package.json').includes('sherpa-onnx'), false)
    assert.equal(read('mobile/package.json').includes('@orca/expo-two-way-audio'), false)
    assert.equal(read('mobile/app.json').includes('RECORD_AUDIO'), false)
    assert.equal(read('mobile/app.json').includes('MODIFY_AUDIO_SETTINGS'), false)
    assert.equal(read('electron.vite.config.ts').includes('stt-worker'), false)
    assert.equal(read('electron.vite.config.ts').includes('src/main/speech'), false)

    // Terminal input and Host protocol contracts remain product-critical.
    assert.ok(existsSync(resolve(root, 'src/shared/terminal-input.ts')))
    assert.ok(existsSync(resolve(root, 'src/shared/host-protocol.ts')))
    assert.ok(existsSync(resolve(root, 'mobile/src/session/MobileTerminalInputActions.tsx')))
    assert.ok(existsSync(resolve(root, 'mobile/src/components/HostProtocolGate.tsx')))
  })
})
