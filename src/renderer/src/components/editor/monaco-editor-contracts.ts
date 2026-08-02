import type { MarkdownDocument } from '../../../../shared/types'
import type { MonacoMarkdownSelectionAnnotationTarget } from './monaco-markdown-selection-annotation'

export type MonacoEditorProps = {
  fileId: string
  filePath: string
  viewStateKey: string
  viewStateId?: string
  relativePath: string
  content: string
  language: string
  onContentChange: (content: string) => void
  onSave: (content: string) => void
  revealLine?: number
  revealColumn?: number
  revealMatchLength?: number
  markdownDocuments?: MarkdownDocument[]
  worktreeId?: string
  markdownAnnotationsEnabled?: boolean
  conflictDecorationsEnabled?: boolean
  readOnly?: boolean
  liveTail?: boolean
  autoHeight?: boolean
}

export type MarkdownCommentPopoverState = Omit<
  MonacoMarkdownSelectionAnnotationTarget,
  'selectedText'
> & {
  selectedText?: string
}
