import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ListRenderItem
} from 'react-native'
import {
  Copy,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  X
} from 'lucide-react-native'
import type { DiffComment } from '../../../../../src/shared/types'
import { MobileHtmlPreview } from '../../../../src/components/MobileHtmlPreview'
import { MobileRichMarkdownEditor } from '../../../../src/components/MobileRichMarkdownEditor'
import { MobileSyntaxSegments } from '../../../../src/components/MobileSyntaxSegments'
import { resolveMarkdownFloatingActionsBottom } from '../../../../src/session/markdown-floating-actions-layout'
import {
  buildPlainMobileDiffSyntaxLines,
  highlightMobileCode,
  highlightMobileDiffLines,
  resolveMobileSyntaxLanguage
} from '../../../../src/session/mobile-file-syntax'
import { colors, spacing } from '../../../../src/theme/mobile-theme'
import { styles } from './mobile-session-styles'
import type {
  DiffCommentActions,
  DiffSyntaxState,
  FileDocState,
  FileSyntaxState,
  MarkdownDocState,
  RenderableDiffLine
} from './mobile-session-route-types'

export function MarkdownReader({
  documentId,
  doc,
  onRefresh,
  onChange,
  onSave,
  onCopy,
  onDiscard,
  keyboardLift
}: {
  documentId: string
  doc: MarkdownDocState | undefined
  onRefresh: () => void
  onChange: (content: string) => void
  onSave: () => void
  onCopy: () => void
  onDiscard: () => void
  keyboardLift: number
}) {
  // Native Keyboard events under-report the WebView editor's covered area, so prefer the larger WebView-measured inset.
  const [webviewKeyboardInset, setWebviewKeyboardInset] = useState(0)
  const effectiveKeyboardLift = Math.max(keyboardLift, webviewKeyboardInset)
  if (!doc || doc.status === 'loading') {
    return (
      <View style={styles.markdownState}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    )
  }
  if (doc.status === 'error') {
    return (
      <View style={styles.markdownState}>
        <Text style={styles.markdownError}>{doc.message}</Text>
        <Pressable style={styles.markdownRefreshButton} onPress={onRefresh}>
          <RefreshCw size={14} color={colors.textPrimary} />
          <Text style={styles.markdownRefreshText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  const statusText = doc.saveError
    ? doc.saveError
    : doc.readOnlyReason
      ? 'Read only'
      : doc.stale
        ? 'Changed on desktop'
        : null
  const showRefresh = (doc.stale && !doc.isDirty) || !doc.editable
  const showCopy = doc.saveError || !doc.editable
  const showSave = doc.isDirty || doc.saving
  const showFloatingActions = statusText || showRefresh || showCopy || showSave

  return (
    <View style={styles.markdownEditor}>
      <MobileRichMarkdownEditor
        key={documentId}
        content={doc.localContent}
        editable={doc.editable && !doc.saving}
        onChange={onChange}
        onKeyboardInsetChange={setWebviewKeyboardInset}
      />
      {showFloatingActions ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.markdownFloatingBar,
            // Why: editor focus lives in a WebView, so lift native Save/Discard controls instead of resizing it.
            {
              bottom: resolveMarkdownFloatingActionsBottom({
                keyboardLift: effectiveKeyboardLift,
                restingBottom: spacing.lg,
                liftedClearance: spacing.md
              })
            }
          ]}
        >
          {statusText ? (
            <Text
              style={[styles.markdownFloatingStatus, doc.saveError ? styles.markdownError : null]}
              numberOfLines={2}
            >
              {statusText}
            </Text>
          ) : null}
          <View style={styles.markdownFloatingActions}>
            {showCopy ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onCopy}>
                <Text style={styles.markdownFloatingButtonText}>Copy</Text>
              </Pressable>
            ) : null}
            {showRefresh ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onRefresh}>
                <RefreshCw size={13} color={colors.textPrimary} />
                <Text style={styles.markdownFloatingButtonText}>Refresh</Text>
              </Pressable>
            ) : null}
            {doc.isDirty ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onDiscard}>
                <Text style={styles.markdownFloatingButtonText}>Discard</Text>
              </Pressable>
            ) : null}
            {showSave ? (
              <Pressable
                style={[
                  styles.markdownFloatingButton,
                  styles.markdownSaveButton,
                  (!doc.editable || !doc.isDirty || doc.saving) && styles.markdownButtonDisabled
                ]}
                disabled={!doc.editable || !doc.isDirty || doc.saving}
                onPress={onSave}
              >
                {doc.saving ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.markdownFloatingButtonText}>Save</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function DiffLineRow({
  line,
  title,
  index,
  comments,
  activeCommentLine,
  commentDraft,
  commentsBusy,
  onStartComment,
  onCancelComment,
  onDraftChange,
  onSubmitComment,
  onDeleteComment
}: {
  line: RenderableDiffLine
  title: string
  index: number
  comments: DiffComment[]
  activeCommentLine: number | null
  commentDraft: string
  commentsBusy: boolean
  onStartComment: (lineNumber: number) => void
  onCancelComment: () => void
  onDraftChange: (value: string) => void
  onSubmitComment: (lineNumber: number) => void
  onDeleteComment: (commentId: string) => void
}) {
  const commentLine = line.newLineNumber
  const isCommenting = commentLine !== undefined && activeCommentLine === commentLine
  const canComment = commentLine !== undefined
  // Why: review notes anchor to the modified side, so show that line number in the single mobile gutter.
  const gutterLineNumber = line.newLineNumber ?? line.oldLineNumber ?? ''
  return (
    <View style={styles.diffLineBlock}>
      <View
        style={[
          styles.diffLine,
          line.kind === 'add' && styles.diffLineAdded,
          line.kind === 'delete' && styles.diffLineDeleted
        ]}
      >
        <Text style={styles.diffGutter}>{gutterLineNumber}</Text>
        <Text
          selectable
          style={styles.diffText}
          accessibilityLabel={`${title} diff line ${index + 1}`}
        >
          <Text
            style={[
              styles.diffPrefix,
              line.kind === 'add' && styles.diffPrefixAdded,
              line.kind === 'delete' && styles.diffPrefixDeleted
            ]}
          >
            {line.kind === 'add' ? '+ ' : line.kind === 'delete' ? '- ' : '  '}
          </Text>
          <MobileSyntaxSegments segments={line.segments} />
        </Text>
        {canComment ? (
          <Pressable
            style={({ pressed }) => [
              styles.diffCommentAddButton,
              pressed && styles.diffCommentAddButtonPressed,
              commentsBusy && styles.diffCommentButtonDisabled
            ]}
            disabled={commentsBusy}
            onPress={() => {
              if (commentLine !== undefined) {
                onStartComment(commentLine)
              }
            }}
            accessibilityLabel={`Add note on line ${commentLine}`}
          >
            <Plus size={12} color={colors.textSecondary} strokeWidth={2.3} />
          </Pressable>
        ) : null}
      </View>
      {comments.length > 0 ? (
        <View style={styles.diffCommentList}>
          {comments.map((comment) => (
            <View key={comment.id} style={styles.diffCommentCard}>
              <View style={styles.diffCommentHeader}>
                <MessageSquare size={12} color={colors.textMuted} strokeWidth={2.2} />
                <Text style={styles.diffCommentMeta}>Line {comment.lineNumber}</Text>
                <Pressable
                  style={styles.diffCommentDeleteButton}
                  disabled={commentsBusy}
                  onPress={() => onDeleteComment(comment.id)}
                  accessibilityLabel={`Delete note on line ${comment.lineNumber}`}
                >
                  <X size={12} color={colors.textMuted} strokeWidth={2.2} />
                </Pressable>
              </View>
              <Text style={styles.diffCommentBody}>{comment.body}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {isCommenting ? (
        <View style={styles.diffCommentComposer}>
          <TextInput
            style={[styles.textInput, styles.diffCommentInput]}
            value={commentDraft}
            onChangeText={onDraftChange}
            placeholder="Add review note"
            placeholderTextColor={colors.textMuted}
            editable={!commentsBusy}
            multiline
            textAlignVertical="top"
            autoFocus
          />
          <View style={styles.diffCommentComposerActions}>
            <Pressable
              style={styles.diffCommentSecondaryAction}
              disabled={commentsBusy}
              onPress={onCancelComment}
            >
              <Text style={styles.diffCommentSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.diffCommentPrimaryAction,
                (!commentDraft.trim() || commentsBusy) && styles.diffCommentButtonDisabled
              ]}
              disabled={!commentDraft.trim() || commentsBusy}
              onPress={() => {
                if (commentLine !== undefined) {
                  onSubmitComment(commentLine)
                }
              }}
            >
              <Text style={styles.diffCommentPrimaryText}>Save note</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export function FileReader({
  doc,
  title,
  relativePath,
  language,
  diffCommentActions
}: {
  doc: FileDocState | undefined
  title: string
  relativePath: string
  language?: string
  diffCommentActions?: DiffCommentActions
}) {
  const syntaxLanguage = useMemo(
    () => resolveMobileSyntaxLanguage(relativePath || title, language),
    [language, relativePath, title]
  )
  const [fileSyntax, setFileSyntax] = useState<FileSyntaxState | null>(null)
  const [diffSyntax, setDiffSyntax] = useState<DiffSyntaxState | null>(null)
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const plainDiffLines = useMemo(
    () =>
      doc?.status === 'ready' && doc.kind === 'diff'
        ? buildPlainMobileDiffSyntaxLines(doc.lines)
        : [],
    [doc]
  )
  const diffCommentsForFile = useMemo(
    () =>
      diffCommentActions?.comments.filter(
        (comment) => comment.filePath === relativePath && comment.source !== 'markdown'
      ) ?? [],
    [diffCommentActions?.comments, relativePath]
  )
  const diffCommentsByLine = useMemo(() => {
    const map = new Map<number, DiffComment[]>()
    for (const comment of diffCommentsForFile) {
      const list = map.get(comment.lineNumber) ?? []
      list.push(comment)
      map.set(comment.lineNumber, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt)
    }
    return map
  }, [diffCommentsForFile])

  const startComment = useCallback((lineNumber: number) => {
    setActiveCommentLine(lineNumber)
    setCommentDraft('')
  }, [])

  const cancelComment = useCallback(() => {
    setActiveCommentLine(null)
    setCommentDraft('')
  }, [])

  const submitComment = useCallback(
    (lineNumber: number) => {
      if (!diffCommentActions) {
        return
      }
      void diffCommentActions.onAdd(relativePath, lineNumber, commentDraft).then((added) => {
        if (added) {
          setActiveCommentLine(null)
          setCommentDraft('')
        }
      })
    },
    [commentDraft, diffCommentActions, relativePath]
  )

  const renderDiffLine: ListRenderItem<RenderableDiffLine> = useCallback(
    ({ item, index }) => (
      <DiffLineRow
        line={item}
        title={title}
        index={index}
        comments={
          item.newLineNumber !== undefined ? (diffCommentsByLine.get(item.newLineNumber) ?? []) : []
        }
        activeCommentLine={activeCommentLine}
        commentDraft={commentDraft}
        commentsBusy={diffCommentActions?.busy === true}
        onStartComment={startComment}
        onCancelComment={cancelComment}
        onDraftChange={setCommentDraft}
        onSubmitComment={submitComment}
        onDeleteComment={(commentId) => {
          if (diffCommentActions) {
            void diffCommentActions.onDelete(commentId)
          }
        }}
      />
    ),
    [
      activeCommentLine,
      cancelComment,
      commentDraft,
      diffCommentActions,
      diffCommentsByLine,
      startComment,
      submitComment,
      title
    ]
  )

  useEffect(() => {
    if (doc?.status !== 'ready') {
      return undefined
    }

    // Why: defer highlighting one tick so large files show as plain text immediately before colors are applied.
    const timer = setTimeout(() => {
      // file + html share the syntax-segment source view (html's "Source" toggle).
      if (doc.kind === 'file' || doc.kind === 'html') {
        setFileSyntax({
          doc,
          language: syntaxLanguage,
          segments: highlightMobileCode(doc.content, syntaxLanguage).segments
        })
        return
      }
      if (doc.kind === 'diff') {
        setDiffSyntax({
          doc,
          language: syntaxLanguage,
          lines: highlightMobileDiffLines(doc.lines, syntaxLanguage)
        })
      }
      // image: no syntax highlighting.
    }, 0)

    return () => clearTimeout(timer)
  }, [doc, syntaxLanguage])

  if (!doc || doc.status === 'loading') {
    return (
      <View style={styles.markdownState}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    )
  }
  if (doc.status === 'error') {
    return (
      <View style={styles.markdownState}>
        <Text style={styles.markdownError}>{doc.message}</Text>
      </View>
    )
  }

  if (doc.kind === 'diff') {
    const activeDiffSyntax =
      diffSyntax?.doc === doc && diffSyntax.language === syntaxLanguage ? diffSyntax.lines : null
    const commentCount = diffCommentActions?.comments.length ?? 0
    const unsentCommentCount =
      diffCommentActions?.comments.filter((comment) => !comment.sentAt).length ?? 0
    const commentsBusy = diffCommentActions?.busy === true
    const canCopyNotes = commentCount > 0 && !commentsBusy
    const canSendNotes = unsentCommentCount > 0 && !commentsBusy
    return (
      <View style={styles.markdownEditor}>
        {diffCommentActions ? (
          <View style={styles.diffNotesToolbar}>
            <View style={styles.diffNotesTitleRow}>
              <MessageSquare size={14} color={colors.textSecondary} strokeWidth={2.2} />
              <Text style={styles.diffNotesTitle}>
                {commentCount === 0
                  ? 'No review notes'
                  : `${commentCount} review ${commentCount === 1 ? 'note' : 'notes'}`}
              </Text>
            </View>
            <View style={styles.diffNotesActions}>
              <Pressable
                style={[
                  styles.diffNotesActionButton,
                  !canCopyNotes && styles.diffCommentButtonDisabled
                ]}
                disabled={!canCopyNotes}
                onPress={() => void diffCommentActions.onCopyAll()}
                accessibilityLabel="Copy review notes"
              >
                <Copy size={13} color={colors.textSecondary} strokeWidth={2.2} />
                <Text style={styles.diffNotesActionText}>Copy</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.diffNotesActionButton,
                  !canSendNotes && styles.diffCommentButtonDisabled
                ]}
                disabled={!canSendNotes}
                onPress={diffCommentActions.onSendAll}
                accessibilityLabel="Send review notes to AI"
              >
                <Send size={13} color={colors.textSecondary} strokeWidth={2.2} />
                <Text style={styles.diffNotesActionText}>Send</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <FlatList
          data={activeDiffSyntax ?? plainDiffLines}
          style={styles.filePreviewScroll}
          contentContainerStyle={styles.filePreviewContent}
          keyExtractor={(line, index) =>
            `${index}:${line.kind}:${line.oldLineNumber ?? ''}:${line.newLineNumber ?? ''}`
          }
          renderItem={renderDiffLine}
          initialNumToRender={32}
          maxToRenderPerBatch={48}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== 'web'}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    )
  }

  if (doc.kind === 'image') {
    return (
      <View style={styles.imagePreviewContainer}>
        <ScrollView
          style={styles.imagePreviewScroll}
          contentContainerStyle={styles.imagePreviewContent}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
        >
          <Image
            source={{ uri: doc.dataUri }}
            style={styles.imagePreview}
            resizeMode="contain"
            accessibilityLabel={`${title} image`}
          />
        </ScrollView>
      </View>
    )
  }

  const renderSourceText = (content: string) => (
    <View style={styles.markdownEditor}>
      <ScrollView
        style={styles.filePreviewScroll}
        contentContainerStyle={styles.filePreviewContent}
      >
        <Text selectable style={styles.filePreviewText} accessibilityLabel={`${title} preview`}>
          <MobileSyntaxSegments
            segments={
              fileSyntax?.doc === doc && fileSyntax.language === syntaxLanguage
                ? fileSyntax.segments
                : [{ text: content, kind: 'plain' }]
            }
          />
        </Text>
      </ScrollView>
    </View>
  )

  if (doc.kind === 'html') {
    return (
      <View style={styles.markdownEditor}>
        <MobileHtmlPreview html={doc.content} renderSource={() => renderSourceText(doc.content)} />
      </View>
    )
  }

  return renderSourceText(doc.content)
}
