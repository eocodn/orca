import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClaudeIcon, DroidIcon, OpenAIIcon, OpenCodeGoIcon } from './agent-icon-glyphs'

describe('retained agent icon glyphs', () => {
  it.each([
    ['ClaudeIcon', ClaudeIcon],
    ['DroidIcon', DroidIcon],
    ['OpenAIIcon', OpenAIIcon],
    ['OpenCodeGoIcon', OpenCodeGoIcon]
  ])('renders %s at the requested size', (_name, Icon) => {
    const markup = renderToStaticMarkup(<Icon size={18} />)

    expect(markup).toContain('width="18"')
    expect(markup).toMatch(/height="(?:18|22|23)"/)
  })
})
