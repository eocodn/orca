import React from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoaderCircle, RefreshCw, X, Send, ExternalLink } from 'lucide-react'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { CommentCard, PipelineJobRow, StateBadge, parseGitLabLabelDraft } from './gitlab-item-dialog-content'

type GitLabItemDialogViewContext = Record<string, any>

export function GitLabItemDialogTabs({ context }: { context: GitLabItemDialogViewContext }): React.JSX.Element {
  const {
    approvalState,
    bodyDraft,
    canSubmitInlineComment,
    currentReviewers,
    details,
    detailsSaving,
    editingDetails,
    error,
    expandedJobId,
    file,
    handleCancelDetailsEdit,
    handleResolveDiscussion,
    handleRetryJob,
    handleSaveDetails,
    handleSetReviewers,
    handleStartDetailsEdit,
    handleSubmitInlineComment,
    handleToggleJobTrace,
    inlineCommentBody,
    inlineCommentFilePath,
    inlineCommentLine,
    inlineCommentSubmitting,
    isMR,
    item,
    jobTraceById,
    labelDraft,
    labelOptionsLoading,
    labelSuggestionOptions,
    labels,
    loadGitLabReviewerOptions,
    loading,
    resolvingThreadId,
    retryingJobId,
    reviewerDraftId,
    reviewerOptionRows,
    reviewerOptions,
    reviewerOptionsLoading,
    reviewerUpdating,
    setBodyDraft,
    setInlineCommentBody,
    setInlineCommentFilePath,
    setInlineCommentLine,
    setLabelDraft,
    setReviewerDraftId,
    setTitleDraft,
    titleDraft,
  } = context
  return (
            <Tabs defaultValue="description" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-5 mt-3 self-start">
                <TabsTrigger value="description">
                  {translate('auto.components.GitLabItemDialog.908d8d2a73', 'Description')}
                </TabsTrigger>
                <TabsTrigger value="conversation">
                  {translate('auto.components.GitLabItemDialog.c996e2962c', 'Conversation')}
                  {details?.comments?.length ? (
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] font-medium">
                      {details.comments.length}
                    </span>
                  ) : null}
                </TabsTrigger>
                {isMR ? (
                  <TabsTrigger value="files">
                    {translate('auto.components.GitLabItemDialog.be3d291837', 'Files')}
                    {details?.files?.length ? (
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] font-medium">
                        {details.files.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                ) : null}
                {isMR ? (
                  <TabsTrigger value="pipeline">
                    {translate('auto.components.GitLabItemDialog.02cbe2de44', 'Pipeline')}
                    {details?.pipelineJobs?.length ? (
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] font-medium">
                        {details.pipelineJobs.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                ) : null}
              </TabsList>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-sleek">
                {error ? (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}

                <TabsContent value="description" className="mt-0">
                  {!loading && details && isMR ? (
                    <div className="mb-4 rounded-md border border-border/50 bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium text-foreground">
                            {translate('auto.components.GitLabItemDialog.4f9313984d', 'Reviewers')}
                          </div>
                          {approvalState ? (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {approvalState.approvalsLeft === 0
                                ? translate(
                                    'auto.components.GitLabItemDialog.22511537d2',
                                    'Approved'
                                  )
                                : translate(
                                    'auto.components.GitLabItemDialog.40c56b95e2',
                                    '{{value0}} approval{{value1}} remaining',
                                    {
                                      value0: approvalState.approvalsLeft ?? 0,
                                      value1: approvalState.approvalsLeft === 1 ? '' : 's'
                                    }
                                  )}
                              {typeof approvalState.approvalsRequired === 'number'
                                ? translate(
                                    'auto.components.GitLabItemDialog.00f3bab87b',
                                    ' of {{value0}} required',
                                    { value0: approvalState.approvalsRequired }
                                  )
                                : ''}
                            </div>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={reviewerOptionsLoading}
                          onClick={() => void loadGitLabReviewerOptions()}
                        >
                          {reviewerOptionsLoading ? (
                            <LoaderCircle className="size-3 animate-spin" />
                          ) : null}
                          {translate('auto.components.GitLabItemDialog.cb55b0390f', 'Manage')}
                        </Button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {currentReviewers.length > 0 ? (
                          currentReviewers.map((reviewer) => (
                            <span
                              key={gitLabUserKey(reviewer)}
                              className="inline-flex h-6 items-center gap-1 rounded-full border border-border/50 bg-background px-2 text-[11px] text-foreground"
                            >
                              {reviewer.username}
                              <button
                                type="button"
                                disabled={reviewerUpdating}
                                onClick={() =>
                                  void handleSetReviewers(
                                    currentReviewers.filter(
                                      (row) => gitLabUserKey(row) !== gitLabUserKey(reviewer)
                                    )
                                  )
                                }
                                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                aria-label={translate(
                                  'auto.components.GitLabItemDialog.1b19cdc510',
                                  'Remove reviewer {{value0}}',
                                  { value0: reviewer.username }
                                )}
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {translate(
                              'auto.components.GitLabItemDialog.474b50d988',
                              'No reviewers.'
                            )}
                          </span>
                        )}
                      </div>
                      {reviewerOptions ? (
                        <div className="mt-2 flex items-center gap-2">
                          <select
                            value={reviewerDraftId}
                            disabled={reviewerUpdating || reviewerOptionRows.length === 0}
                            onChange={(event) => setReviewerDraftId(event.target.value)}
                            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                          >
                            <option value="">
                              {translate(
                                'auto.components.GitLabItemDialog.05939e977d',
                                'Add reviewer'
                              )}
                            </option>
                            {reviewerOptionRows.map((reviewer) => (
                              <option key={gitLabUserKey(reviewer)} value={gitLabUserKey(reviewer)}>
                                {reviewer.username}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            size="xs"
                            disabled={!reviewerDraftId || reviewerUpdating}
                            onClick={() => {
                              const reviewer = reviewerOptionRows.find(
                                (user) => gitLabUserKey(user) === reviewerDraftId
                              )
                              if (reviewer) {
                                void handleSetReviewers([...currentReviewers, reviewer])
                              }
                            }}
                          >
                            {reviewerUpdating ? (
                              <LoaderCircle className="size-3 animate-spin" />
                            ) : null}
                            {translate('auto.components.GitLabItemDialog.7a2117129a', 'Add')}
                          </Button>
                        </div>
                      ) : null}
                      {approvalState?.rules.length ? (
                        <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                          {approvalState.rules.map((rule) => (
                            <div
                              key={rule.id}
                              className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                            >
                              <span className="min-w-0 truncate">{rule.name}</span>
                              <span>
                                {rule.approved
                                  ? translate(
                                      'auto.components.GitLabItemDialog.22511537d2',
                                      'Approved'
                                    )
                                  : translate(
                                      'auto.components.GitLabItemDialog.6de8ce0cc6',
                                      '{{value0}} required',
                                      { value0: rule.approvalsRequired }
                                    )}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {loading && !details ? (
                    <div className="flex items-center justify-center py-12">
                      <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : editingDetails ? (
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          {translate('auto.components.GitLabItemDialog.89f3f19368', 'Title')}
                        </label>
                        <input
                          value={titleDraft}
                          onChange={(event) => setTitleDraft(event.target.value)}
                          disabled={detailsSaving}
                          className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/50"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          {translate('auto.components.GitLabItemDialog.908d8d2a73', 'Description')}
                        </label>
                        <textarea
                          value={bodyDraft}
                          onChange={(event) => setBodyDraft(event.target.value)}
                          rows={8}
                          disabled={detailsSaving}
                          className="min-h-40 w-full resize-y rounded-md border border-input bg-transparent px-2.5 py-2 text-sm shadow-xs focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/50"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          {translate('auto.components.GitLabItemDialog.dde24ade55', 'Labels')}
                        </label>
                        <input
                          value={labelDraft}
                          onChange={(event) => setLabelDraft(event.target.value)}
                          disabled={detailsSaving}
                          placeholder={translate(
                            'auto.components.GitLabItemDialog.3c0b6ccca7',
                            'bug, backend'
                          )}
                          className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/50"
                        />
                        {labelOptionsLoading || labelSuggestionOptions.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {labelOptionsLoading ? (
                              <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border/50 px-2 text-[11px] text-muted-foreground">
                                <LoaderCircle className="size-3 animate-spin" />
                                {translate(
                                  'auto.components.GitLabItemDialog.717b706849',
                                  'Loading labels'
                                )}
                              </span>
                            ) : null}
                            {labelSuggestionOptions.map((label) => {
                              const selected = parseGitLabLabelDraft(labelDraft).some(
                                (item) => item.toLowerCase() === label.toLowerCase()
                              )
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  disabled={detailsSaving}
                                  onClick={() =>
                                    setLabelDraft(toggleGitLabLabelDraft(labelDraft, label))
                                  }
                                  className={cn(
                                    'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors',
                                    selected
                                      ? 'border-primary/40 bg-primary/10 text-primary'
                                      : 'border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/60'
                                  )}
                                >
                                  {selected ? <Check className="size-3" /> : null}
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={detailsSaving}
                          onClick={handleCancelDetailsEdit}
                        >
                          <X className="size-3.5" />
                          {translate('auto.components.GitLabItemDialog.f72fad3b16', 'Cancel')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={detailsSaving || !titleDraft.trim()}
                          onClick={() => void handleSaveDetails()}
                        >
                          {detailsSaving ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Check className="size-3.5" />
                          )}
                          {translate('auto.components.GitLabItemDialog.93f79a3fc1', 'Save')}
                        </Button>
                      </div>
                    </div>
                  ) : details?.body ? (
                    <div>
                      {isMR && details ? (
                        <div className="mb-3 flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleStartDetailsEdit}
                            className="gap-1.5"
                          >
                            <Pencil className="size-3.5" />
                            {translate('auto.components.GitLabItemDialog.da4174b00f', 'Edit')}
                          </Button>
                        </div>
                      ) : null}
                      <CommentMarkdown
                        content={details.body}
                        variant="document"
                        className="min-w-0 max-w-full overflow-hidden break-words text-[13px] leading-relaxed [&_a]:break-all [&_code]:break-words [&_pre]:max-w-full"
                      />
                    </div>
                  ) : (
                    <div>
                      {isMR && details ? (
                        <div className="mb-3 flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleStartDetailsEdit}
                            className="gap-1.5"
                          >
                            <Pencil className="size-3.5" />
                            {translate('auto.components.GitLabItemDialog.da4174b00f', 'Edit')}
                          </Button>
                        </div>
                      ) : null}
                      <p className="text-sm text-muted-foreground">
                        {translate(
                          'auto.components.GitLabItemDialog.14423484db',
                          'No description.'
                        )}
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="conversation" className="mt-0 space-y-3">
                  {loading && !details ? (
                    <div className="flex items-center justify-center py-12">
                      <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : details?.comments?.length ? (
                    details.comments.map((c) => (
                      <CommentCard
                        key={c.id}
                        comment={c}
                        canResolve={isMR}
                        resolving={resolvingThreadId === c.threadId}
                        onResolve={(threadId, resolved) =>
                          void handleResolveDiscussion(threadId, resolved)
                        }
                      />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {translate('auto.components.GitLabItemDialog.85a8170279', 'No comments yet.')}
                    </p>
                  )}
                </TabsContent>

                {isMR ? (
                  <TabsContent value="files" className="mt-0 space-y-3">
                    {loading && !details ? (
                      <div className="flex items-center justify-center py-12">
                        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : details?.files?.length ? (
                      <>
                        <div className="rounded-md border border-border/50 bg-muted/20 p-3">
                          <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2">
                            <select
                              value={inlineCommentFilePath}
                              onChange={(event) => setInlineCommentFilePath(event.target.value)}
                              className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                            >
                              <option value="">
                                {translate('auto.components.GitLabItemDialog.ceb08a733d', 'File')}
                              </option>
                              {details.files.map((file) => (
                                <option key={file.path} value={file.path}>
                                  {file.path}
                                </option>
                              ))}
                            </select>
                            <input
                              value={inlineCommentLine}
                              onChange={(event) => setInlineCommentLine(event.target.value)}
                              inputMode="numeric"
                              placeholder={translate(
                                'auto.components.GitLabItemDialog.7a7204417f',
                                'Line'
                              )}
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                            />
                          </div>
                          <textarea
                            value={inlineCommentBody}
                            onChange={(event) => setInlineCommentBody(event.target.value)}
                            rows={2}
                            placeholder={translate(
                              'auto.components.GitLabItemDialog.21f8dde18a',
                              'Inline comment'
                            )}
                            className="mt-2 w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-xs focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/50"
                          />
                          <div className="mt-2 flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              disabled={
                                inlineCommentSubmitting ||
                                !inlineCommentFilePath ||
                                !inlineCommentLine.trim() ||
                                !canSubmitInlineComment
                              }
                              onClick={() => void handleSubmitInlineComment()}
                            >
                              {inlineCommentSubmitting ? (
                                <LoaderCircle className="size-3.5 animate-spin" />
                              ) : (
                                <Send className="size-3.5" />
                              )}
                              {translate('auto.components.GitLabItemDialog.84012fa8fb', 'Comment')}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {details.files.map((file) => (
                            <div
                              key={file.path}
                              className="rounded-md border border-border/50 bg-muted/10"
                            >
                              <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
                                <div className="min-w-0">
                                  <div className="break-all font-mono text-xs text-foreground">
                                    {file.path}
                                  </div>
                                  {file.oldPath ? (
                                    <div className="break-all font-mono text-[11px] text-muted-foreground">
                                      {translate(
                                        'auto.components.GitLabItemDialog.a7eb4f4916',
                                        'from'
                                      )}{' '}
                                      {file.oldPath}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="shrink-0 text-[11px] text-muted-foreground">
                                  <span className="text-emerald-600">+{file.additions}</span>{' '}
                                  <span className="text-rose-600">-{file.deletions}</span>
                                </div>
                              </div>
                              {file.diff ? (
                                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-4 text-foreground scrollbar-sleek">
                                  {file.diff}
                                </pre>
                              ) : (
                                <div className="px-3 py-3 text-xs text-muted-foreground">
                                  {translate(
                                    'auto.components.GitLabItemDialog.007423f585',
                                    'Diff content unavailable.'
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {translate(
                          'auto.components.GitLabItemDialog.808b1ca1ba',
                          'No changed files.'
                        )}
                      </p>
                    )}
                  </TabsContent>
                ) : null}

                {isMR ? (
                  <TabsContent value="pipeline" className="mt-0">
                    {loading && !details ? (
                      <div className="flex items-center justify-center py-12">
                        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : details?.pipelineJobs?.length ? (
                      <div className="space-y-1">
                        {details.pipelineJobs.map((j) => (
                          <PipelineJobRow
                            key={j.id}
                            job={j}
                            expanded={expandedJobId === j.id}
                            traceState={jobTraceById[j.id]}
                            retrying={retryingJobId === j.id}
                            onToggleTrace={(job) => void handleToggleJobTrace(job)}
                            onRetry={(job) => void handleRetryJob(job)}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {translate(
                          'auto.components.GitLabItemDialog.f11e3e7675',
                          'No pipeline runs for this MR.'
                        )}
                      </p>
                    )}
                  </TabsContent>
                ) : null}
              </div>
            </Tabs>
  )
}
