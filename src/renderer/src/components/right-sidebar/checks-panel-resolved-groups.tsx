import React from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
import { getPRCommentGroupId, type PRCommentGroup } from '@/lib/pr-comment-groups'
import { translate } from '@/i18n/i18n'
import type { PRComment } from '../../../../shared/types'
import type { PRCommentPresentationClasses } from './pr-comment-presentation'
import type { RightPanelCommentSubmitResult } from './right-panel-comment-composer'
import { PRCommentGroupView } from './checks-panel-group-view'

export function ResolvedCommentGroupsSection({
  groups,
  botAuthorOverrides,
  replyingCommentId,
  replyDisabled,
  replyDisabledReason,
  presentation,
  onResolve,
  onStartReply,
  onCancelReply,
  onReply,
  onEditComment,
  onDeleteComment
}: {
  groups: PRCommentGroup[]
  botAuthorOverrides: ReadonlySet<string>
  replyingCommentId: number | null
  replyDisabled?: boolean
  replyDisabledReason?: string
  presentation: PRCommentPresentationClasses
  onResolve?: (threadId: string, resolve: boolean) => boolean | Promise<boolean>
  onStartReply?: (commentId: number) => void
  onCancelReply?: (commentId: number) => void
  onReply?: (comment: PRComment, body: string) => Promise<RightPanelCommentSubmitResult>
  onEditComment?: (comment: PRComment, body: string) => Promise<boolean>
  onDeleteComment?: (comment: PRComment) => void | Promise<void>
}): React.JSX.Element | null {
  if (groups.length === 0) {
    return null
  }
  return (
    <div className={presentation.resolvedSection}>
      <Accordion type="single" collapsible>
        <AccordionItem value="resolved-all" className="border-b-0">
          <AccordionTrigger className={presentation.resolvedSectionTrigger}>
            <span className="min-w-0 truncate">
              {translate(
                'auto.components.right.sidebar.checks.panel.content.e8b4c1a903',
                'Resolved · {{value0}}',
                { value0: groups.length }
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent className={presentation.resolvedSectionContent}>
            {groups.map((group) => (
              <PRCommentGroupView
                key={getPRCommentGroupId(group)}
                group={group}
                botAuthorOverrides={botAuthorOverrides}
                replyingCommentId={replyingCommentId}
                actionState="resolved"
                isQueued={false}
                replyDisabled={replyDisabled}
                replyDisabledReason={replyDisabledReason}
                presentation={presentation}
                onResolve={onResolve}
                onStartReply={onStartReply}
                onCancelReply={onCancelReply}
                onReply={onReply}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
              />
            ))}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
