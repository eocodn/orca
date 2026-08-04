import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ade-control package entrypoint', () => {
  it('publishes the machine-control binary through the existing headless CLI core', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

    expect(packageJson.bin).toMatchObject({
      'ade-control': './out/cli/index.js'
    })
  })
})