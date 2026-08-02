import {
  MAX_RENDERED_DIFF_COMBINED_CHARACTERS,
  getLargeDiffRenderLimit,
  type LargeDiffRenderLimit
} from '@/components/editor/large-diff-render-limit'
import type {
  GitBranchChangeEntry,
  GitDiffResult,
  GitHubPRFile,
  GitHubPRFileContents
} from '../../../shared/types'

export function mapPRFileStatus(status: GitHubPRFile['status']): GitBranchChangeEntry['status'] {
  switch (status) {
    case 'added':
      return 'added'
    case 'removed':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    case 'copied':
      return 'copied'
    case 'changed':
    case 'modified':
    case 'unchanged':
      return 'modified'
  }
}

export function getPRFileSectionKey(path: string): string {
  return `combined-commit:${path}`
}

export function gitHubPRFileToBranchEntry(file: GitHubPRFile): GitBranchChangeEntry {
  return {
    path: file.path,
    oldPath: file.oldPath,
    status: mapPRFileStatus(file.status),
    added: file.additions,
    removed: file.deletions
  }
}

export function getPRFileContentsRenderLimit(contents: GitHubPRFileContents): LargeDiffRenderLimit {
  if (!contents.originalTooLarge && !contents.modifiedTooLarge) {
    return getLargeDiffRenderLimit({
      originalContent: contents.original,
      modifiedContent: contents.modified
    })
  }

  return {
    limited: true,
    reason: 'character-count' as const,
    lineCounts: null,
    characterCount:
      contents.original.length +
      contents.modified.length +
      (contents.originalTooLarge ? GITHUB_PR_RAW_CONTENT_OVERFLOW_CHARACTER_COUNT : 0) +
      (contents.modifiedTooLarge ? GITHUB_PR_RAW_CONTENT_OVERFLOW_CHARACTER_COUNT : 0),
    limits: {
      maxLinesPerSide: MAX_RENDERED_DIFF_LINES_PER_SIDE,
      maxCombinedCharacters: MAX_RENDERED_DIFF_COMBINED_CHARACTERS
    }
  }
}

export function getPRFileDiffResult(contents: GitHubPRFileContents): GitDiffResult {
  if (contents.originalIsBinary) {
    return {
      kind: 'binary',
      originalContent: contents.original,
      modifiedContent: contents.modified,
      originalIsBinary: true,
      modifiedIsBinary: contents.modifiedIsBinary
    }
  }
  if (contents.modifiedIsBinary) {
    return {
      kind: 'binary',
      originalContent: contents.original,
      modifiedContent: contents.modified,
      originalIsBinary: false,
      modifiedIsBinary: true
    }
  }

  return {
    kind: 'text',
    originalContent: contents.original,
    modifiedContent: contents.modified,
    originalIsBinary: false,
    modifiedIsBinary: false
  }
}

