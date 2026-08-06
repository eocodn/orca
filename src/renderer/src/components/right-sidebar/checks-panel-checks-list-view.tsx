import React, { useEffect, useRef, useState } from 'react'
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LoaderCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useActiveWorktree } from '@/store/selectors'
import { useAppStore } from '@/store'
import { useCheckDetailsResize } from './check-details-resize'
import { CheckRunDetails } from './checks-panel-check-run-details'
import { CHECK_ICON, CHECK_COLOR } from './checks-panel-check-icons'
import {
  type CheckDetailsLoadState,
  type CheckDetailsStickySurface,
  getCheckDetailsKey,
  isFailedCheck
} from './checks-panel-check-model'
import { sortChecksBySeverity } from '../../../../shared/pr-check-severity-order'
import { summarizeProviderChecks } from '../../../../shared/provider-check-summary'
import type { PRCheckDetail, PRCheckRunDetails } from '../../../../shared/types'

export function ChecksList({
  checks,
  checksLoading,
  checkDetailsContextKey,
  onLoadCheckDetails,
  worktreeId: worktreeIdOverride,
  detailsStickySurface = 'sidebar'
}: {
  checks: PRCheckDetail[]
  checksLoading: boolean
  checkDetailsContextKey: string
  onLoadCheckDetails?: (check: PRCheckDetail) => Promise<PRCheckRunDetails | null>
  /** Why: folder-workspace PR checks render rows for attached worktrees, not the active one. */
  worktreeId?: string
  detailsStickySurface?: CheckDetailsStickySurface
}): React.JSX.Element {
  const activeWorktree = useActiveWorktree()
  const resolvedWorktreeId = worktreeIdOverride ?? activeWorktree?.id ?? null
  const patchOpenCheckRunDetails = useAppStore((s) => s.patchOpenCheckRunDetails)
  const [checksExpanded, setChecksExpanded] = useState(true)
  const [expandedCheckKeys, setExpandedCheckKeys] = useState<Set<string>>(new Set())
  const [detailsByCheckKey, setDetailsByCheckKey] = useState<Record<string, CheckDetailsLoadState>>(
    {}
  )
  const detailsContextRef = useRef(checkDetailsContextKey)
  const autoExpandedContextRef = useRef<string | null>(null)
  // Why: expanded check details already sit inside the sidebar scroller; keeping
  // the list scroller too creates nested scrollbars around CI annotations.
  const shouldConstrainCheckList = checksExpanded && expandedCheckKeys.size === 0
  const { detailsHeight, handleResizeStart } = useCheckDetailsResize(
    shouldConstrainCheckList && checks.length > 0
  )
  detailsContextRef.current = checkDetailsContextKey
  const sorted = React.useMemo(() => sortChecksBySeverity(checks), [checks])
  const rows = React.useMemo(
    () =>
      sorted.map((check, index) => ({
        check,
        key: getCheckDetailsKey(checkDetailsContextKey, check, index)
      })),
    [checkDetailsContextKey, sorted]
  )
  // Why: every header count comes from the same classifier the checks pill uses — counting only
  // `success` made a 2-success/3-skipped PR say "2 passing" next to "5/5 passed", and treating a
  // null conclusion as pending kept a completed-but-unresolved check spinning forever.
  const {
    passed: passingCount,
    failed: failingCount,
    pending: pendingCount,
    neutral: neutralCount
  } = summarizeProviderChecks(checks)

  useEffect(() => {
    const validKeys = new Set(rows.map((row) => row.key))
    setDetailsByCheckKey((current) => {
      const next: Record<string, CheckDetailsLoadState> = {}
      for (const [key, state] of Object.entries(current)) {
        if (validKeys.has(key)) {
          next[key] = state
        }
      }
      return next
    })
    setExpandedCheckKeys((current) => {
      const next = new Set([...current].filter((key) => validKeys.has(key)))
      if (autoExpandedContextRef.current !== checkDetailsContextKey) {
        const firstFailed = rows.find((row) => isFailedCheck(row.check))
        if (firstFailed) {
          next.add(firstFailed.key)
        }
        autoExpandedContextRef.current = checkDetailsContextKey
      }
      return next
    })
  }, [checkDetailsContextKey, rows])

  useEffect(() => {
    setDetailsByCheckKey((current) => {
      let changed = false
      const next: Record<string, CheckDetailsLoadState> = { ...current }
      for (const row of rows) {
        const cached = next[row.key]
        if (!cached?.details) {
          continue
        }
        if (
          cached.details.status !== row.check.status ||
          cached.details.conclusion !== row.check.conclusion
        ) {
          delete next[row.key]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [rows])

  const requestCheckDetails = useCallback(
    (row: { check: PRCheckDetail; key: string }) => {
      if (detailsByCheckKey[row.key]?.loading || detailsByCheckKey[row.key]?.details) {
        return
      }
      if (!row.check.checkRunId && !row.check.workflowRunId && !row.check.url) {
        setDetailsByCheckKey((current) => ({
          ...current,
          [row.key]: {
            loading: false,
            details: null,
            error: translate(
              'auto.components.right.sidebar.checks.panel.content.e15a8b77ef',
              'No inline details are available for this check.'
            )
          }
        }))
        return
      }
      if (!onLoadCheckDetails) {
        setDetailsByCheckKey((current) => ({
          ...current,
          [row.key]: {
            loading: false,
            details: null,
            error: translate(
              'auto.components.right.sidebar.checks.panel.content.e15a8b77ef',
              'No inline details are available for this check.'
            )
          }
        }))
        return
      }
      const requestContextKey = checkDetailsContextKey
      setDetailsByCheckKey((current) => ({
        ...current,
        [row.key]: { loading: true, details: null, error: null }
      }))
      void onLoadCheckDetails(row.check)
        .then((details) => {
          if (detailsContextRef.current !== requestContextKey) {
            return
          }
          setDetailsByCheckKey((current) => ({
            ...current,
            [row.key]: {
              loading: false,
              details,
              error: details ? null : 'No inline details are available for this check.'
            }
          }))
        })
        .catch((err) => {
          if (detailsContextRef.current !== requestContextKey) {
            return
          }
          setDetailsByCheckKey((current) => ({
            ...current,
            [row.key]: {
              loading: false,
              details: null,
              error: err instanceof Error ? err.message : 'Failed to load check details.'
            }
          }))
        })
    },
    [checkDetailsContextKey, detailsByCheckKey, onLoadCheckDetails]
  )

  useEffect(() => {
    if (!checksExpanded) {
      return
    }
    for (const row of rows) {
      if (expandedCheckKeys.has(row.key) && !detailsByCheckKey[row.key]) {
        requestCheckDetails(row)
      }
    }
  }, [checksExpanded, detailsByCheckKey, expandedCheckKeys, requestCheckDetails, rows])

  useEffect(() => {
    if (!resolvedWorktreeId) {
      return
    }
    for (const row of rows) {
      const detailsState = detailsByCheckKey[row.key]
      if (!detailsState) {
        continue
      }
      patchOpenCheckRunDetails(resolvedWorktreeId, checkDetailsContextKey, row.check, {
        details: detailsState.details ?? null,
        loading: detailsState.loading ?? false,
        error: detailsState.error ?? null
      })
    }
  }, [
    checkDetailsContextKey,
    detailsByCheckKey,
    patchOpenCheckRunDetails,
    resolvedWorktreeId,
    rows
  ])

  const toggleCheckExpanded = useCallback(
    (row: { check: PRCheckDetail; key: string }) => {
      const willExpand = !expandedCheckKeys.has(row.key)
      setExpandedCheckKeys((current) => {
        const next = new Set(current)
        if (next.has(row.key)) {
          next.delete(row.key)
        } else {
          next.add(row.key)
        }
        return next
      })
      if (willExpand) {
        requestCheckDetails(row)
      }
    },
    [expandedCheckKeys, requestCheckDetails]
  )

  return (
    <>
      {/* Checks Summary */}
      {checks.length > 0 && (
        <button
          type="button"
          className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-[10px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          onClick={() => setChecksExpanded((expanded) => !expanded)}
          aria-expanded={checksExpanded}
        >
          <ChevronDown
            className={cn('size-3 shrink-0 transition-transform', !checksExpanded && '-rotate-90')}
          />
          {passingCount > 0 && (
            <span className="flex items-center gap-1">
              <CircleCheck className="size-3 text-emerald-500" />
              {passingCount}{' '}
              {translate(
                'auto.components.right.sidebar.checks.panel.content.02ca4f9074',
                'passing'
              )}
            </span>
          )}
          {failingCount > 0 && (
            <span className="flex items-center gap-1">
              <CircleX className="size-3 text-rose-500" />
              {failingCount}{' '}
              {translate(
                'auto.components.right.sidebar.checks.panel.content.5e52f4ef7f',
                'failing'
              )}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="flex items-center gap-1">
              <LoaderCircle className="size-3 text-amber-500" />
              {pendingCount}{' '}
              {translate(
                'auto.components.right.sidebar.checks.panel.content.9ad98f2a17',
                'pending'
              )}
            </span>
          )}
          {/* Why: without this chip a list of only unresolved checks rendered a header with no
              counts at all, so nothing said why the pill was grey. */}
          {neutralCount > 0 && (
            <span className="flex items-center gap-1">
              <CircleDashed className="size-3 text-muted-foreground" />
              {neutralCount}{' '}
              {translate(
                'auto.components.right.sidebar.checks.panel.content.checksUnresolvedChip',
                'unresolved'
              )}
            </span>
          )}
          <span className="flex-1" />
          {checksLoading && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
        </button>
      )}

      {/* Checks List */}
      {checksLoading && checks.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : checks.length === 0 ? (
        <div className="px-4 py-8 text-[11px] text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.checks.panel.content.991f50c7e4',
            'No checks configured'
          )}
        </div>
      ) : !checksExpanded ? null : (
        <>
          <div
            className={cn('py-1', shouldConstrainCheckList && 'overflow-y-auto scrollbar-sleek')}
            style={shouldConstrainCheckList ? { maxHeight: detailsHeight } : undefined}
          >
            {rows.map((row) => {
              const check = row.check
              const conclusion = check.conclusion ?? 'pending'
              const Icon = CHECK_ICON[conclusion] ?? CircleDashed
              const color = CHECK_COLOR[conclusion] ?? 'text-muted-foreground'
              const expanded = expandedCheckKeys.has(row.key)
              const openUrl = check.url
              return (
                <div key={row.key} className="min-w-0">
                  <div
                    className={cn(
                      'group/check-row flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors hover:bg-accent/40',
                      expanded && 'bg-accent/25'
                    )}
                    onClick={() => toggleCheckExpanded(row)}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3 shrink-0 text-muted-foreground transition-transform',
                        expanded && 'rotate-90'
                      )}
                    />
                    <Icon
                      className={cn(
                        'size-3.5 shrink-0',
                        color,
                        conclusion === 'pending' && 'animate-spin'
                      )}
                    />
                    <span className="flex-1 truncate text-[12px] text-foreground">
                      {check.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">
                        {getCheckStatusLabel(check)}
                      </span>
                      {openUrl && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="size-6 text-muted-foreground hover:text-foreground focus-visible:text-foreground"
                              aria-label={translate(
                                'auto.components.right.sidebar.checks.panel.content.0dca6bfab5',
                                'Open check details'
                              )}
                              onClick={(event) => {
                                event.stopPropagation()
                                window.api.shell.openUrl(openUrl)
                              }}
                            >
                              <ExternalLink className="size-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left" sideOffset={4}>
                            {translate(
                              'auto.components.right.sidebar.checks.panel.content.0dca6bfab5',
                              'Open check details'
                            )}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </div>
                  {expanded && (
                    <CheckRunDetails
                      check={check}
                      state={detailsByCheckKey[row.key]}
                      checkDetailsContextKey={checkDetailsContextKey}
                      worktreeId={resolvedWorktreeId}
                      detailsStickySurface={detailsStickySurface}
                    />
                  )}
                </div>
              )
            })}
          </div>
          {shouldConstrainCheckList && (
            <div
              role="separator"
              aria-orientation="horizontal"
              title={translate(
                'auto.components.right.sidebar.checks.panel.content.7f793b571d',
                'Drag to resize checks'
              )}
              className="group flex h-2 cursor-row-resize items-center border-b border-border"
              onMouseDown={handleResizeStart}
            >
              <div className="h-px w-full bg-transparent transition-colors group-hover:bg-ring/40" />
            </div>
          )}
          {checks.length >= 100 && (
            <div className="border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.checks.panel.content.cbcc4ab3db',
                'Showing first 100 checks'
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
