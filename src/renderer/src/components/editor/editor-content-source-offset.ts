import type { OpenFile, PendingEditorReveal } from '@/store/slices/editor'

export function getMarkdownSourceLineOffset(frontMatterRaw: string): number {
  let offset = 0
  for (let index = 0; index < frontMatterRaw.length; index++) {
    const code = frontMatterRaw.charCodeAt(index)
    if (code === 13) {
      offset++
      if (frontMatterRaw.charCodeAt(index + 1) === 10) index++
      continue
    }
    if (code === 10) offset++
  }
  return offset
}

export function matchesPendingEditorReveal(
  reveal: PendingEditorReveal | null,
  file: Pick<OpenFile, 'id' | 'filePath'>
): reveal is PendingEditorReveal {
  if (!reveal) return false
  return reveal.fileId ? reveal.fileId === file.id : reveal.filePath === file.filePath
}
