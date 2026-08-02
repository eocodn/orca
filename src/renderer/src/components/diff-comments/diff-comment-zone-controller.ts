import React, { useEffect } from 'react'
import type { editor as monacoEditor } from 'monaco-editor'
import { createRoot, type Root } from 'react-dom/client'
import type { DiffComment } from '../../../../shared/types'
import { getCommentBodyLayoutLineCount } from '@/lib/comment-body-line-count'
import { getDiffCommentLineLabel } from '@/lib/diff-comment-compat'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DiffCommentCard } from './DiffCommentCard'
import { installDiffCommentZoneMouseDownStopper } from './diff-comment-zone-mouse-events'
import { NotesSendMenu } from '../editor/NotesSendMenu'
import type { DecoratedDiffComment } from './use-diff-comment-decorator-surface'

export type ZoneEntry = {
  zoneId: string
  domNode: HTMLElement
  delegate: monacoEditor.IViewZone
  root: Root
  disposeMouseDownStopper: () => void
  lastRenderSignature: string
  laidOut: boolean
}
export function useDiffCommentZoneController({
  editor,
  filePath,
  worktreeId,
  comments,
  activeGroupId,
  formatCommentPrompt,
  clearDeliveredDiffComments,
  zonesRef,
  pendingScrollRef,
  scrollToZoneRef,
  scrollToZoneFrameRef,
  cancelScrollToZoneFrame,
  onDeleteCommentRef,
  onUpdateCommentRef,
  onPendingScrollConsumedRef,
  getSingleCommentSendScopes
}: {
  editor: monacoEditor.ICodeEditor
  filePath: string
  worktreeId: string
  comments: readonly DecoratedDiffComment[]
  activeGroupId: string
  formatCommentPrompt?: (comment: DecoratedDiffComment) => string
  clearDeliveredDiffComments: (worktreeId: string, notes: readonly DiffComment[]) => unknown
  zonesRef: React.MutableRefObject<Map<string, ZoneEntry>>
  pendingScrollRef: React.MutableRefObject<string | null>
  scrollToZoneRef: React.MutableRefObject<((commentId: string) => void) | null>
  scrollToZoneFrameRef: React.MutableRefObject<number | null>
  cancelScrollToZoneFrame: () => void
  onDeleteCommentRef: React.MutableRefObject<(commentId: string) => void>
  onUpdateCommentRef: React.MutableRefObject<((commentId: string, body: string) => Promise<boolean>) | undefined>
  onPendingScrollConsumedRef: React.MutableRefObject<(() => void) | undefined>
  getSingleCommentSendScopes: (
    comment: DecoratedDiffComment,
    formatCommentPrompt?: (comment: DecoratedDiffComment) => string
  ) => Array<{ id: string; label: string; notes: DecoratedDiffComment[]; prompt: string }>
}): void {
  useEffect(() => {
    if (!editor) {
      return
    }

    const relevant = comments.filter((c) => c.filePath === filePath && c.worktreeId === worktreeId)
    const relevantMap = new Map(relevant.map((c) => [c.id, c] as const))

    const zones = zonesRef.current
    // Unmounting a root inside changeViewZones races Monaco's zone bookkeeping; collect roots and unmount after the batch.
    const rootsToUnmount: Root[] = []

    // Re-measure/re-layout the zone: mutate delegate.heightInPx first (Monaco's _layoutZone re-reads it) so inline edit expands without clipping.
    const resizeZone = (commentId: string): void => {
      const entry = zones.get(commentId)
      if (!entry) {
        return
      }
      const child = entry.domNode.firstElementChild
      const wrapperStyle = window.getComputedStyle(entry.domNode)
      const verticalPadding =
        Number.parseFloat(wrapperStyle.paddingTop) + Number.parseFloat(wrapperStyle.paddingBottom)
      // Monaco pins the zone node to its previous height (scrollHeight can't shrink), so measure the rendered card+padding to allow collapse.
      const childHeight = child?.getBoundingClientRect().height ?? 0
      // React can commit while Monaco's zone is detached; preserve the safe
      // initial estimate until the observer sees a measurable card.
      if (childHeight <= 0) {
        return
      }
      const measured = Math.ceil(childHeight + verticalPadding)
      if (entry.delegate.heightInPx === measured) {
        return
      }
      entry.delegate.heightInPx = measured
      editor.changeViewZones((acc) => {
        acc.layoutZone(entry.zoneId)
      })
    }

    // One-shot scroll resolver: getTopForLineNumber(line, includeZones=true) centers on the line+card pair (card sits in a zone above the line).
    // rAF defer is intentional: run after DiffViewer's restoreViewState rAF so its cached scroll doesn't snap us back off the note.
    const scrollToZone = (commentId: string): void => {
      cancelScrollToZoneFrame()
      scrollToZoneFrameRef.current = requestAnimationFrame(() => {
        scrollToZoneFrameRef.current = null
        const entry = zones.get(commentId)
        if (!entry || !editor.getModel()) {
          return
        }
        if (pendingScrollRef.current !== commentId) {
          return
        }
        const top = editor.getTopForLineNumber(entry.delegate.afterLineNumber, true)
        const editorHeight = editor.getLayoutInfo().height
        editor.setScrollTop(Math.max(0, top - editorHeight / 2))
        pendingScrollRef.current = null
        onPendingScrollConsumedRef.current?.()
      })
    }
    scrollToZoneRef.current = scrollToZone

    // Shared by the new-zone and patch branches so the card's prop wiring stays in lockstep.
    const renderCard = (root: Root, comment: DecoratedDiffComment): void => {
      root.render(
        // View zones are separate React roots outside the app root, so App.tsx context providers don't reach them.
        <TooltipProvider delayDuration={400}>
          <DiffCommentCard
            lineNumber={comment.lineNumber}
            startLine={comment.startLine}
            label={comment.author ? getDiffCommentLineLabel(comment).toLowerCase() : undefined}
            body={comment.body}
            sentAt={comment.sentAt}
            author={comment.author}
            createdAtLabel={comment.createdAtLabel}
            url={comment.url}
            onDelete={
              comment.canDelete === false ? undefined : () => onDeleteCommentRef.current(comment.id)
            }
            onSubmitEdit={
              onUpdateCommentRef.current && comment.canEdit !== false
                ? async (body) => {
                    const fn = onUpdateCommentRef.current
                    if (!fn) {
                      return false
                    }
                    return fn(comment.id, body)
                  }
                : undefined
            }
            onContentResize={() => resizeZone(comment.id)}
            observeRenderedSize
            headerActions={
              worktreeId && comment.author === undefined ? (
                <NotesSendMenu
                  worktreeId={worktreeId}
                  groupId={activeGroupId}
                  modeIdParts={['diff-comment-note', worktreeId, filePath, comment.id]}
                  scopes={getSingleCommentSendScopes(comment, formatCommentPrompt)}
                  targetModeLabel="This note"
                  triggerClassName="orca-diff-comment-edit"
                  disabledTooltip="Note already sent"
                  onDelivered={(notes) => void clearDeliveredDiffComments(worktreeId, notes)}
                />
              ) : null
            }
          />
        </TooltipProvider>
      )
    }

    editor.changeViewZones((accessor) => {
      // Remove only zones whose comments are gone; rebuilding all caused flicker and dropped focus/selection.
      for (const [commentId, entry] of zones) {
        if (!relevantMap.has(commentId)) {
          accessor.removeZone(entry.zoneId)
          entry.disposeMouseDownStopper()
          rootsToUnmount.push(entry.root)
          zones.delete(commentId)
          // Comment deleted: drop any pending scroll request so a future zone reusing the id can't pick up a stale request.
          if (pendingScrollRef.current === commentId) {
            pendingScrollRef.current = null
          }
        }
      }

      for (const c of relevant) {
        if (zones.has(c.id)) {
          continue
        }
        const dom = document.createElement('div')
        dom.className = 'orca-diff-comment-inline'
        // Swallow mousedown on the zone so the editor doesn't steal focus / start a selection drag; Delete still fires (click is on the button).
        const disposeMouseDownStopper = installDiffCommentZoneMouseDownStopper(dom)

        const root = createRoot(dom)

        // Estimate height up front: Monaco fixes heightInPx at insertion and never re-measures, so an underestimate bleeds into the next line.
        const lineCount = getCommentBodyLayoutLineCount(c.body)
        const heightInPx = Math.max(ZONE_MIN_PX, ZONE_CHROME_PX + lineCount * ZONE_LINE_PX)

        // suppressMouseDown: false so clicks (Delete button) reach our DOM listeners; true would route mousedown to the editor.
        const commentId = c.id
        const delegate: monacoEditor.IViewZone = {
          afterLineNumber: c.lineNumber,
          heightInPx,
          domNode: dom,
          suppressMouseDown: false,
          // First onDomNodeTop = deterministic "zone placed" signal: resolve any waiting scroll and flip laidOut.
          onDomNodeTop: () => {
            const entry = zones.get(commentId)
            if (!entry) {
              return
            }
            const wasLaidOut = entry.laidOut
            entry.laidOut = true
            if (!wasLaidOut && pendingScrollRef.current === commentId) {
              scrollToZone(commentId)
            }
          }
        }
        const zoneId = accessor.addZone(delegate)
        zones.set(c.id, {
          zoneId,
          domNode: dom,
          delegate,
          root,
          disposeMouseDownStopper,
          lastRenderSignature: getRenderSignature(c, formatCommentPrompt),
          laidOut: false
        })
        renderCard(root, c)
      }

      // Patch existing zones in place — re-render the same root instead of removing/re-adding.
      for (const c of relevant) {
        const entry = zones.get(c.id)
        if (!entry) {
          continue
        }
        const renderSignature = getRenderSignature(c, formatCommentPrompt)
        if (entry.lastRenderSignature === renderSignature) {
          continue
        }
        entry.lastRenderSignature = renderSignature
        renderCard(entry.root, c)
      }
    })

    // Deferred unmount so Monaco finishes its zone batch before we tear down the React trees.
    if (rootsToUnmount.length > 0) {
      queueMicrotask(() => {
        for (const root of rootsToUnmount) {
          root.unmount()
        }
      })
    }
    // Intentionally no cleanup: React would wipe all zones on every comments change (flicker). Teardown lives in the editor-scoped effect above.
  }, [
    activeGroupId,
    cancelScrollToZoneFrame,
    clearDeliveredDiffComments,
    editor,
    filePath,
    formatCommentPrompt,
    monacoModelIdentity,
    worktreeId,
    comments
  ])

  // Scroll-to-note resolution splits across this effect (request after layout) and onDomNodeTop (before), via pendingScrollRef.
}
