import { describe, expect, it } from 'vitest'
import {
  detectTerminalWaitBlockedReason,
  isKnownReadyPromptPreview
} from './terminal-wait-detection'

describe('terminal wait detection', () => {
  it('recognizes actionable prompts while ignoring a later ready prompt', () => {
    expect(detectTerminalWaitBlockedReason('Update available! Press Enter to continue.')).toBe(
      'codex-update-prompt'
    )
    expect(
      detectTerminalWaitBlockedReason(
        'Do you trust this workspace? Press Enter to continue. OpenAI Codex model: gpt directory: /repo'
      )
    ).toBeNull()
  })

  it('requires the stable ready header fields', () => {
    expect(isKnownReadyPromptPreview('OpenAI Codex\nmodel: gpt\ndirectory: /repo')).toBe(true)
    expect(isKnownReadyPromptPreview('OpenAI Codex\nmodel: gpt')).toBe(false)
  })
})
