import { mkdtempSync } from 'node:fs'
import { mkdir, rm as realRm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SPEECH_MODEL_CATALOG } from './model-catalog'
import { ModelManager } from './model-manager'

const { renameMock } = vi.hoisted(() => ({
  renameMock: vi.fn()
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: renameMock }
})

describe('speech model download/delete ordering', () => {
  it('does not let delete finish before an installation rename', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-speech-model-manager-'))
    let finishRename!: () => void
    renameMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRename = resolve
        })
    )

    try {
      const manifest = SPEECH_MODEL_CATALOG.find((model) => model.provider === 'local')!
      const manager = new ModelManager(dir)
      vi.spyOn(manager, 'downloadModelFiles').mockImplementation(
        async (_manifest, stagingDir, _modelId, _isAborted, _signal) => {
          await mkdir(stagingDir, { recursive: true })
        }
      )

      const download = manager.downloadModel(manifest.id)
      await vi.waitFor(() => expect(renameMock).toHaveBeenCalledTimes(1))

      const deletion = manager.deleteModel(manifest.id)
      await Promise.resolve()
      expect((manager as any).modelStates.has(manifest.id)).toBe(true)

      finishRename()
      await Promise.all([download, deletion])

      expect((manager as any).modelStates.has(manifest.id)).toBe(false)
    } finally {
      renameMock.mockReset()
      await realRm(dir, { recursive: true, force: true })
    }
  })
})
